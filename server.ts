import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { fileURLToPath } from 'url';
import {
  EDITION_CATALOG,
  StoredLicenseRecord,
  buildEnterpriseSlaReport,
  buildSanitizedSupportBundle,
  formatEnterpriseSlaCsv,
  hasFeature,
  resolveLicenseSigningKey,
  resolveOrgEntitlements,
  verifyOfflineLicenseToken
} from './server/licensing';
import { hashPassword, verifyPassword } from './server/password';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.ECC_PORT || '3000');
const app = express();
app.disable('x-powered-by');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ALLOWED_CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
if (ALLOWED_CORS_ORIGINS.includes('*')) {
  throw new Error('CORS_ORIGINS must not contain wildcard "*" when credentialed/authenticated requests are used.');
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ detail: 'Неверный формат JSON в теле запроса' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ detail: 'Размер тела запроса превышает допустимый лимит (1 МБ)' });
  }
  next(err);
});

// --- SECURITY HEADERS & STRUCTURED TELEMETRY (Phase 2) ---
interface StructuredLogEntry {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  user_id: number | null;
}

const serverStartedAt = new Date().toISOString();
const telemetryCounters = {
  totalRequests: 0,
  apiRequests: 0,
  error4xx: 0,
  error5xx: 0,
  rateLimitBlocks: 0,
  logSeq: 0
};
const structuredLogs: StructuredLogEntry[] = [];
const STRUCTURED_LOGS_STDOUT = process.env.ECC_STRUCTURED_LOGS === 'true';

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/') || req.path === '/health') {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
  }

  const start = performance.now();
  telemetryCounters.totalRequests += 1;
  if (req.path.startsWith('/api/')) {
    telemetryCounters.apiRequests += 1;
  }

  res.on('finish', () => {
    if (res.statusCode >= 400 && res.statusCode < 500) telemetryCounters.error4xx += 1;
    if (res.statusCode >= 500) telemetryCounters.error5xx += 1;
    if (res.statusCode === 429) telemetryCounters.rateLimitBlocks += 1;

    if (req.path.startsWith('/api/') || req.path === '/health') {
      telemetryCounters.logSeq += 1;
      const entry: StructuredLogEntry = {
        id: telemetryCounters.logSeq,
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
        user_id: (req as any).user?.id ?? null
      };
      structuredLogs.unshift(entry);
      if (structuredLogs.length > 150) {
        structuredLogs.length = 150;
      }
      if (STRUCTURED_LOGS_STDOUT) {
        console.log(JSON.stringify({ event: 'http_request', ...entry }));
      }
    }
  });

  next();
});

// --- TYPES ---
export type AssetStatus = 'active' | 'in_repair' | 'retired';
export type UserRole = 'admin' | 'editor' | 'viewer';
export type SoftwareLicenseType = 'subscription' | 'perpetual' | 'oem' | 'site';
export type SoftwareLicenseStatus = 'active' | 'suspended' | 'retired';
export type MaintenancePriority = 'low' | 'normal' | 'high' | 'urgent';
export type MaintenanceStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';

interface Organization {
  id: number;
  name: string;
  created_at: string;
}

interface User {
  id: number;
  organization_id: number;
  email: string;
  full_name: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean;
  token_version: number;
  version: number;
  created_at: string;
}

interface Department {
  id: number;
  organization_id: number;
  version: number;
  name: string;
  code: string;
  created_at: string;
}

interface Employee {
  id: number;
  organization_id: number;
  version: number;
  employee_number: string;
  full_name: string;
  department_id: number | null;
  email: string | null;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Asset {
  id: number;
  organization_id: number;
  name: string;
  asset_tag: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  assigned_to: string | null;
  status: AssetStatus;
  created_at: string;
  updated_at: string;
  version: number;
}

interface MaintenanceRequest {
  id: number;
  organization_id: number;
  asset_id: number;
  requested_by_user_id: number;
  assigned_to_user_id: number | null;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  version: number;
}

interface SoftwareLicense {
  id: number;
  organization_id: number;
  name: string;
  publisher: string | null;
  version: string | null;
  license_type: SoftwareLicenseType;
  license_reference: string | null;
  seats_total: number;
  seats_used: number;
  purchased_at: string | null;
  expires_at: string | null;
  status: SoftwareLicenseStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  record_version: number;
}

interface AuditEvent {
  id: number;
  organization_id: number;
  actor_user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export type RecoveryDrillAssessment = 'within_targets' | 'target_exceeded' | 'not_assessed';

interface RecoveryDrillReport {
  id: number;
  organization_id: number;
  created_by_user_id: number | null;
  schema_version: 1;
  report_type: 'ecc_recovery_drill';
  generated_at: string;
  backup_reference: string;
  timestamps: {
    incident_at: string;
    restore_started_at: string | null;
    restore_completed_at: string;
    last_committed_at: string | null;
  };
  measurements_seconds: {
    observed_rto: number;
    restore_execution: number | null;
    observed_rpo: number | null;
  };
  targets_seconds: {
    rto: number | null;
    rpo: number | null;
  };
  target_met: {
    rto: boolean | null;
    rpo: boolean | null;
  };
  assessment: RecoveryDrillAssessment;
  measurement_notes: {
    rto: string;
    rpo: string;
    missing_rpo: string | null;
  };
}

interface EccDatabase {
  organizations: Organization[];
  users: User[];
  departments: Department[];
  employees: Employee[];
  assets: Asset[];
  maintenanceRequests: MaintenanceRequest[];
  softwareLicenses: SoftwareLicense[];
  auditEvents: AuditEvent[];
  recoveryDrills?: RecoveryDrillReport[];
  licenses?: StoredLicenseRecord[];
  counters: {
    user: number;
    department: number;
    employee: number;
    asset: number;
    maintenance: number;
    software: number;
    audit: number;
    recoveryDrill?: number;
  };
}

// --- PERSISTENCE ---
const DATA_DIR = path.resolve(process.env.ECC_DATA_DIR || path.resolve(__dirname, 'var', 'ecc-data'));
const BACKUPS_DIR = path.resolve(DATA_DIR, 'backups');
const DB_FILE = path.resolve(DATA_DIR, 'ecc_store.json');
const BACKUP_RETENTION_COUNT = Math.max(1, Math.min(100, Number(process.env.ECC_BACKUP_RETENTION_COUNT || '10') || 10));

interface BootstrapAdminConfig {
  email: string;
  fullName: string;
  password: string;
}

function getBootstrapAdminConfig(): BootstrapAdminConfig {
  const email = (process.env.ECC_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const fullName = (process.env.ECC_BOOTSTRAP_ADMIN_NAME || '').trim();
  const password = process.env.ECC_BOOTSTRAP_ADMIN_PASSWORD || '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ECC_BOOTSTRAP_ADMIN_EMAIL must be set to a valid administrator email before first startup.');
  }
  if (!fullName || fullName.length > 120) {
    throw new Error('ECC_BOOTSTRAP_ADMIN_NAME must be set (maximum 120 characters) before first startup.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('ECC_BOOTSTRAP_ADMIN_PASSWORD must contain 12 to 128 characters before first startup.');
  }
  return { email, fullName, password };
}

function createInitialDatabase(admin: BootstrapAdminConfig): EccDatabase {
  const now = new Date().toISOString();
  return {
    organizations: [
      { id: 1, name: 'Default Organization', created_at: now }
    ],
    users: [
      {
        id: 1,
        organization_id: 1,
        email: admin.email,
        full_name: admin.fullName,
        password_hash: hashPassword(admin.password),
        role: 'admin',
        is_active: true,
        token_version: 1,
        version: 1,
        created_at: now
      }
    ],
    departments: [
      { id: 1, organization_id: 1, version: 1, name: 'Информационные технологии', code: 'IT', created_at: now },
      { id: 2, organization_id: 1, version: 1, name: 'Отдел разработки ПО', code: 'DEV', created_at: now },
      { id: 3, organization_id: 1, version: 1, name: 'Информационная безопасность', code: 'SEC', created_at: now },
      { id: 4, organization_id: 1, version: 1, name: 'Бухгалтерия и финансы', code: 'FIN', created_at: now },
      { id: 5, organization_id: 1, version: 1, name: 'Отдел управления персоналом', code: 'HR', created_at: now }
    ],
    employees: [
      {
        id: 1,
        organization_id: 1,
        version: 1,
        employee_number: 'EMP-001',
        full_name: 'Иванов Алексей Сергеевич',
        department_id: 1,
        email: 'alexey.ivanov@example.com',
        job_title: 'Руководитель IT департамента',
        phone: '+7 (495) 100-20-01',
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 2,
        organization_id: 1,
        version: 1,
        employee_number: 'EMP-002',
        full_name: 'Смирнова Елена Михайловна',
        department_id: 2,
        email: 'elena.smirnova@example.com',
        job_title: 'Ведущий DevOps инженер',
        phone: '+7 (495) 100-20-02',
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 3,
        organization_id: 1,
        version: 1,
        employee_number: 'EMP-003',
        full_name: 'Ковалев Дмитрий Андреевич',
        department_id: 3,
        email: 'dmitry.kovalev@example.com',
        job_title: 'Специалист по кибербезопасности',
        phone: '+7 (495) 100-20-03',
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 4,
        organization_id: 1,
        version: 1,
        employee_number: 'EMP-004',
        full_name: 'Соколова Анна Павловна',
        department_id: 2,
        email: 'anna.sokolova@example.com',
        job_title: 'Старший инженер-программист',
        phone: '+7 (495) 100-20-04',
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: 5,
        organization_id: 1,
        version: 1,
        employee_number: 'EMP-005',
        full_name: 'Морозов Игорь Владимирович',
        department_id: 4,
        email: 'igor.morozov@example.com',
        job_title: 'Главный финансовый контролер',
        phone: '+7 (495) 100-20-05',
        is_active: true,
        created_at: now,
        updated_at: now
      }
    ],
    assets: [
      {
        id: 1,
        organization_id: 1,
        name: 'Рабочая станция Dell Precision 5820',
        asset_tag: 'AST-00101',
        category: 'Компьютер',
        manufacturer: 'Dell Inc.',
        model: 'Precision 5820 Tower',
        serial_number: 'SN-DELL-5820-9921',
        assigned_to: 'Смирнова Елена Михайловна',
        status: 'active',
        created_at: now,
        updated_at: now,
        version: 1
      },
      {
        id: 2,
        organization_id: 1,
        name: 'Ноутбук Apple MacBook Pro 16" M3 Max',
        asset_tag: 'AST-00102',
        category: 'Ноутбук',
        manufacturer: 'Apple',
        model: 'MacBook Pro 16 (A2991)',
        serial_number: 'C02LX8819QJ',
        assigned_to: 'Соколова Анна Павловна',
        status: 'active',
        created_at: now,
        updated_at: now,
        version: 1
      },
      {
        id: 3,
        organization_id: 1,
        name: 'Сервер баз данных HPE ProLiant DL380 Gen10',
        asset_tag: 'AST-00103',
        category: 'Сервер',
        manufacturer: 'HPE',
        model: 'ProLiant DL380 Gen10 2U',
        serial_number: 'CZ20489A12',
        assigned_to: 'Иванов Алексей Сергеевич',
        status: 'active',
        created_at: now,
        updated_at: now,
        version: 1
      },
      {
        id: 4,
        organization_id: 1,
        name: 'Маршрутизатор Cisco Catalyst 9300',
        asset_tag: 'AST-00104',
        category: 'Сетевое оборудование',
        manufacturer: 'Cisco Systems',
        model: 'C9300-48P',
        serial_number: 'FCW2318L0AZ',
        assigned_to: null,
        status: 'active',
        created_at: now,
        updated_at: now,
        version: 1
      },
      {
        id: 5,
        organization_id: 1,
        name: 'Монитор 27" Dell UltraSharp U2723QE',
        asset_tag: 'AST-00105',
        category: 'Монитор',
        manufacturer: 'Dell Inc.',
        model: 'UltraSharp U2723QE 4K',
        serial_number: 'CN-0K7T9R-74261',
        assigned_to: 'Ковалев Дмитрий Андреевич',
        status: 'in_repair',
        created_at: now,
        updated_at: now,
        version: 1
      }
    ],
    maintenanceRequests: [
      {
        id: 1,
        organization_id: 1,
        asset_id: 5,
        requested_by_user_id: 1,
        assigned_to_user_id: null,
        title: 'Мерцание матрицы при подключении через Type-C',
        description: 'При передаче видеосигнала 4K 60Hz экран кратковременно гаснет. Требуется диагностика блока питания или кабеля.',
        priority: 'high',
        status: 'in_progress',
        created_at: now,
        updated_at: now,
        resolved_at: null,
        version: 1
      },
      {
        id: 2,
        organization_id: 1,
        asset_id: 3,
        requested_by_user_id: 1,
        assigned_to_user_id: 1,
        title: 'Плановая замена термопасты и продувка серверов',
        description: 'Профилактическое обслуживание серверного шкафа в серверной #2.',
        priority: 'normal',
        status: 'open',
        created_at: now,
        updated_at: now,
        resolved_at: null,
        version: 1
      }
    ],
    softwareLicenses: [
      {
        id: 1,
        organization_id: 1,
        name: 'JetBrains All Products Pack',
        publisher: 'JetBrains s.r.o.',
        version: '2026.1',
        license_type: 'subscription',
        license_reference: 'JB-CORP-992144',
        seats_total: 25,
        seats_used: 19,
        purchased_at: '2026-01-15',
        expires_at: '2027-01-15',
        status: 'active',
        notes: 'Корпоративная подписка на весь стек IDE для команды разработки.',
        created_at: now,
        updated_at: now,
        record_version: 1
      },
      {
        id: 2,
        organization_id: 1,
        name: 'Microsoft 365 Enterprise E5',
        publisher: 'Microsoft Corporation',
        version: 'Cloud',
        license_type: 'subscription',
        license_reference: 'MS-365-E5-8812',
        seats_total: 100,
        seats_used: 78,
        purchased_at: '2026-01-01',
        expires_at: '2027-01-01',
        status: 'active',
        notes: 'Пакет офисных приложений, Exchange Online и расширенная безопасность.',
        created_at: now,
        updated_at: now,
        record_version: 1
      },
      {
        id: 3,
        organization_id: 1,
        name: 'Figma Enterprise Design',
        publisher: 'Figma Inc.',
        version: 'Cloud',
        license_type: 'subscription',
        license_reference: 'FIG-ENT-33190',
        seats_total: 15,
        seats_used: 12,
        purchased_at: '2026-03-01',
        expires_at: '2027-03-01',
        status: 'active',
        notes: 'Лицензии для UI/UX дизайнеров и фронтенд инженеров.',
        created_at: now,
        updated_at: now,
        record_version: 1
      }
    ],
    auditEvents: [
      {
        id: 1,
        organization_id: 1,
        actor_user_id: 1,
        action: 'system.bootstrap',
        entity_type: 'system',
        entity_id: '1',
        details: { message: 'Инициализация платформы Enterprise Control Center' },
        created_at: now
      },
      {
        id: 2,
        organization_id: 1,
        actor_user_id: 1,
        action: 'asset.created',
        entity_type: 'asset',
        entity_id: '1',
        details: { asset_tag: 'AST-00101', name: 'Рабочая станция Dell Precision 5820' },
        created_at: now
      },
      {
        id: 3,
        organization_id: 1,
        actor_user_id: 1,
        action: 'asset.created',
        entity_type: 'asset',
        entity_id: '2',
        details: { asset_tag: 'AST-00102', name: 'Ноутбук Apple MacBook Pro 16" M3 Max' },
        created_at: now
      }
    ],
    recoveryDrills: [],
    licenses: [],
    counters: {
      user: 1,
      department: 5,
      employee: 5,
      asset: 5,
      maintenance: 2,
      software: 3,
      audit: 3,
      recoveryDrill: 0
    }
  };
}

function writeDatabaseAtomically(filePath: string, contents: string) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, contents, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  fs.renameSync(tempPath, filePath);
}

function backupDatabaseBeforeMigration(raw: string): string {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true, mode: 0o700 });
  const backupPath = path.join(BACKUPS_DIR, `ecc-pre-admin-bootstrap-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, raw, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  return backupPath;
}

let db: EccDatabase;
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    db = JSON.parse(raw);
    if (!Array.isArray(db.recoveryDrills)) db.recoveryDrills = [];
    if (!Array.isArray(db.licenses)) db.licenses = [];
    if (typeof db.counters.recoveryDrill !== 'number') db.counters.recoveryDrill = db.recoveryDrills.length;

    const legacyDemoEmails = new Set(['admin@example.com', 'editor@example.com', 'viewer@example.com']);
    const legacyDemoUsers = db.users.filter(u => legacyDemoEmails.has(String(u.email || '').toLowerCase()));
    const hasAdmin = db.users.some(u => u.role === 'admin' && u.is_active);
    if (legacyDemoUsers.length > 0 || !hasAdmin) {
      const adminConfig = getBootstrapAdminConfig();
      const duplicate = db.users.some(u =>
        u.is_active && u.role !== 'admin' && String(u.email || '').toLowerCase() === adminConfig.email
      );
      if (duplicate) throw new Error('Bootstrap administrator email is already assigned to another active account.');

      const backupPath = backupDatabaseBeforeMigration(raw);
      const legacyAdmin = legacyDemoUsers.find(u => u.role === 'admin') ||
        db.users.find(u => u.role === 'admin');
      if (legacyAdmin) {
        legacyAdmin.email = adminConfig.email;
        legacyAdmin.full_name = adminConfig.fullName;
        legacyAdmin.password_hash = hashPassword(adminConfig.password);
        legacyAdmin.is_active = true;
        legacyAdmin.token_version += 1;
        legacyAdmin.version += 1;
      } else {
        const organizationId = db.organizations[0]?.id;
        if (!organizationId) throw new Error('Cannot bootstrap an administrator because the database has no organization.');
        db.counters.user = Math.max(db.counters.user, ...db.users.map(u => u.id), 0) + 1;
        db.users.push({
          id: db.counters.user,
          organization_id: organizationId,
          email: adminConfig.email,
          full_name: adminConfig.fullName,
          password_hash: hashPassword(adminConfig.password),
          role: 'admin',
          is_active: true,
          token_version: 1,
          version: 1,
          created_at: new Date().toISOString()
        });
      }

      for (const legacyUser of legacyDemoUsers) {
        if (legacyUser.role === 'admin') continue;
        legacyUser.email = `disabled-legacy-${legacyUser.id}@invalid.invalid`;
        legacyUser.full_name = 'Deactivated legacy demo account';
        legacyUser.password_hash = hashPassword(crypto.randomBytes(32).toString('hex'));
        legacyUser.is_active = false;
        legacyUser.token_version += 1;
        legacyUser.version += 1;
      }
      writeDatabaseAtomically(DB_FILE, JSON.stringify(db, null, 2));
      console.warn(`Legacy demo-account migration completed. Pre-migration backup: ${backupPath}`);
    }
  } else {
    const adminConfig = getBootstrapAdminConfig();
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    db = createInitialDatabase(adminConfig);
    writeDatabaseAtomically(DB_FILE, JSON.stringify(db, null, 2));
  }
} catch (err) {
  console.error(`Database initialization failed for ${DB_FILE}; no seed fallback will be used.`, err);
  throw new Error('Database initialization failed. Check bootstrap configuration and restore a valid backup if needed.');
}

function saveDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save DB file:', e);
  }
}

function logAudit(
  organizationId: number,
  actorUserId: number | null,
  action: string,
  entityType: string,
  entityId: string | number,
  details: Record<string, unknown> = {}
) {
  db.counters.audit += 1;
  const event: AuditEvent = {
    id: db.counters.audit,
    organization_id: organizationId,
    actor_user_id: actorUserId,
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    details,
    created_at: new Date().toISOString()
  };
  db.auditEvents.unshift(event);
  saveDb();
  return event;
}

// --- AUTH & TOKENS ---
const configuredSecret = process.env.ECC_SECRET_KEY;
if (configuredSecret) {
  if (configuredSecret.includes('REPLACE_WITH')) {
    throw new Error('ECC_SECRET_KEY is still a placeholder; configure a unique random secret.');
  }
  if (Buffer.byteLength(configuredSecret, 'utf-8') < 32) {
    throw new Error('ECC_SECRET_KEY must contain at least 32 bytes.');
  }
}
const SECRET_KEY = configuredSecret || 'default-super-secret-key-at-least-32-bytes-long-for-ecc-production';

const ACCESS_TOKEN_MINUTES = Number(process.env.ACCESS_TOKEN_MINUTES || '20');
if (!Number.isInteger(ACCESS_TOKEN_MINUTES) || ACCESS_TOKEN_MINUTES < 5 || ACCESS_TOKEN_MINUTES > 60) {
  throw new Error('ACCESS_TOKEN_MINUTES must be an integer between 5 and 60.');
}
const ACCESS_TOKEN_SECONDS = ACCESS_TOKEN_MINUTES * 60;

const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || '10');
const AUTH_RATE_LIMIT_WINDOW_SECONDS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS || '60');
if (!Number.isInteger(AUTH_RATE_LIMIT_MAX) || AUTH_RATE_LIMIT_MAX < 1 || !Number.isInteger(AUTH_RATE_LIMIT_WINDOW_SECONDS) || AUTH_RATE_LIMIT_WINDOW_SECONDS < 1) {
  throw new Error('Authentication rate-limit settings must be positive integers.');
}

const LICENSE_SIGNING = resolveLicenseSigningKey();

function getOrgEntitlements(orgId: number) {
  const stored = (db.licenses || []).find(l => l.organization_id === orgId);
  return resolveOrgEntitlements(stored, {
    users: db.users.filter(u => u.organization_id === orgId).length,
    assets: db.assets.filter(a => a.organization_id === orgId).length,
    software_licenses: db.softwareLicenses.filter(s => s.organization_id === orgId).length
  });
}

interface TokenPayload {
  userId: number;
  organizationId: number;
  tokenVersion: number;
  exp: number;
}

function signToken(payload: Omit<TokenPayload, 'exp'>, expiresInSeconds = ACCESS_TOKEN_SECONDS): string {
  const fullPayload: TokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(body).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const payload: TokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ detail: 'Необходима авторизация' });
  }
  const token = authHeader.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ detail: 'Недействительный или истекший токен доступа' });
  }
  const user = db.users.find(u => u.id === payload.userId && u.organization_id === payload.organizationId);
  if (!user || !user.is_active || user.token_version !== payload.tokenVersion) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ detail: 'Сессия недействительна. Войдите снова.' });
  }
  (req as any).user = user;
  next();
}

// --- API ENDPOINTS ---

// Login Rate Limiter (fixed window per client IP, ignoring untrusted X-Forwarded-For)
interface RateLimitBucket {
  attempts: number;
  resetAt: number;
}
const loginRateLimitBuckets = new Map<string, RateLimitBucket>();

function checkLoginRateLimit(key: string): number | null {
  const now = Date.now();
  let bucket = loginRateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { attempts: 0, resetAt: now + AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000 };
  }
  bucket.attempts += 1;
  loginRateLimitBuckets.set(key, bucket);
  if (bucket.attempts > AUTH_RATE_LIMIT_MAX) {
    return Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1);
  }
  return null;
}

// Healthcheck
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'enterprise-control-center-api' });
});

// Auth Login
app.post('/api/v1/auth/token', (req, res) => {
  const realIpHeader = req.headers['x-real-ip'];
  const clientIp = (typeof realIpHeader === 'string' && realIpHeader.trim())
    ? realIpHeader.trim()
    : (req.socket.remoteAddress || 'unknown');
  const email = (req.body.username || req.body.email || '').toString().trim().toLowerCase();
  const password = (req.body.password || '').toString();

  const rateLimitKey = `ecc:auth:login:${clientIp}`;
  const retryAfter = checkLoginRateLimit(rateLimitKey);
  if (retryAfter !== null) {
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      detail: `Превышен лимит попыток входа (${AUTH_RATE_LIMIT_MAX} попыток). Повторите через ${retryAfter} сек.`
    });
  }

  const user = db.users.find(u => u.email.toLowerCase() === email);
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ detail: 'Неверный адрес электронной почты или пароль' });
  }

  const token = signToken({
    userId: user.id,
    organizationId: user.organization_id,
    tokenVersion: user.token_version
  }, ACCESS_TOKEN_SECONDS);

  logAudit(user.organization_id, user.id, 'auth.login', 'user', user.id, { email: user.email });

  res.json({
    access_token: token,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_SECONDS
  });
});

// Current User Me
app.get('/api/v1/auth/me', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const org = db.organizations.find(o => o.id === user.organization_id);

  res.json({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    is_active: user.is_active,
    organization_id: user.organization_id,
    organization_name: org ? org.name : 'Default Organization',
    created_at: user.created_at,
    version: user.version
  });
});

// Change Password
app.post('/api/v1/auth/change-password', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const { current_password, new_password } = req.body || {};

  if (typeof current_password !== 'string' || !verifyPassword(current_password, user.password_hash)) {
    return res.status(400).json({ detail: 'Неверный текущий пароль' });
  }
  if (typeof new_password !== 'string' || new_password.length < 12 || new_password.length > 128) {
    return res.status(422).json({ detail: 'Новый пароль должен содержать от 12 до 128 символов' });
  }

  user.password_hash = hashPassword(new_password);
  user.token_version += 1;
  saveDb();

  logAudit(user.organization_id, user.id, 'auth.change_password', 'user', user.id);
  res.json({ status: 'password_updated' });
});

// Users Management
app.get('/api/v1/users/assignees', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const assignees = db.users
    .filter(u => u.organization_id === user.organization_id && u.is_active && u.role !== 'viewer')
    .map(u => ({
      id: u.id,
      full_name: u.full_name,
      role: u.role
    }));
  res.json(assignees);
});

app.get('/api/v1/users', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Недостаточно прав для просмотра пользователей' });
  }
  const users = db.users
    .filter(u => u.organization_id === user.organization_id)
    .map(u => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      is_active: u.is_active,
      organization_id: u.organization_id,
      created_at: u.created_at,
      version: u.version
    }));
  res.json(users);
});

app.post('/api/v1/users', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может создавать пользователей' });
  }
  const { email, full_name, password, role } = req.body || {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanName = typeof full_name === 'string' ? full_name.trim() : '';
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(422).json({ detail: 'Укажите корректный email' });
  }
  if (!cleanName) {
    return res.status(422).json({ detail: 'ФИО пользователя обязательно' });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return res.status(422).json({ detail: 'Пароль должен содержать от 12 до 128 символов' });
  }
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(422).json({ detail: 'Недопустимая роль пользователя' });
  }
  if (db.users.some(u => u.email.toLowerCase() === cleanEmail)) {
    return res.status(409).json({ detail: 'Пользователь с таким email уже существует' });
  }
  const entitlements = getOrgEntitlements(user.organization_id);
  if (entitlements.limits.max_users !== null && entitlements.usage.users >= entitlements.limits.max_users) {
    return res.status(403).json({
      code: 'edition_quota_exceeded',
      detail: `Достигнут лимит пользователей для ${entitlements.edition_label} (${entitlements.limits.max_users}). Активируйте коммерческую лицензию для расширения квоты.`
    });
  }

  db.counters.user += 1;
  const newUser: User = {
    id: db.counters.user,
    organization_id: user.organization_id,
    email: cleanEmail,
    full_name: cleanName,
    password_hash: hashPassword(password),
    role,
    is_active: true,
    token_version: 1,
    version: 1,
    created_at: new Date().toISOString()
  };
  db.users.push(newUser);
  saveDb();

  logAudit(user.organization_id, user.id, 'user.create', 'user', newUser.id, {
    email: newUser.email,
    role: newUser.role
  });

  res.status(201).json({
    id: newUser.id,
    email: newUser.email,
    full_name: newUser.full_name,
    role: newUser.role,
    is_active: newUser.is_active,
    organization_id: newUser.organization_id,
    created_at: newUser.created_at,
    version: newUser.version
  });
});

app.patch('/api/v1/users/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может изменять пользователей' });
  }
  const targetId = parseInt(req.params.id, 10);
  const target = db.users.find(u => u.id === targetId && u.organization_id === user.organization_id);
  if (!target) {
    return res.status(404).json({ detail: 'Пользователь не найден' });
  }
  const { expected_version, full_name, role, is_active } = req.body || {};
  if (typeof expected_version !== 'number') {
    return res.status(422).json({ detail: 'expected_version обязателен' });
  }
  if (target.version !== expected_version) {
    return res.status(409).json({ detail: 'Конфликт версий записи. Обновите данные.' });
  }

  if (full_name !== undefined && (typeof full_name !== 'string' || !full_name.trim())) {
    return res.status(422).json({ detail: 'full_name не может быть пустым' });
  }
  if (role !== undefined && !['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(422).json({ detail: 'Недопустимая роль пользователя' });
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return res.status(422).json({ detail: 'is_active должен быть булевым значением' });
  }

  if (target.id === user.id) {
    if (role !== undefined && role !== 'admin') {
      return res.status(422).json({ detail: 'Administrator cannot demote own account' });
    }
    if (is_active === false) {
      return res.status(422).json({ detail: 'Administrator cannot disable own account' });
    }
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (full_name !== undefined && full_name.trim() !== target.full_name) {
    changes.full_name = { old: target.full_name, new: full_name.trim() };
    target.full_name = full_name.trim();
  }
  if (role !== undefined && role !== target.role) {
    changes.role = { old: target.role, new: role };
    target.role = role;
  }
  if (is_active !== undefined && is_active !== target.is_active) {
    changes.is_active = { old: target.is_active, new: is_active };
    target.is_active = is_active;
    // Invalidate previously issued tokens on both disable and re-enable (parity with test_disabling_and_reenabling_user_revokes_old_access_token)
    target.token_version += 1;
  }

  if (Object.keys(changes).length === 0) {
    return res.json({
      id: target.id,
      email: target.email,
      full_name: target.full_name,
      role: target.role,
      is_active: target.is_active,
      organization_id: target.organization_id,
      created_at: target.created_at,
      version: target.version
    });
  }

  target.version += 1;
  saveDb();

  logAudit(user.organization_id, user.id, 'user.update', 'user', target.id, { changes });

  res.json({
    id: target.id,
    email: target.email,
    full_name: target.full_name,
    role: target.role,
    is_active: target.is_active,
    organization_id: target.organization_id,
    created_at: target.created_at,
    version: target.version
  });
});

// Departments Management
app.get('/api/v1/departments', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав для просмотра подразделений' });
  }
  const list = db.departments.filter(d => d.organization_id === user.organization_id);
  res.json(list);
});

app.post('/api/v1/departments', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может создавать подразделения' });
  }
  const { name, code } = req.body;
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!cleanName || !cleanCode) {
    return res.status(422).json({ detail: 'Название и код подразделения обязательны' });
  }
  if (db.departments.some(d => d.organization_id === user.organization_id && (d.code.toUpperCase() === cleanCode || d.name.toLowerCase() === cleanName.toLowerCase()))) {
    return res.status(409).json({ detail: 'Подразделение с таким названием или кодом уже существует' });
  }
  db.counters.department += 1;
  const newDept: Department = {
    id: db.counters.department,
    organization_id: user.organization_id,
    version: 1,
    name: cleanName,
    code: cleanCode,
    created_at: new Date().toISOString()
  };
  db.departments.push(newDept);
  saveDb();

  logAudit(user.organization_id, user.id, 'department.create', 'department', newDept.id, {
    name: newDept.name,
    code: newDept.code
  });

  res.status(201).json(newDept);
});

app.patch('/api/v1/departments/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может изменять подразделения' });
  }
  const deptId = parseInt(req.params.id, 10);
  const dept = db.departments.find(d => d.id === deptId && d.organization_id === user.organization_id);
  if (!dept) {
    return res.status(404).json({ detail: 'Подразделение не найдено' });
  }
  const { expected_version, name, code } = req.body;
  if (typeof expected_version !== 'number') {
    return res.status(422).json({ detail: 'expected_version обязателен' });
  }
  if (dept.version !== expected_version) {
    return res.status(409).json({ detail: 'Конфликт версий записи' });
  }

  const nextName = name !== undefined ? String(name).trim() : dept.name;
  const nextCode = code !== undefined ? String(code).trim().toUpperCase() : dept.code;
  if (!nextName || !nextCode) {
    return res.status(422).json({ detail: 'Название и код не могут быть пустыми' });
  }
  if (db.departments.some(d => d.id !== dept.id && d.organization_id === user.organization_id && (d.code.toUpperCase() === nextCode || d.name.toLowerCase() === nextName.toLowerCase()))) {
    return res.status(409).json({ detail: 'Подразделение с таким названием или кодом уже существует' });
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (nextName !== dept.name) {
    changes.name = { old: dept.name, new: nextName };
    dept.name = nextName;
  }
  if (nextCode !== dept.code) {
    changes.code = { old: dept.code, new: nextCode };
    dept.code = nextCode;
  }

  if (Object.keys(changes).length === 0) {
    return res.json(dept);
  }

  dept.version += 1;
  saveDb();

  logAudit(user.organization_id, user.id, 'department.update', 'department', dept.id, { changes });

  res.json(dept);
});

app.delete('/api/v1/departments/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может удалять подразделения' });
  }
  const deptId = parseInt(req.params.id, 10);
  const index = db.departments.findIndex(d => d.id === deptId && d.organization_id === user.organization_id);
  if (index === -1) {
    return res.status(404).json({ detail: 'Подразделение не найдено' });
  }
  const hasEmployees = db.employees.some(e => e.department_id === deptId && e.organization_id === user.organization_id);
  if (hasEmployees) {
    return res.status(409).json({ detail: 'Нельзя удалить подразделение, в котором числятся сотрудники' });
  }
  const [deleted] = db.departments.splice(index, 1);
  saveDb();

  logAudit(user.organization_id, user.id, 'department.delete', 'department', deleted.id, {
    name: deleted.name
  });

  res.status(204).end();
});

// Employees Management
app.get('/api/v1/employees', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав для просмотра сотрудников' });
  }
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  let list = db.employees.filter(e => e.organization_id === user.organization_id);
  if (search) {
    list = list.filter(e =>
      e.full_name.toLowerCase().includes(search) ||
      e.employee_number.toLowerCase().includes(search) ||
      (e.email && e.email.toLowerCase().includes(search)) ||
      (e.job_title && e.job_title.toLowerCase().includes(search))
    );
  }
  res.json(list);
});

app.post('/api/v1/employees', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const { employee_number, full_name, department_id, email, job_title, phone } = req.body;
  const cleanNum = typeof employee_number === 'string' ? employee_number.trim() : '';
  const cleanName = typeof full_name === 'string' ? full_name.trim() : '';
  if (!cleanNum || !cleanName) {
    return res.status(422).json({ detail: 'Табельный номер и ФИО обязательны' });
  }
  if (db.employees.some(e => e.organization_id === user.organization_id && e.employee_number.toLowerCase() === cleanNum.toLowerCase())) {
    return res.status(409).json({ detail: 'Сотрудник с таким табельным номером уже существует' });
  }
  const deptId = department_id ? Number(department_id) : null;
  if (deptId !== null && !db.departments.some(d => d.id === deptId && d.organization_id === user.organization_id)) {
    return res.status(422).json({ detail: 'Подразделение должно принадлежать вашей организации' });
  }

  db.counters.employee += 1;
  const now = new Date().toISOString();
  const newEmp: Employee = {
    id: db.counters.employee,
    organization_id: user.organization_id,
    version: 1,
    employee_number: cleanNum,
    full_name: cleanName,
    department_id: deptId,
    email: email ? String(email).trim().toLowerCase() : null,
    job_title: job_title ? String(job_title).trim() : null,
    phone: phone ? String(phone).trim() : null,
    is_active: true,
    created_at: now,
    updated_at: now
  };
  db.employees.push(newEmp);
  saveDb();

  logAudit(user.organization_id, user.id, 'employee.create', 'employee', newEmp.id, {
    full_name: newEmp.full_name,
    employee_number: newEmp.employee_number
  });

  res.status(201).json(newEmp);
});

app.patch('/api/v1/employees/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const empId = parseInt(req.params.id, 10);
  const emp = db.employees.find(e => e.id === empId && e.organization_id === user.organization_id);
  if (!emp) {
    return res.status(404).json({ detail: 'Сотрудник не найден' });
  }
  const { expected_version, employee_number, full_name, department_id, email, job_title, phone, is_active } = req.body;
  if (typeof expected_version !== 'number') {
    return res.status(422).json({ detail: 'expected_version обязателен' });
  }
  if (emp.version !== expected_version) {
    return res.status(409).json({ detail: 'Конфликт версий записи' });
  }

  const nextNum = employee_number !== undefined ? String(employee_number).trim() : emp.employee_number;
  const nextName = full_name !== undefined ? String(full_name).trim() : emp.full_name;
  if (!nextNum || !nextName) {
    return res.status(422).json({ detail: 'Табельный номер и ФИО не могут быть пустыми' });
  }
  if (db.employees.some(e => e.id !== emp.id && e.organization_id === user.organization_id && e.employee_number.toLowerCase() === nextNum.toLowerCase())) {
    return res.status(409).json({ detail: 'Сотрудник с таким табельным номером уже существует' });
  }
  const nextDeptId = department_id !== undefined ? (department_id ? Number(department_id) : null) : emp.department_id;
  if (nextDeptId !== null && !db.departments.some(d => d.id === nextDeptId && d.organization_id === user.organization_id)) {
    return res.status(422).json({ detail: 'Подразделение должно принадлежать вашей организации' });
  }
  const nextEmail = email !== undefined ? (email ? String(email).trim().toLowerCase() : null) : emp.email;
  const nextJob = job_title !== undefined ? (job_title ? String(job_title).trim() : null) : emp.job_title;
  const nextPhone = phone !== undefined ? (phone ? String(phone).trim() : null) : emp.phone;
  const nextActive = is_active !== undefined ? Boolean(is_active) : emp.is_active;

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (nextNum !== emp.employee_number) { changes.employee_number = { old: emp.employee_number, new: nextNum }; emp.employee_number = nextNum; }
  if (nextName !== emp.full_name) { changes.full_name = { old: emp.full_name, new: nextName }; emp.full_name = nextName; }
  if (nextDeptId !== emp.department_id) { changes.department_id = { old: emp.department_id, new: nextDeptId }; emp.department_id = nextDeptId; }
  if (nextEmail !== emp.email) { changes.email = { old: emp.email, new: nextEmail }; emp.email = nextEmail; }
  if (nextJob !== emp.job_title) { changes.job_title = { old: emp.job_title, new: nextJob }; emp.job_title = nextJob; }
  if (nextPhone !== emp.phone) { changes.phone = { old: emp.phone, new: nextPhone }; emp.phone = nextPhone; }
  if (nextActive !== emp.is_active) { changes.is_active = { old: emp.is_active, new: nextActive }; emp.is_active = nextActive; }

  if (Object.keys(changes).length === 0) {
    return res.json(emp);
  }

  emp.version += 1;
  emp.updated_at = new Date().toISOString();
  saveDb();

  logAudit(user.organization_id, user.id, 'employee.update', 'employee', emp.id, { changes });

  res.json(emp);
});

app.delete('/api/v1/employees/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может удалять сотрудников' });
  }
  const empId = parseInt(req.params.id, 10);
  const index = db.employees.findIndex(e => e.id === empId && e.organization_id === user.organization_id);
  if (index === -1) {
    return res.status(404).json({ detail: 'Сотрудник не найден' });
  }
  const [deleted] = db.employees.splice(index, 1);
  saveDb();

  logAudit(user.organization_id, user.id, 'employee.delete', 'employee', deleted.id, {
    full_name: deleted.full_name
  });

  res.status(204).end();
});

// Assets Management
function csvSpreadsheetSafe(val: unknown): string {
  if (val === null || val === undefined) return '""';
  let s = String(val);
  if (/^[=+\-@]/.test(s.replace(/^[ \t\r\n]+/, '')) || /^[\t\r\n]/.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

app.get('/api/v1/assets', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  const parsedOffset = parseInt((req.query.offset as string) || '0', 10);
  const offset = Number.isNaN(parsedOffset) || parsedOffset < 0 ? 0 : parsedOffset;
  const parsedLimit = parseInt((req.query.limit as string) || '200', 10);
  const limit = Number.isNaN(parsedLimit) ? 200 : Math.min(200, Math.max(1, parsedLimit));

  let list = db.assets.filter(a => a.organization_id === user.organization_id);
  if (search) {
    list = list.filter(a =>
      a.name.toLowerCase().includes(search) ||
      a.asset_tag.toLowerCase().includes(search) ||
      (a.model && a.model.toLowerCase().includes(search)) ||
      (a.serial_number && a.serial_number.toLowerCase().includes(search)) ||
      (a.assigned_to && a.assigned_to.toLowerCase().includes(search)) ||
      a.category.toLowerCase().includes(search)
    );
  }
  res.json(list.slice(offset, offset + limit));
});

app.post('/api/v1/assets', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const { name, asset_tag, category, manufacturer, model, serial_number, assigned_to, status } = req.body || {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanTag = typeof asset_tag === 'string' ? asset_tag.trim() : '';
  const cleanCategory = typeof category === 'string' ? category.trim() : '';
  if (!cleanName || !cleanTag || !cleanCategory) {
    return res.status(422).json({ detail: 'Название, инвентарный номер и категория обязательны' });
  }
  const nextStatus: AssetStatus = status || 'active';
  if (!['active', 'in_repair', 'retired'].includes(nextStatus)) {
    return res.status(422).json({ detail: 'Недопустимый статус оборудования' });
  }

  if (db.assets.some(a => a.organization_id === user.organization_id && a.asset_tag.toLowerCase() === cleanTag.toLowerCase())) {
    return res.status(409).json({ detail: 'Оборудование с таким инвентарным номером уже существует' });
  }
  const entitlements = getOrgEntitlements(user.organization_id);
  if (entitlements.limits.max_assets !== null && entitlements.usage.assets >= entitlements.limits.max_assets) {
    return res.status(403).json({
      code: 'edition_quota_exceeded',
      detail: `Достигнут лимит активов для ${entitlements.edition_label} (${entitlements.limits.max_assets}). Активируйте коммерческую лицензию для расширения квоты.`
    });
  }

  db.counters.asset += 1;
  const now = new Date().toISOString();
  const newAsset: Asset = {
    id: db.counters.asset,
    organization_id: user.organization_id,
    name: cleanName,
    asset_tag: cleanTag,
    category: cleanCategory,
    manufacturer: manufacturer ? String(manufacturer).trim() : null,
    model: model ? String(model).trim() : null,
    serial_number: serial_number ? String(serial_number).trim() : null,
    assigned_to: assigned_to ? String(assigned_to).trim() : null,
    status: nextStatus,
    created_at: now,
    updated_at: now,
    version: 1
  };
  db.assets.push(newAsset);
  saveDb();

  logAudit(user.organization_id, user.id, 'asset.created', 'asset', newAsset.id, {
    name: newAsset.name,
    asset_tag: newAsset.asset_tag,
    category: newAsset.category,
    status: newAsset.status
  });

  res.status(201).json(newAsset);
});

app.get('/api/v1/assets/export', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const list = db.assets.filter(a => a.organization_id === user.organization_id);

  const header = ['name', 'asset_tag', 'category', 'manufacturer', 'model', 'serial_number', 'assigned_to', 'status'];
  const rows = list.map(a => [
    csvSpreadsheetSafe(a.name),
    csvSpreadsheetSafe(a.asset_tag),
    csvSpreadsheetSafe(a.category),
    csvSpreadsheetSafe(a.manufacturer || ''),
    csvSpreadsheetSafe(a.model || ''),
    csvSpreadsheetSafe(a.serial_number || ''),
    csvSpreadsheetSafe(a.assigned_to || ''),
    csvSpreadsheetSafe(a.status)
  ].join(','));

  const csv = [header.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="assets.csv"');
  res.send(csv);
});

const MAX_ASSET_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_IMPORT_ROWS = 5000;

app.post('/api/v1/assets/import', authenticate, upload.single('file'), (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ detail: 'Файл не загружен' });
  }
  if (req.file.buffer.length > MAX_ASSET_IMPORT_BYTES) {
    return res.status(422).json({ detail: 'Размер CSV-файла превышает 2 МБ' });
  }

  const content = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    return res.json({ created: 0, skipped: 0, errors: [] });
  }
  if (lines.length - 1 > MAX_ASSET_IMPORT_ROWS) {
    return res.status(422).json({ detail: `CSV не может содержать более ${MAX_ASSET_IMPORT_ROWS} строк` });
  }

  const headers = lines[0].split(',').map(h => h.replace(/^["']|["']$/g, '').trim());
  let created = 0;
  let skipped = 0;
  const errors: { row: number; error: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const cells: string[] = [];
    let insideQuotes = false;
    let currentCell = '';
    for (let charIdx = 0; charIdx < rawLine.length; charIdx++) {
      const ch = rawLine[charIdx];
      if (ch === '"') {
        insideQuotes = !insideQuotes;
      } else if (ch === ',' && !insideQuotes) {
        cells.push(currentCell.trim());
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
    cells.push(currentCell.trim());

    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      let val = cells[idx] || '';
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/""/g, '"');
      }
      record[h] = val;
    });

    const name = (record.name || '').trim();
    const asset_tag = (record.asset_tag || '').trim();
    const category = (record.category || 'Компьютер').trim();
    const rowStatus = (record.status || 'active').trim() as AssetStatus;

    if (!name || !asset_tag) {
      errors.push({ row: i + 1, error: 'Отсутствует name или asset_tag' });
      continue;
    }
    if (!['active', 'in_repair', 'retired'].includes(rowStatus)) {
      errors.push({ row: i + 1, error: `Недопустимый статус: ${rowStatus}` });
      continue;
    }

    if (db.assets.some(a => a.organization_id === user.organization_id && a.asset_tag.toLowerCase() === asset_tag.toLowerCase())) {
      skipped += 1;
      continue;
    }

    const impEntitlements = getOrgEntitlements(user.organization_id);
    if (impEntitlements.limits.max_assets !== null && impEntitlements.usage.assets >= impEntitlements.limits.max_assets) {
      errors.push({ row: i + 1, error: `Превышен лимит активов редакции (${impEntitlements.limits.max_assets})` });
      continue;
    }

    db.counters.asset += 1;
    const now = new Date().toISOString();
    const newAsset: Asset = {
      id: db.counters.asset,
      organization_id: user.organization_id,
      name,
      asset_tag,
      category,
      manufacturer: record.manufacturer?.trim() || null,
      model: record.model?.trim() || null,
      serial_number: record.serial_number?.trim() || null,
      assigned_to: record.assigned_to?.trim() || null,
      status: rowStatus,
      created_at: now,
      updated_at: now,
      version: 1
    };
    db.assets.push(newAsset);
    created += 1;

    logAudit(user.organization_id, user.id, 'asset.imported', 'asset', newAsset.id, {
      name: newAsset.name,
      asset_tag: newAsset.asset_tag
    });
  }

  logAudit(user.organization_id, user.id, 'asset.import', 'asset', 'batch', {
    created,
    skipped,
    errors: errors.length
  });
  saveDb();
  res.json({ created, skipped, errors });
});

app.patch('/api/v1/assets/bulk', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }

  const { asset_ids, versions, status, assigned_to } = req.body || {};
  if (!Array.isArray(asset_ids) || asset_ids.length === 0 || asset_ids.length > 100) {
    return res.status(422).json({ detail: 'Укажите от 1 до 100 уникальных идентификаторов активов' });
  }
  const uniqueIds = Array.from(new Set(asset_ids));
  if (uniqueIds.length !== asset_ids.length || uniqueIds.some(id => !Number.isInteger(id) || id <= 0)) {
    return res.status(422).json({ detail: 'asset_ids должен содержать уникальные положительные целые числа' });
  }
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
    return res.status(422).json({ detail: 'Поле versions обязательно' });
  }
  if (status === undefined && assigned_to === undefined) {
    return res.status(422).json({ detail: 'Укажите status или assigned_to для массового обновления' });
  }
  if (status !== undefined && !['active', 'in_repair', 'retired'].includes(status)) {
    return res.status(422).json({ detail: 'Недопустимый статус оборудования' });
  }

  const targetAssets: Asset[] = [];
  for (const id of uniqueIds) {
    const asset = db.assets.find(a => a.id === id && a.organization_id === user.organization_id);
    if (!asset) {
      return res.status(404).json({ detail: 'Один или несколько активов не найдены в организации' });
    }
    targetAssets.push(asset);
  }

  for (const asset of targetAssets) {
    const expected = versions[asset.id] ?? versions[String(asset.id)];
    if (typeof expected !== 'number' || expected !== asset.version) {
      return res.status(409).json({ detail: 'Один или несколько активов были изменены. Обновите список и повторите.' });
    }
  }

  const nextAssignedTo = assigned_to === undefined
    ? undefined
    : (assigned_to === null ? null : (String(assigned_to).trim() || null));

  let updatedCount = 0;
  for (const asset of targetAssets) {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (status !== undefined && status !== asset.status) {
      changes.status = { old: asset.status, new: status };
      asset.status = status;
    }
    if (nextAssignedTo !== undefined && nextAssignedTo !== asset.assigned_to) {
      changes.assigned_to = { old: asset.assigned_to, new: nextAssignedTo };
      asset.assigned_to = nextAssignedTo;
    }

    if (Object.keys(changes).length > 0) {
      asset.version += 1;
      asset.updated_at = new Date().toISOString();
      updatedCount += 1;
      logAudit(user.organization_id, user.id, 'asset.updated', 'asset', asset.id, { changes, source: 'bulk' });
    }
  }

  if (updatedCount > 0) {
    saveDb();
  }
  res.json({
    selected: targetAssets.length,
    updated: updatedCount,
    assets: targetAssets
  });
});

app.get('/api/v1/assets/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const assetId = parseInt(req.params.id, 10);
  const asset = db.assets.find(a => a.id === assetId && a.organization_id === user.organization_id);
  if (!asset) {
    return res.status(404).json({ detail: 'Оборудование не найдено' });
  }
  res.json(asset);
});

app.patch('/api/v1/assets/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const assetId = parseInt(req.params.id, 10);
  const asset = db.assets.find(a => a.id === assetId && a.organization_id === user.organization_id);
  if (!asset) {
    return res.status(404).json({ detail: 'Оборудование не найдено' });
  }

  const { expected_version, name, asset_tag, category, manufacturer, model, serial_number, assigned_to, status } = req.body;
  if (typeof expected_version !== 'number') {
    return res.status(422).json({ detail: 'expected_version обязателен' });
  }
  if (asset.version !== expected_version) {
    return res.status(409).json({ detail: 'Конфликт версий записи. Запись была изменена другим пользователем.' });
  }

  if ((name !== undefined && !String(name).trim()) || (category !== undefined && !String(category).trim())) {
    return res.status(422).json({ detail: 'Название и категория не могут быть пустыми' });
  }
  if (asset_tag !== undefined && db.assets.some(a => a.id !== asset.id && a.organization_id === user.organization_id && a.asset_tag.toLowerCase() === String(asset_tag).trim().toLowerCase())) {
    return res.status(409).json({ detail: 'Оборудование с таким инвентарным номером уже существует' });
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (name !== undefined && String(name).trim() !== asset.name) {
    changes.name = { old: asset.name, new: String(name).trim() };
    asset.name = String(name).trim();
  }
  if (asset_tag !== undefined && String(asset_tag).trim() !== asset.asset_tag) {
    changes.asset_tag = { old: asset.asset_tag, new: String(asset_tag).trim() };
    asset.asset_tag = String(asset_tag).trim();
  }
  if (category !== undefined && String(category).trim() !== asset.category) {
    changes.category = { old: asset.category, new: String(category).trim() };
    asset.category = String(category).trim();
  }
  if (manufacturer !== undefined && manufacturer !== asset.manufacturer) {
    changes.manufacturer = { old: asset.manufacturer, new: manufacturer };
    asset.manufacturer = manufacturer;
  }
  if (model !== undefined && model !== asset.model) {
    changes.model = { old: asset.model, new: model };
    asset.model = model;
  }
  if (serial_number !== undefined && serial_number !== asset.serial_number) {
    changes.serial_number = { old: asset.serial_number, new: serial_number };
    asset.serial_number = serial_number;
  }
  if (assigned_to !== undefined && assigned_to !== asset.assigned_to) {
    changes.assigned_to = { old: asset.assigned_to, new: assigned_to };
    asset.assigned_to = assigned_to;
  }
  if (status !== undefined && status !== asset.status) {
    changes.status = { old: asset.status, new: status };
    asset.status = status;
  }

  if (Object.keys(changes).length === 0) {
    return res.json(asset);
  }

  asset.version += 1;
  asset.updated_at = new Date().toISOString();
  saveDb();

  logAudit(user.organization_id, user.id, 'asset.updated', 'asset', asset.id, { changes });

  res.json(asset);
});

app.get('/api/v1/assets/:id/history', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const assetId = req.params.id;
  const events = db.auditEvents
    .filter(e => e.organization_id === user.organization_id && e.entity_type === 'asset' && e.entity_id === assetId)
    .map(e => ({
      id: e.id,
      actor_user_id: e.actor_user_id,
      action: e.action,
      details: e.details,
      created_at: e.created_at
    }));
  res.json(events);
});

app.delete('/api/v1/assets/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав для удаления оборудования' });
  }
  const assetId = parseInt(req.params.id, 10);
  const index = db.assets.findIndex(a => a.id === assetId && a.organization_id === user.organization_id);
  if (index === -1) {
    return res.status(404).json({ detail: 'Оборудование не найдено' });
  }
  const hasMaintenance = db.maintenanceRequests.some(m => m.asset_id === assetId && m.organization_id === user.organization_id);
  if (hasMaintenance) {
    return res.status(409).json({ detail: 'Asset is referenced by maintenance requests and cannot be deleted' });
  }
  const [deleted] = db.assets.splice(index, 1);
  saveDb();

  logAudit(user.organization_id, user.id, 'asset.deleted', 'asset', deleted.id, {
    name: deleted.name,
    asset_tag: deleted.asset_tag
  });

  res.status(204).end();
});

// Maintenance Requests Management
app.get('/api/v1/maintenance-requests', authenticate, (req, res) => {
  const user = (req as any).user as User;
  let list = db.maintenanceRequests.filter(m => m.organization_id === user.organization_id);
  if (user.role === 'viewer') {
    list = list.filter(m => m.requested_by_user_id === user.id);
  }
  res.json(list);
});

app.post('/api/v1/maintenance-requests', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const { asset_id, title, description, priority } = req.body;
  const parsedAssetId = parseInt(asset_id, 10);
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  const cleanDescription = typeof description === 'string' ? description.trim() : '';
  if (!parsedAssetId || !cleanTitle || !cleanDescription) {
    return res.status(422).json({ detail: 'Укажите оборудование, тему и описание заявки' });
  }
  const targetAsset = db.assets.find(a => a.id === parsedAssetId && a.organization_id === user.organization_id);
  if (!targetAsset) {
    return res.status(404).json({ detail: 'Оборудование не найдено' });
  }

  db.counters.maintenance += 1;
  const now = new Date().toISOString();
  const newReq: MaintenanceRequest = {
    id: db.counters.maintenance,
    organization_id: user.organization_id,
    asset_id: targetAsset.id,
    requested_by_user_id: user.id,
    assigned_to_user_id: null,
    title: cleanTitle,
    description: cleanDescription,
    priority: priority || 'normal',
    status: 'open',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    version: 1
  };
  db.maintenanceRequests.push(newReq);
  saveDb();

  logAudit(user.organization_id, user.id, 'maintenance.created', 'maintenance_request', newReq.id, {
    asset_id: newReq.asset_id,
    priority: newReq.priority
  });

  res.status(201).json(newReq);
});

app.get('/api/v1/maintenance-requests/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const reqId = parseInt(req.params.id, 10);
  const item = db.maintenanceRequests.find(m => m.id === reqId && m.organization_id === user.organization_id);
  if (!item || (user.role === 'viewer' && item.requested_by_user_id !== user.id)) {
    return res.status(404).json({ detail: 'Заявка не найдена' });
  }
  res.json(item);
});

app.patch('/api/v1/maintenance-requests/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const reqId = parseInt(req.params.id, 10);
  const item = db.maintenanceRequests.find(m => m.id === reqId && m.organization_id === user.organization_id);
  if (!item) {
    return res.status(404).json({ detail: 'Заявка не найдена' });
  }

  const { expected_version, title, description, priority, status, assigned_to_user_id } = req.body;
  if (typeof expected_version !== 'number') {
    return res.status(422).json({ detail: 'expected_version обязателен' });
  }
  if (item.version !== expected_version) {
    return res.status(409).json({ detail: 'Конфликт версий заявки' });
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (title !== undefined) {
    const cleanTitle = String(title).trim();
    if (!cleanTitle) return res.status(422).json({ detail: 'Тема заявки не может быть пустой' });
    if (cleanTitle !== item.title) {
      changes.title = { old: item.title, new: cleanTitle };
      item.title = cleanTitle;
    }
  }
  if (description !== undefined) {
    const cleanDesc = String(description).trim();
    if (!cleanDesc) return res.status(422).json({ detail: 'Описание заявки не может быть пустым' });
    if (cleanDesc !== item.description) {
      changes.description = { old: item.description, new: cleanDesc };
      item.description = cleanDesc;
    }
  }
  if (priority !== undefined && priority !== item.priority) {
    changes.priority = { old: item.priority, new: priority };
    item.priority = priority;
  }
  if (status !== undefined && status !== item.status) {
    changes.status = { old: item.status, new: status };
    item.status = status;
    if (status === 'resolved' && !item.resolved_at) {
      item.resolved_at = new Date().toISOString();
    } else if (status !== 'resolved') {
      item.resolved_at = null;
    }
  }
  if (assigned_to_user_id !== undefined) {
    const nextAssignee = assigned_to_user_id ? parseInt(assigned_to_user_id, 10) : null;
    if (nextAssignee !== null) {
      const targetTech = db.users.find(u => u.id === nextAssignee && u.organization_id === user.organization_id && u.is_active);
      if (!targetTech) {
        return res.status(422).json({ detail: 'Указанный исполнитель не найден или неактивен' });
      }
    }
    if (nextAssignee !== item.assigned_to_user_id) {
      changes.assigned_to_user_id = { old: item.assigned_to_user_id, new: nextAssignee };
      item.assigned_to_user_id = nextAssignee;
    }
  }

  if (Object.keys(changes).length === 0) {
    return res.json(item);
  }

  item.version += 1;
  item.updated_at = new Date().toISOString();
  saveDb();

  logAudit(user.organization_id, user.id, 'maintenance.updated', 'maintenance_request', item.id, { changes });

  res.json(item);
});

// Software Licenses Management
app.get('/api/v1/software-licenses', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  let list = db.softwareLicenses.filter(s => s.organization_id === user.organization_id);
  if (search) {
    list = list.filter(s =>
      s.name.toLowerCase().includes(search) ||
      (s.publisher && s.publisher.toLowerCase().includes(search)) ||
      (s.license_reference && s.license_reference.toLowerCase().includes(search))
    );
  }
  res.json(list);
});

app.post('/api/v1/software-licenses', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const { name, publisher, version, license_type, license_reference, seats_total, seats_used, purchased_at, expires_at, status, notes } = req.body;
  if (!name || !license_type || typeof seats_total !== 'number') {
    return res.status(400).json({ detail: 'Название, тип лицензии и количество мест обязательны' });
  }

  if (seats_total < 1 || (seats_used !== undefined && (seats_used < 0 || seats_used > seats_total))) {
    return res.status(422).json({ detail: 'Seats used cannot exceed total seats (seats_used <= seats_total) and total seats must be >= 1' });
  }
  if (purchased_at && expires_at && expires_at < purchased_at) {
    return res.status(422).json({ detail: 'expires_at cannot be earlier than purchased_at' });
  }
  const licEntitlements = getOrgEntitlements(user.organization_id);
  if (licEntitlements.limits.max_software_licenses !== null && licEntitlements.usage.software_licenses >= licEntitlements.limits.max_software_licenses) {
    return res.status(403).json({
      code: 'edition_quota_exceeded',
      detail: `Достигнут лимит лицензий ПО для ${licEntitlements.edition_label} (${licEntitlements.limits.max_software_licenses}).`
    });
  }

  db.counters.software += 1;
  const now = new Date().toISOString();
  const newLic: SoftwareLicense = {
    id: db.counters.software,
    organization_id: user.organization_id,
    name: name.trim(),
    publisher: publisher ? publisher.trim() : null,
    version: version ? version.trim() : null,
    license_type,
    license_reference: license_reference ? license_reference.trim() : null,
    seats_total,
    seats_used: seats_used || 0,
    purchased_at: purchased_at || null,
    expires_at: expires_at || null,
    status: status || 'active',
    notes: notes ? notes.trim() : null,
    created_at: now,
    updated_at: now,
    record_version: 1
  };
  db.softwareLicenses.push(newLic);
  saveDb();

  logAudit(user.organization_id, user.id, 'software.created', 'software_license', newLic.id, {
    name: newLic.name,
    license_type: newLic.license_type,
    seats_total: newLic.seats_total
  });

  res.status(201).json(newLic);
});

app.get('/api/v1/software-licenses/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const licId = parseInt(req.params.id, 10);
  const lic = db.softwareLicenses.find(s => s.id === licId && s.organization_id === user.organization_id);
  if (!lic) {
    return res.status(404).json({ detail: 'Лицензия не найдена' });
  }
  res.json(lic);
});

app.patch('/api/v1/software-licenses/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const licId = parseInt(req.params.id, 10);
  const lic = db.softwareLicenses.find(s => s.id === licId && s.organization_id === user.organization_id);
  if (!lic) {
    return res.status(404).json({ detail: 'Лицензия не найдена' });
  }

  const { expected_version, name, publisher, version, license_type, license_reference, seats_total, seats_used, purchased_at, expires_at, status, notes } = req.body;
  if (typeof expected_version !== 'number') {
    return res.status(422).json({ detail: 'expected_version обязателен' });
  }
  if (lic.record_version !== expected_version) {
    return res.status(409).json({ detail: 'Конфликт версий записи' });
  }

  const newSeatsTotal = seats_total !== undefined ? Number(seats_total) : lic.seats_total;
  const newSeatsUsed = seats_used !== undefined ? Number(seats_used) : lic.seats_used;
  if (newSeatsTotal < 1 || newSeatsUsed < 0 || newSeatsUsed > newSeatsTotal) {
    return res.status(422).json({ detail: 'Seats used cannot exceed total seats (seats_used <= seats_total)' });
  }
  const nextPurchasedAt = purchased_at !== undefined ? (purchased_at || null) : lic.purchased_at;
  const nextExpiresAt = expires_at !== undefined ? (expires_at || null) : lic.expires_at;
  if (nextPurchasedAt && nextExpiresAt && nextExpiresAt < nextPurchasedAt) {
    return res.status(422).json({ detail: 'expires_at cannot be earlier than purchased_at' });
  }

  const nextName = name !== undefined ? String(name).trim() : lic.name;
  if (!nextName) {
    return res.status(422).json({ detail: 'Название ПО не может быть пустым' });
  }
  const nextPublisher = publisher !== undefined ? (publisher ? String(publisher).trim() : null) : lic.publisher;
  const nextVersion = version !== undefined ? (version ? String(version).trim() : null) : lic.version;
  const nextType = license_type !== undefined ? license_type : lic.license_type;
  const nextRef = license_reference !== undefined ? (license_reference ? String(license_reference).trim() : null) : lic.license_reference;
  const nextStatus = status !== undefined ? status : lic.status;
  const nextNotes = notes !== undefined ? (notes ? String(notes).trim() : null) : lic.notes;

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (nextName !== lic.name) { changes.name = { old: lic.name, new: nextName }; lic.name = nextName; }
  if (nextPublisher !== lic.publisher) { changes.publisher = { old: lic.publisher, new: nextPublisher }; lic.publisher = nextPublisher; }
  if (nextVersion !== lic.version) { changes.version = { old: lic.version, new: nextVersion }; lic.version = nextVersion; }
  if (nextType !== lic.license_type) { changes.license_type = { old: lic.license_type, new: nextType }; lic.license_type = nextType; }
  if (nextRef !== lic.license_reference) { changes.license_reference = { old: lic.license_reference, new: nextRef }; lic.license_reference = nextRef; }
  if (newSeatsTotal !== lic.seats_total) { changes.seats_total = { old: lic.seats_total, new: newSeatsTotal }; lic.seats_total = newSeatsTotal; }
  if (newSeatsUsed !== lic.seats_used) { changes.seats_used = { old: lic.seats_used, new: newSeatsUsed }; lic.seats_used = newSeatsUsed; }
  if (nextPurchasedAt !== lic.purchased_at) { changes.purchased_at = { old: lic.purchased_at, new: nextPurchasedAt }; lic.purchased_at = nextPurchasedAt; }
  if (nextExpiresAt !== lic.expires_at) { changes.expires_at = { old: lic.expires_at, new: nextExpiresAt }; lic.expires_at = nextExpiresAt; }
  if (nextStatus !== lic.status) { changes.status = { old: lic.status, new: nextStatus }; lic.status = nextStatus; }
  if (nextNotes !== lic.notes) { changes.notes = { old: lic.notes, new: nextNotes }; lic.notes = nextNotes; }

  if (Object.keys(changes).length === 0) {
    return res.json(lic);
  }

  lic.record_version += 1;
  lic.updated_at = new Date().toISOString();
  saveDb();

  logAudit(user.organization_id, user.id, 'software.updated', 'software_license', lic.id, { changes });

  res.json(lic);
});

app.delete('/api/v1/software-licenses/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав для удаления лицензий' });
  }
  const licId = parseInt(req.params.id, 10);
  const index = db.softwareLicenses.findIndex(s => s.id === licId && s.organization_id === user.organization_id);
  if (index === -1) {
    return res.status(404).json({ detail: 'Лицензия не найдена' });
  }
  const [deleted] = db.softwareLicenses.splice(index, 1);
  saveDb();

  logAudit(user.organization_id, user.id, 'software.deleted', 'software_license', deleted.id, {
    name: deleted.name
  });

  res.status(204).end();
});

app.delete('/api/v1/maintenance-requests/:id', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const reqId = parseInt(req.params.id, 10);
  const index = db.maintenanceRequests.findIndex(m => m.id === reqId && m.organization_id === user.organization_id);
  if (index === -1) {
    return res.status(404).json({ detail: 'Заявка не найдена' });
  }
  const item = db.maintenanceRequests[index];
  if (user.role === 'viewer' && item.requested_by_user_id !== user.id) {
    return res.status(403).json({ detail: 'Вы можете удалять только созданные вами заявки' });
  }

  const [deleted] = db.maintenanceRequests.splice(index, 1);
  saveDb();

  logAudit(user.organization_id, user.id, 'maintenance.deleted', 'maintenance_request', deleted.id, {
    title: deleted.title
  });

  res.status(204).end();
});

// System Overview Stats
app.get('/api/v1/system/stats', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const orgId = user.organization_id;

  const assets = db.assets.filter(a => a.organization_id === orgId);
  const activeAssets = assets.filter(a => a.status === 'active').length;
  const inRepairAssets = assets.filter(a => a.status === 'in_repair').length;
  const retiredAssets = assets.filter(a => a.status === 'retired').length;

  const byCategory: Record<string, number> = {};
  assets.forEach(a => {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  });

  const licenses = db.softwareLicenses.filter(s => s.organization_id === orgId);
  const totalSeats = licenses.reduce((sum, l) => sum + (l.seats_total || 0), 0);
  const usedSeats = licenses.reduce((sum, l) => sum + (l.seats_used || 0), 0);
  const now = new Date();
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const expiringSoon = licenses.filter(l => {
    if (!l.expires_at) return false;
    const exp = new Date(l.expires_at);
    return exp <= in60Days && l.status === 'active';
  }).length;

  const maintenance = db.maintenanceRequests.filter(m => m.organization_id === orgId);
  const openMaint = maintenance.filter(m => m.status === 'open').length;
  const inProgressMaint = maintenance.filter(m => m.status === 'in_progress').length;
  const resolvedMaint = maintenance.filter(m => m.status === 'resolved').length;
  const urgentOrHighMaint = maintenance.filter(m => (m.priority === 'urgent' || m.priority === 'high') && m.status !== 'resolved').length;

  const employees = db.employees.filter(e => e.organization_id === orgId);
  const assignedNames = new Set(assets.map(a => a.assigned_to).filter(Boolean));
  const employeesWithAssets = employees.filter(e => assignedNames.has(e.full_name)).length;

  const departments = db.departments.filter(d => d.organization_id === orgId);
  const users = db.users.filter(u => u.organization_id === orgId);

  res.json({
    assets: {
      total: assets.length,
      active: activeAssets,
      in_repair: inRepairAssets,
      retired: retiredAssets,
      by_category: byCategory
    },
    software: {
      total_licenses: licenses.length,
      total_seats: totalSeats,
      used_seats: usedSeats,
      utilization_rate: totalSeats > 0 ? Math.round((usedSeats / totalSeats) * 100) : 0,
      expiring_soon: expiringSoon
    },
    maintenance: {
      total: maintenance.length,
      open: openMaint,
      in_progress: inProgressMaint,
      resolved: resolvedMaint,
      urgent_or_high: urgentOrHighMaint
    },
    employees: {
      total: employees.length,
      active: employees.filter(e => e.is_active).length,
      with_assets: employeesWithAssets
    },
    departments: {
      total: departments.length
    },
    users: {
      total: users.length,
      admins: users.filter(u => u.role === 'admin').length,
      editors: users.filter(u => u.role === 'editor').length,
      viewers: users.filter(u => u.role === 'viewer').length
    }
  });
});

// System Backup, Integrity Verification & Restore (Phase 2)
function computeBackupDigest(payload: Record<string, unknown>): string {
  const canonical = {
    schema_version: payload.schema_version ?? '1.0',
    exported_at: payload.exported_at ?? null,
    organization: payload.organization ?? null,
    departments: Array.isArray(payload.departments) ? payload.departments : [],
    employees: Array.isArray(payload.employees) ? payload.employees : [],
    assets: Array.isArray(payload.assets) ? payload.assets : [],
    software_licenses: Array.isArray(payload.software_licenses) ? payload.software_licenses : [],
    maintenance_requests: Array.isArray(payload.maintenance_requests) ? payload.maintenance_requests : [],
    audit_events: Array.isArray(payload.audit_events) ? payload.audit_events : [],
    recovery_drills: Array.isArray(payload.recovery_drills) ? payload.recovery_drills : []
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function validateAndVerifyBackupPayload(data: any) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Некорректный файл резервной копии: ожидается JSON-объект');
  }
  const collectionKeys = [
    'departments',
    'employees',
    'assets',
    'software_licenses',
    'maintenance_requests',
    'audit_events',
    'recovery_drills'
  ] as const;

  const hasKnownStructure = Boolean(data.schema_version || data.organization || collectionKeys.some(k => Array.isArray(data[k])));
  if (!hasKnownStructure) {
    throw new Error('Файл не содержит валидной структуры резервной копии ECC');
  }

  for (const key of collectionKeys) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new Error(`Поле ${key} должно быть массивом`);
    }
    if (Array.isArray(data[key])) {
      for (let i = 0; i < data[key].length; i++) {
        const item = data[key][i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'number') {
          throw new Error(`Некорректная запись в ${key}[${i}]`);
        }
      }
    }
  }

  const computedDigest = computeBackupDigest(data);
  let checksumStatus: 'verified' | 'not_present' = 'not_present';
  if (data.integrity !== undefined) {
    if (
      !data.integrity ||
      typeof data.integrity !== 'object' ||
      data.integrity.algorithm !== 'sha256' ||
      typeof data.integrity.digest !== 'string'
    ) {
      throw new Error('Некорректный блок integrity в файле резервной копии');
    }
    const providedBuf = Buffer.from(data.integrity.digest.toLowerCase(), 'utf-8');
    const expectedBuf = Buffer.from(computedDigest.toLowerCase(), 'utf-8');
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      throw new Error('Нарушена контрольная сумма резервной копии (SHA-256 mismatch): файл повреждён или изменён');
    }
    checksumStatus = 'verified';
  }

  return {
    schema_version: String(data.schema_version || '1.0'),
    exported_at: typeof data.exported_at === 'string' ? data.exported_at : null,
    checksum_status: checksumStatus,
    sha256_digest: computedDigest,
    counts: {
      departments: Array.isArray(data.departments) ? data.departments.length : 0,
      employees: Array.isArray(data.employees) ? data.employees.length : 0,
      assets: Array.isArray(data.assets) ? data.assets.length : 0,
      software_licenses: Array.isArray(data.software_licenses) ? data.software_licenses.length : 0,
      maintenance_requests: Array.isArray(data.maintenance_requests) ? data.maintenance_requests.length : 0,
      audit_events: Array.isArray(data.audit_events) ? data.audit_events.length : 0,
      recovery_drills: Array.isArray(data.recovery_drills) ? data.recovery_drills.length : 0
    }
  };
}

app.get('/api/v1/system/backup', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может создавать резервную копию' });
  }

  const orgId = user.organization_id;
  const org = db.organizations.find(o => o.id === orgId);
  const basePayload = {
    schema_version: '1.0',
    exported_at: new Date().toISOString(),
    organization: org,
    departments: db.departments.filter(d => d.organization_id === orgId),
    employees: db.employees.filter(e => e.organization_id === orgId),
    assets: db.assets.filter(a => a.organization_id === orgId),
    software_licenses: db.softwareLicenses.filter(s => s.organization_id === orgId),
    maintenance_requests: db.maintenanceRequests.filter(m => m.organization_id === orgId),
    audit_events: db.auditEvents.filter(a => a.organization_id === orgId),
    recovery_drills: (db.recoveryDrills || []).filter(r => r.organization_id === orgId)
  };
  const digest = computeBackupDigest(basePayload);
  const backupData = {
    ...basePayload,
    integrity: {
      algorithm: 'sha256' as const,
      digest
    }
  };

  logAudit(orgId, user.id, 'system.backup', 'system', orgId, { timestamp: backupData.exported_at, sha256: digest });

  const filename = `ecc-backup-${org ? org.name.replace(/\s+/g, '_') : 'org'}-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-ECC-Backup-SHA256', digest);
  res.send(JSON.stringify(backupData, null, 2));
});

app.post('/api/v1/system/backup/verify', authenticate, upload.single('file'), (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может проверять резервные копии' });
  }

  let data: any;
  try {
    if (req.file && req.file.buffer) {
      data = JSON.parse(req.file.buffer.toString('utf-8'));
    } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      data = req.body;
    } else {
      return res.status(400).json({ detail: 'Файл резервной копии не передан' });
    }
  } catch {
    return res.status(400).json({ detail: 'Неверный формат JSON резервной копии' });
  }

  try {
    const summary = validateAndVerifyBackupPayload(data);
    return res.json({ valid: true, ...summary });
  } catch (err) {
    return res.status(422).json({ detail: err instanceof Error ? err.message : 'Ошибка проверки резервной копии' });
  }
});

app.post('/api/v1/system/restore', authenticate, upload.single('file'), (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может восстанавливать систему из резервной копии' });
  }

  let data: any;
  try {
    if (req.file && req.file.buffer) {
      data = JSON.parse(req.file.buffer.toString('utf-8'));
    } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      data = req.body;
    } else {
      return res.status(400).json({ detail: 'Файл резервной копии не передан' });
    }
  } catch {
    return res.status(400).json({ detail: 'Неверный формат JSON резервной копии' });
  }

  let verification: ReturnType<typeof validateAndVerifyBackupPayload>;
  try {
    verification = validateAndVerifyBackupPayload(data);
  } catch (err) {
    return res.status(422).json({ detail: err instanceof Error ? err.message : 'Некорректная резервная копия' });
  }

  const orgId = user.organization_id;
  if (Array.isArray(data.departments)) {
    db.departments = db.departments.filter(d => d.organization_id !== orgId).concat(data.departments.map((d: any) => ({ ...d, organization_id: orgId })));
    db.counters.department = Math.max(db.counters.department, ...db.departments.map(d => d.id), 0);
  }
  if (Array.isArray(data.employees)) {
    db.employees = db.employees.filter(e => e.organization_id !== orgId).concat(data.employees.map((e: any) => ({ ...e, organization_id: orgId })));
    db.counters.employee = Math.max(db.counters.employee, ...db.employees.map(e => e.id), 0);
  }
  if (Array.isArray(data.assets)) {
    db.assets = db.assets.filter(a => a.organization_id !== orgId).concat(data.assets.map((a: any) => ({ ...a, organization_id: orgId })));
    db.counters.asset = Math.max(db.counters.asset, ...db.assets.map(a => a.id), 0);
  }
  if (Array.isArray(data.software_licenses)) {
    db.softwareLicenses = db.softwareLicenses.filter(s => s.organization_id !== orgId).concat(data.software_licenses.map((s: any) => ({ ...s, organization_id: orgId })));
    db.counters.software = Math.max(db.counters.software, ...db.softwareLicenses.map(s => s.id), 0);
  }
  if (Array.isArray(data.maintenance_requests)) {
    db.maintenanceRequests = db.maintenanceRequests.filter(m => m.organization_id !== orgId).concat(data.maintenance_requests.map((m: any) => ({ ...m, organization_id: orgId })));
    db.counters.maintenance = Math.max(db.counters.maintenance, ...db.maintenanceRequests.map(m => m.id), 0);
  }
  if (Array.isArray(data.audit_events)) {
    db.auditEvents = db.auditEvents.filter(a => a.organization_id !== orgId).concat(data.audit_events.map((a: any) => ({ ...a, organization_id: orgId })));
    db.counters.audit = Math.max(db.counters.audit, ...db.auditEvents.map(a => a.id), 0);
  }
  if (Array.isArray(data.recovery_drills)) {
    db.recoveryDrills = (db.recoveryDrills || []).filter(r => r.organization_id !== orgId).concat(data.recovery_drills.map((r: any) => ({ ...r, organization_id: orgId })));
    db.counters.recoveryDrill = Math.max(db.counters.recoveryDrill || 0, ...db.recoveryDrills.map(r => r.id), 0);
  }

  saveDb();
  logAudit(orgId, user.id, 'system.restore', 'system', orgId, {
    restored_at: new Date().toISOString(),
    checksum_status: verification.checksum_status,
    sha256: verification.sha256_digest
  });

  res.json({ status: 'ok', detail: 'Данные успешно восстановлены из резервной копии', verification });
});

// Local Backup Snapshots & Retention (Phase 2 Backup Orchestration Parity)
function buildOrgBackupPayload(orgId: number) {
  const org = db.organizations.find(o => o.id === orgId);
  const basePayload = {
    schema_version: '1.0',
    exported_at: new Date().toISOString(),
    organization: org,
    departments: db.departments.filter(d => d.organization_id === orgId),
    employees: db.employees.filter(e => e.organization_id === orgId),
    assets: db.assets.filter(a => a.organization_id === orgId),
    software_licenses: db.softwareLicenses.filter(s => s.organization_id === orgId),
    maintenance_requests: db.maintenanceRequests.filter(m => m.organization_id === orgId),
    audit_events: db.auditEvents.filter(a => a.organization_id === orgId),
    recovery_drills: (db.recoveryDrills || []).filter(r => r.organization_id === orgId)
  };
  const digest = computeBackupDigest(basePayload);
  return {
    digest,
    backupData: {
      ...basePayload,
      integrity: {
        algorithm: 'sha256' as const,
        digest
      }
    }
  };
}

function isSafeOrgSnapshotFilename(filename: string, orgId: number): boolean {
  const prefix = `ecc-snapshot-org${orgId}-`;
  return (
    filename.startsWith(prefix) &&
    /^ecc-snapshot-org\d+-[0-9TZ-]+\.json$/.test(filename) &&
    !filename.includes('..') &&
    !filename.includes('/') &&
    !filename.includes('\\')
  );
}

function listOrgBackupSnapshots(orgId: number) {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter(f => isSafeOrgSnapshotFilename(f, orgId))
    .sort()
    .reverse();

  return files.map(filename => {
    const filePath = path.resolve(BACKUPS_DIR, filename);
    const sidecarPath = `${filePath}.sha256`;
    const stat = fs.statSync(filePath);
    let integrityStatus: 'verified' | 'corrupted' | 'missing_sidecar' = 'missing_sidecar';
    let sha256Digest = '';
    let exportedAt: string | null = null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      exportedAt = typeof parsed.exported_at === 'string' ? parsed.exported_at : null;
      const verified = validateAndVerifyBackupPayload(parsed);
      sha256Digest = verified.sha256_digest;
      if (fs.existsSync(sidecarPath)) {
        const expectedSidecar = fs.readFileSync(sidecarPath, 'utf-8').trim().split(/\s+/)[0].toLowerCase();
        if (expectedSidecar === sha256Digest.toLowerCase()) {
          integrityStatus = 'verified';
        } else {
          integrityStatus = 'corrupted';
        }
      }
    } catch {
      integrityStatus = 'corrupted';
    }
    return {
      filename,
      created_at: exportedAt || stat.mtime.toISOString(),
      size_bytes: stat.size,
      sha256_digest: sha256Digest,
      integrity_status: integrityStatus
    };
  });
}

app.get('/api/v1/system/backup/snapshots', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может просматривать снимки резервных копий' });
  }
  res.json(listOrgBackupSnapshots(user.organization_id));
});

app.post('/api/v1/system/backup/snapshots', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может создавать снимки резервных копий' });
  }
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  const { digest, backupData } = buildOrgBackupPayload(user.organization_id);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ecc-snapshot-org${user.organization_id}-${stamp}.json`;
  const filePath = path.resolve(BACKUPS_DIR, filename);
  const content = JSON.stringify(backupData, null, 2);
  fs.writeFileSync(filePath, content, 'utf-8');
  fs.writeFileSync(`${filePath}.sha256`, `${digest}  ${filename}\n`, 'utf-8');

  // Enforce retention limit per organization
  const allOrgFiles = fs
    .readdirSync(BACKUPS_DIR)
    .filter(f => isSafeOrgSnapshotFilename(f, user.organization_id))
    .sort()
    .reverse();
  for (const stale of allOrgFiles.slice(BACKUP_RETENTION_COUNT)) {
    const stalePath = path.resolve(BACKUPS_DIR, stale);
    try { fs.unlinkSync(stalePath); } catch { /* ignore */ }
    try { fs.unlinkSync(`${stalePath}.sha256`); } catch { /* ignore */ }
  }

  logAudit(user.organization_id, user.id, 'system.backup.snapshot', 'system', filename, {
    sha256: digest,
    retention_limit: BACKUP_RETENTION_COUNT
  });

  const stat = fs.statSync(filePath);
  res.status(201).json({
    filename,
    created_at: backupData.exported_at,
    size_bytes: stat.size,
    sha256_digest: digest,
    integrity_status: 'verified'
  });
});

app.get('/api/v1/system/backup/snapshots/:filename/download', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может скачивать снимки' });
  }
  const filename = req.params.filename;
  if (!isSafeOrgSnapshotFilename(filename, user.organization_id)) {
    return res.status(400).json({ detail: 'Недопустимое имя файла снимка' });
  }
  const filePath = path.resolve(BACKUPS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ detail: 'Снимок не найден' });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});

app.delete('/api/v1/system/backup/snapshots/:filename', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может удалять снимки' });
  }
  const filename = req.params.filename;
  if (!isSafeOrgSnapshotFilename(filename, user.organization_id)) {
    return res.status(400).json({ detail: 'Недопустимое имя файла снимка' });
  }
  const filePath = path.resolve(BACKUPS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ detail: 'Снимок не найден' });
  }
  fs.unlinkSync(filePath);
  try { fs.unlinkSync(`${filePath}.sha256`); } catch { /* ignore */ }
  logAudit(user.organization_id, user.id, 'system.backup.snapshot_deleted', 'system', filename);
  res.status(204).end();
});

// Measured Recovery Drill Reports (PR #96 parity)
function parseTimezoneIsoTimestamp(value: unknown, fieldName: string): Date {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  const s = value.trim();
  // Require timezone offset (Z or ±HH:MM) just like recovery-drill-report.py
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(s)) {
    throw new Error(`${fieldName} must include a timezone offset (e.g. Z or +00:00)`);
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO-8601 timestamp for ${fieldName}`);
  }
  return parsed;
}

function parsePositiveTargetSeconds(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(`${fieldName} must be a positive integer number of seconds`);
  }
  return num;
}

app.get('/api/v1/system/recovery-drills', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может просматривать отчёты по восстановлению' });
  }
  const list = (db.recoveryDrills || []).filter(r => r.organization_id === user.organization_id);
  res.json(list);
});

app.post('/api/v1/system/recovery-drills', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может создавать отчёты по восстановлению' });
  }

  const {
    backup_reference,
    incident_at,
    restore_started_at,
    restore_completed_at,
    last_committed_at,
    rto_target_seconds,
    rpo_target_seconds
  } = req.body || {};

  if (typeof backup_reference !== 'string' || !backup_reference.trim() || /[\x00-\x1f]/.test(backup_reference)) {
    return res.status(422).json({ detail: 'backup_reference must be non-empty and contain no control characters' });
  }

  let incident: Date;
  let completed: Date;
  let started: Date | null = null;
  let committed: Date | null = null;
  let rtoTarget: number | null = null;
  let rpoTarget: number | null = null;

  try {
    incident = parseTimezoneIsoTimestamp(incident_at, 'incident_at');
    completed = parseTimezoneIsoTimestamp(restore_completed_at, 'restore_completed_at');
    if (restore_started_at) {
      started = parseTimezoneIsoTimestamp(restore_started_at, 'restore_started_at');
    }
    if (last_committed_at) {
      committed = parseTimezoneIsoTimestamp(last_committed_at, 'last_committed_at');
    }
    rtoTarget = parsePositiveTargetSeconds(rto_target_seconds, 'rto_target_seconds');
    rpoTarget = parsePositiveTargetSeconds(rpo_target_seconds, 'rpo_target_seconds');
  } catch (err) {
    return res.status(422).json({ detail: err instanceof Error ? err.message : 'Invalid timestamp or target' });
  }

  if (completed.getTime() < incident.getTime()) {
    return res.status(422).json({ detail: 'restore completion cannot precede incident time' });
  }
  if (started && (started.getTime() < incident.getTime() || started.getTime() > completed.getTime())) {
    return res.status(422).json({ detail: 'restore start must be between incident and restore completion' });
  }
  if (committed && committed.getTime() > incident.getTime()) {
    return res.status(422).json({ detail: 'last committed transaction cannot be after incident time' });
  }
  if (rpoTarget !== null && !committed) {
    return res.status(422).json({ detail: 'rpo_target_seconds requires last_committed_at' });
  }

  const rto = Math.round(((completed.getTime() - incident.getTime()) / 1000) * 1000) / 1000;
  const execution = started ? Math.round(((completed.getTime() - started.getTime()) / 1000) * 1000) / 1000 : null;
  const rpo = committed ? Math.round(((incident.getTime() - committed.getTime()) / 1000) * 1000) / 1000 : null;

  const rtoMet = rtoTarget !== null ? rto <= rtoTarget : null;
  const rpoMet = rpoTarget !== null && rpo !== null ? rpo <= rpoTarget : null;
  const assessed = [rtoMet, rpoMet].filter((v): v is boolean => v !== null);
  let assessment: RecoveryDrillAssessment = 'not_assessed';
  if (assessed.length > 0) {
    assessment = assessed.every(Boolean) ? 'within_targets' : 'target_exceeded';
  }

  if (!Array.isArray(db.recoveryDrills)) db.recoveryDrills = [];
  db.counters.recoveryDrill = (db.counters.recoveryDrill || 0) + 1;

  const report: RecoveryDrillReport = {
    id: db.counters.recoveryDrill,
    organization_id: user.organization_id,
    created_by_user_id: user.id,
    schema_version: 1,
    report_type: 'ecc_recovery_drill',
    generated_at: new Date().toISOString(),
    backup_reference: backup_reference.trim(),
    timestamps: {
      incident_at: incident.toISOString(),
      restore_started_at: started ? started.toISOString() : null,
      restore_completed_at: completed.toISOString(),
      last_committed_at: committed ? committed.toISOString() : null
    },
    measurements_seconds: {
      observed_rto: rto,
      restore_execution: execution,
      observed_rpo: rpo
    },
    targets_seconds: {
      rto: rtoTarget,
      rpo: rpoTarget
    },
    target_met: {
      rto: rtoMet,
      rpo: rpoMet
    },
    assessment,
    measurement_notes: {
      rto: 'Incident declaration to verified restore completion.',
      rpo: 'Incident time minus last known committed transaction time; requires a trustworthy transaction timestamp.',
      missing_rpo: committed ? null : 'RPO was not measured. Backup age alone is not proof of data loss.'
    }
  };

  db.recoveryDrills.unshift(report);
  saveDb();

  logAudit(user.organization_id, user.id, 'system.recovery_drill', 'system', report.id, {
    backup_reference: report.backup_reference,
    observed_rto: report.measurements_seconds.observed_rto,
    observed_rpo: report.measurements_seconds.observed_rpo,
    assessment: report.assessment
  });

  res.status(201).json(report);
});

app.get('/api/v1/system/recovery-drills/:id/download', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может выгружать отчёты по восстановлению' });
  }
  const drillId = parseInt(req.params.id, 10);
  const report = (db.recoveryDrills || []).find(r => r.id === drillId && r.organization_id === user.organization_id);
  if (!report) {
    return res.status(404).json({ detail: 'Отчёт по восстановлению не найден' });
  }
  const { id: _id, organization_id: _org, created_by_user_id: _creator, ...exportPayload } = report;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ecc-recovery-drill-${report.id}.json"`);
  res.send(JSON.stringify(exportPayload, null, 2));
});

// System Telemetry & Security Posture (Phase 2 Monitoring)
app.get('/api/v1/system/telemetry', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может просматривать телеметрию системы' });
  }

  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(DB_FILE)) {
      dbSizeBytes = fs.statSync(DB_FILE).size;
    }
  } catch { /* ignore */ }

  const orgAuditEvents = db.auditEvents.filter(e => e.organization_id === user.organization_id);
  const orgDrills = (db.recoveryDrills || []).filter(r => r.organization_id === user.organization_id);
  const lastBackup = orgAuditEvents.find(e => e.action === 'system.backup');
  const lastRestore = orgAuditEvents.find(e => e.action === 'system.restore');
  const lastDrill = orgDrills[0] || null;

  const durations = structuredLogs.map(l => l.duration_ms).sort((a, b) => a - b);
  const avgDurationMs = durations.length > 0
    ? Math.round((durations.reduce((sum, d) => sum + d, 0) / durations.length) * 100) / 100
    : 0;
  const p95DurationMs = durations.length > 0
    ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
    : 0;

  const alerts: { level: 'warning' | 'critical' | 'info'; code: string; message: string }[] = [];
  if (telemetryCounters.error5xx > 0) {
    alerts.push({ level: 'critical', code: 'http_5xx', message: `Зафиксированы серверные ошибки 5xx: ${telemetryCounters.error5xx}` });
  }
  if (telemetryCounters.rateLimitBlocks > 0) {
    alerts.push({ level: 'warning', code: 'auth_rate_limit', message: `Срабатываний защиты от перебора паролей (429): ${telemetryCounters.rateLimitBlocks}` });
  }
  if (!lastBackup) {
    alerts.push({ level: 'warning', code: 'no_backup', message: 'Резервная копия организации ещё не создавалась через API.' });
  }
  if (lastDrill && lastDrill.assessment === 'target_exceeded') {
    alerts.push({ level: 'critical', code: 'dr_target_exceeded', message: 'Последнее учение по восстановлению (DR) превысило целевые RTO/RPO.' });
  }

  const snapshots = listOrgBackupSnapshots(user.organization_id);
  const corruptedSnapshots = snapshots.filter(s => s.integrity_status === 'corrupted').length;
  if (corruptedSnapshots > 0) {
    alerts.push({ level: 'critical', code: 'corrupted_snapshot', message: `Обнаружены повреждённые локальные снимки резервных копий: ${corruptedSnapshots}` });
  }

  const readiness_checks = [
    {
      id: 'secret_key',
      label: 'Ключ подписи токенов (ECC_SECRET_KEY)',
      status: configuredSecret ? 'pass' : 'warn',
      detail: configuredSecret ? 'Настроен пользовательский ключ (>= 32 байт)' : 'Используется dev-ключ по умолчанию; задайте ECC_SECRET_KEY для production'
    },
    {
      id: 'license_signing_key',
      label: 'Ключ верификации офлайн-лицензий (ECC_LICENSE_SIGNING_KEY)',
      status: LICENSE_SIGNING.configured ? 'pass' : 'warn',
      detail: LICENSE_SIGNING.configured ? 'Настроен выделенный ключ верификации (>= 32 байт)' : 'Используется dev-ключ верификации по умолчанию; задайте ECC_LICENSE_SIGNING_KEY'
    },
    {
      id: 'token_ttl',
      label: 'Короткое время жизни JWT/Bearer-токенов (5–60 мин)',
      status: 'pass',
      detail: `${ACCESS_TOKEN_MINUTES} мин (отзыв через token_version активен)`
    },
    {
      id: 'rate_limit',
      label: 'Ограничение попыток входа по X-Real-IP',
      status: 'pass',
      detail: `${AUTH_RATE_LIMIT_MAX} попыток / ${AUTH_RATE_LIMIT_WINDOW_SECONDS} сек`
    },
    {
      id: 'backup_retention',
      label: 'Локальные SHA-256 снимки резервных копий',
      status: snapshots.length > 0 && corruptedSnapshots === 0 ? 'pass' : 'warn',
      detail: snapshots.length > 0
        ? `${snapshots.length} снимк. (лимит хранения: ${BACKUP_RETENTION_COUNT}), повреждённых: ${corruptedSnapshots}`
        : 'Нет локальных снимков (создайте в разделе «Резервные копии»)'
    },
    {
      id: 'recovery_drill',
      label: 'Измеренные учения по восстановлению (RTO/RPO)',
      status: lastDrill && lastDrill.assessment === 'within_targets' ? 'pass' : 'warn',
      detail: lastDrill
        ? `Последнее учение: ${lastDrill.assessment} (RTO ${lastDrill.measurements_seconds.observed_rto} с)`
        : 'Учения по восстановлению ещё не зафиксированы'
    },
    {
      id: 'structured_logs',
      label: 'Структурированное логирование HTTP-запросов (stdout JSON)',
      status: STRUCTURED_LOGS_STDOUT ? 'pass' : 'warn',
      detail: STRUCTURED_LOGS_STDOUT ? 'Включено (ECC_STRUCTURED_LOGS=true)' : 'Буфер в памяти активен; для stdout JSON задайте ECC_STRUCTURED_LOGS=true'
    }
  ];

  const mem = process.memoryUsage();
  res.json({
    started_at: serverStartedAt,
    uptime_seconds: Math.round(process.uptime()),
    node_version: process.version,
    access_token_minutes: ACCESS_TOKEN_MINUTES,
    memory: {
      rss_mb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heap_used_mb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heap_total_mb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10
    },
    storage: {
      store_file: 'ecc_store.json',
      size_kb: Math.round((dbSizeBytes / 1024) * 10) / 10,
      total_audit_events: orgAuditEvents.length
    },
    backup_readiness: {
      last_backup_at: lastBackup ? lastBackup.created_at : null,
      last_restore_at: lastRestore ? lastRestore.created_at : null,
      last_drill_at: lastDrill ? lastDrill.generated_at : null,
      last_drill_assessment: lastDrill ? lastDrill.assessment : null,
      total_drills: orgDrills.length,
      local_snapshots_count: snapshots.length
    },
    requests: {
      total: telemetryCounters.totalRequests,
      api: telemetryCounters.apiRequests,
      error_4xx: telemetryCounters.error4xx,
      error_5xx: telemetryCounters.error5xx,
      rate_limit_blocks: telemetryCounters.rateLimitBlocks,
      avg_duration_ms: avgDurationMs,
      p95_duration_ms: p95DurationMs
    },
    alerts,
    readiness_checks,
    security_posture: [
      { id: 'headers', label: 'HTTP Security Headers (CSP, X-Frame-Options, nosniff, Referrer-Policy)', status: 'active' },
      { id: 'rate_limit', label: `Защита входа от перебора паролей (${AUTH_RATE_LIMIT_MAX} попыток / ${AUTH_RATE_LIMIT_WINDOW_SECONDS} сек, X-Real-IP)`, status: 'active' },
      { id: 'token_revocation', label: `Короткие токены (${ACCESS_TOKEN_MINUTES} мин) и отзыв по token_version`, status: 'active' },
      { id: 'optimistic_locking', label: 'Оптимистическая блокировка версий и атомарный bulk-update', status: 'active' },
      { id: 'backup_sha256', label: 'Проверка контрольной суммы резервной копии SHA-256 до восстановления', status: 'active' },
      { id: 'csv_formula', label: 'Экранирование формул при экспорте CSV (=, +, -, @, пробел+формула)', status: 'active' },
      { id: 'tenant_isolation', label: 'Изоляция данных на уровне organization_id и RBAC', status: 'active' }
    ],
    recent_logs: structuredLogs.slice(0, 80)
  });
});

// Audit Events Log
function filterAuditEvents(orgId: number, entityType: string, search: string) {
  let events = db.auditEvents.filter(e => e.organization_id === orgId);
  if (entityType) {
    events = events.filter(e => e.entity_type === entityType);
  }
  if (search) {
    const q = search.toLowerCase();
    events = events.filter(e =>
      e.action.toLowerCase().includes(q) ||
      e.entity_type.toLowerCase().includes(q) ||
      e.entity_id.toLowerCase().includes(q) ||
      JSON.stringify(e.details).toLowerCase().includes(q)
    );
  }
  return events;
}

app.get('/api/v1/audit-events/export', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может выгружать журнал аудита' });
  }
  const entityType = ((req.query.entity_type as string) || '').trim();
  const search = ((req.query.search as string) || '').trim();
  const events = filterAuditEvents(user.organization_id, entityType, search).slice(0, 2000);

  const header = ['id', 'created_at', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'details'];
  const rows = events.map(e => [
    csvSpreadsheetSafe(e.id),
    csvSpreadsheetSafe(e.created_at),
    csvSpreadsheetSafe(e.actor_user_id ?? ''),
    csvSpreadsheetSafe(e.action),
    csvSpreadsheetSafe(e.entity_type),
    csvSpreadsheetSafe(e.entity_id),
    csvSpreadsheetSafe(JSON.stringify(e.details))
  ].join(','));

  const csv = '\uFEFF' + [header.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ecc-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

app.get('/api/v1/audit-events', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может просматривать журнал аудита' });
  }
  const parsedLimit = parseInt((req.query.limit as string) || '100', 10);
  const limit = Number.isNaN(parsedLimit) ? 100 : Math.min(200, Math.max(1, parsedLimit));
  const entityType = ((req.query.entity_type as string) || '').trim();
  const search = ((req.query.search as string) || '').trim();
  const events = filterAuditEvents(user.organization_id, entityType, search);
  res.json(events.slice(0, limit));
});

// Commercial Edition Boundaries, Offline License Activation & Enterprise Reporting (Phase 3)
app.get('/api/v1/system/edition', authenticate, (req, res) => {
  const user = (req as any).user as User;
  res.json({
    ...getOrgEntitlements(user.organization_id),
    catalog: Object.values(EDITION_CATALOG)
  });
});

app.get('/api/v1/system/license', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может просматривать лицензию продукта' });
  }
  res.json({
    ...getOrgEntitlements(user.organization_id),
    catalog: Object.values(EDITION_CATALOG)
  });
});

app.post('/api/v1/system/license/activate', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может активировать лицензию' });
  }
  const rawKey = typeof req.body?.license_key === 'string' ? req.body.license_key.trim() : '';
  if (!rawKey) {
    return res.status(422).json({ detail: 'Передайте офлайн-ключ лицензии (license_key)' });
  }

  const org = db.organizations.find(o => o.id === user.organization_id);
  const orgName = org ? org.name : 'Default Organization';

  let verified;
  try {
    verified = verifyOfflineLicenseToken(rawKey, LICENSE_SIGNING.key, orgName);
  } catch (err) {
    return res.status(422).json({ detail: err instanceof Error ? err.message : 'Ошибка проверки лицензионного ключа' });
  }

  if (!Array.isArray(db.licenses)) db.licenses = [];
  const def = EDITION_CATALOG[verified.payload.edition];
  const record: StoredLicenseRecord = {
    organization_id: user.organization_id,
    license_id: verified.payload.license_id,
    edition: verified.payload.edition,
    customer_name: verified.payload.customer_name,
    organization_name: verified.payload.organization_name,
    issued_at: verified.payload.issued_at,
    expires_at: verified.payload.expires_at,
    activated_at: new Date().toISOString(),
    activated_by_user_id: user.id,
    max_users: verified.payload.max_users !== undefined ? verified.payload.max_users : def.limits.max_users,
    max_assets: verified.payload.max_assets !== undefined ? verified.payload.max_assets : def.limits.max_assets,
    max_software_licenses:
      verified.payload.max_software_licenses !== undefined
        ? verified.payload.max_software_licenses
        : def.limits.max_software_licenses,
    notes: verified.payload.notes ?? null,
    key_fingerprint: verified.key_fingerprint
  };

  const existingIdx = db.licenses.findIndex(l => l.organization_id === user.organization_id);
  if (existingIdx >= 0) {
    db.licenses[existingIdx] = record;
  } else {
    db.licenses.push(record);
  }
  saveDb();

  logAudit(user.organization_id, user.id, 'system.license.activated', 'system', record.license_id, {
    edition: record.edition,
    customer_name: record.customer_name,
    expires_at: record.expires_at,
    fingerprint: record.key_fingerprint
  });

  res.status(200).json({
    ...getOrgEntitlements(user.organization_id),
    catalog: Object.values(EDITION_CATALOG)
  });
});

app.post('/api/v1/system/license/deactivate', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может деактивировать лицензию' });
  }
  if (!Array.isArray(db.licenses)) db.licenses = [];
  const idx = db.licenses.findIndex(l => l.organization_id === user.organization_id);
  const removed = idx >= 0 ? db.licenses.splice(idx, 1)[0] : null;
  if (removed) {
    saveDb();
    logAudit(user.organization_id, user.id, 'system.license.deactivated', 'system', removed.license_id, {
      previous_edition: removed.edition
    });
  }
  res.json({
    ...getOrgEntitlements(user.organization_id),
    catalog: Object.values(EDITION_CATALOG)
  });
});

app.get('/api/v1/enterprise/sla-report', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может просматривать SLA-отчётность' });
  }
  const entitlements = getOrgEntitlements(user.organization_id);
  if (!hasFeature(entitlements, 'enterprise_sla_reporting')) {
    return res.status(403).json({
      code: 'enterprise_license_required',
      detail: 'Расширенная SLA-отчётность доступна только в коммерческих редакциях Professional / Enterprise.'
    });
  }

  const org = db.organizations.find(o => o.id === user.organization_id);
  const report = buildEnterpriseSlaReport({
    organizationName: org ? org.name : 'Default Organization',
    entitlements,
    assets: db.assets.filter(a => a.organization_id === user.organization_id),
    softwareLicenses: db.softwareLicenses.filter(s => s.organization_id === user.organization_id),
    maintenanceRequests: db.maintenanceRequests.filter(m => m.organization_id === user.organization_id),
    snapshots: listOrgBackupSnapshots(user.organization_id),
    drills: (db.recoveryDrills || []).filter(r => r.organization_id === user.organization_id)
  });

  if ((req.query.format as string) === 'csv') {
    const csv = formatEnterpriseSlaCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ecc-enterprise-sla-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  }
  res.json(report);
});

app.get('/api/v1/enterprise/support-bundle', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может выгружать диагностический пакет поддержки' });
  }
  const entitlements = getOrgEntitlements(user.organization_id);
  if (!hasFeature(entitlements, 'support_bundle_export')) {
    return res.status(403).json({
      code: 'enterprise_license_required',
      detail: 'Выгрузка диагностического пакета поддержки доступна в редакциях Professional / Enterprise.'
    });
  }

  const org = db.organizations.find(o => o.id === user.organization_id);
  const orgDrills = (db.recoveryDrills || []).filter(r => r.organization_id === user.organization_id);
  const lastDrill = orgDrills[0] || null;
  const snapshots = listOrgBackupSnapshots(user.organization_id);
  const corruptedSnapshots = snapshots.filter(s => s.integrity_status === 'corrupted').length;

  const durations = structuredLogs.map(l => l.duration_ms).sort((a, b) => a - b);
  const avgDurationMs = durations.length > 0
    ? Math.round((durations.reduce((sum, d) => sum + d, 0) / durations.length) * 100) / 100
    : 0;
  const p95DurationMs = durations.length > 0
    ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
    : 0;

  const bundle = buildSanitizedSupportBundle({
    organizationName: org ? org.name : 'Default Organization',
    entitlements,
    nodeVersion: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    readinessChecks: [
      { id: 'secret_key', label: 'Ключ подписи токенов', status: configuredSecret ? 'pass' : 'warn', detail: configuredSecret ? 'Configured' : 'Default dev key' },
      { id: 'license_signing_key', label: 'Ключ верификации лицензий', status: LICENSE_SIGNING.configured ? 'pass' : 'warn', detail: LICENSE_SIGNING.configured ? 'Configured' : 'Default dev key' },
      { id: 'backup_retention', label: 'Снимки резервных копий', status: snapshots.length > 0 && corruptedSnapshots === 0 ? 'pass' : 'warn', detail: `${snapshots.length} snapshots, ${corruptedSnapshots} corrupted` },
      { id: 'recovery_drill', label: 'Учения DR', status: lastDrill && lastDrill.assessment === 'within_targets' ? 'pass' : 'warn', detail: lastDrill ? lastDrill.assessment : 'none' }
    ],
    requestsSummary: {
      total: telemetryCounters.totalRequests,
      api: telemetryCounters.apiRequests,
      error_4xx: telemetryCounters.error4xx,
      error_5xx: telemetryCounters.error5xx,
      rate_limit_blocks: telemetryCounters.rateLimitBlocks,
      avg_duration_ms: avgDurationMs,
      p95_duration_ms: p95DurationMs
    },
    recentHttpErrors: structuredLogs
      .filter(l => l.status >= 400 && l.status !== 401)
      .map(({ id, timestamp, method, path: reqPath, status, duration_ms }) => ({
        id,
        timestamp,
        method,
        path: reqPath,
        status,
        duration_ms
      }))
  });

  logAudit(user.organization_id, user.id, 'enterprise.support_bundle.exported', 'system', user.organization_id, {
    edition: entitlements.edition
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ecc-support-bundle-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(bundle, null, 2));
});

// Return clean JSON 404 for unknown API paths instead of SPA HTML fallback
app.use('/api/*', (_req, res) => {
  res.status(404).json({ detail: 'Маршрут API не найден' });
});

// --- VITE DEV OR STATIC SERVING ---
async function startServer() {
  if (process.env.ECC_DISABLE_VITE === 'true') {
    app.get('/', (_req, res) => {
      res.status(200).send('ECC API server running');
    });
  } else if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ECC Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();


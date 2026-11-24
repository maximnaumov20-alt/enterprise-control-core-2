import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) {
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

interface EccDatabase {
  organizations: Organization[];
  users: User[];
  departments: Department[];
  employees: Employee[];
  assets: Asset[];
  maintenanceRequests: MaintenanceRequest[];
  softwareLicenses: SoftwareLicense[];
  auditEvents: AuditEvent[];
  counters: {
    user: number;
    department: number;
    employee: number;
    asset: number;
    maintenance: number;
    software: number;
    audit: number;
  };
}

// --- PERSISTENCE ---
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.resolve(DATA_DIR, 'ecc_store.json');

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  if (!stored.startsWith('scrypt:')) {
    return password === stored;
  }
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [, salt, hash] = parts;
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
  } catch {
    return false;
  }
}

function createInitialDatabase(): EccDatabase {
  const now = new Date().toISOString();
  return {
    organizations: [
      { id: 1, name: 'Default Organization', created_at: now }
    ],
    users: [
      {
        id: 1,
        organization_id: 1,
        email: 'admin@example.com',
        full_name: 'ECC Administrator',
        password_hash: hashPassword('admin12345678'),
        role: 'admin',
        is_active: true,
        token_version: 1,
        version: 1,
        created_at: now
      },
      {
        id: 2,
        organization_id: 1,
        email: 'editor@example.com',
        full_name: 'Инженер технической поддержки',
        password_hash: hashPassword('editor12345678'),
        role: 'editor',
        is_active: true,
        token_version: 1,
        version: 1,
        created_at: now
      },
      {
        id: 3,
        organization_id: 1,
        email: 'viewer@example.com',
        full_name: 'Сотрудник аудита (наблюдатель)',
        password_hash: hashPassword('viewer12345678'),
        role: 'viewer',
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
        assigned_to_user_id: 2,
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
    counters: {
      user: 3,
      department: 5,
      employee: 5,
      asset: 5,
      maintenance: 2,
      software: 3,
      audit: 3
    }
  };
}

let db: EccDatabase;
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    db = JSON.parse(raw);
  } else {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    db = createInitialDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  }
} catch (err) {
  console.error('Error loading DB file, fallback to seed:', err);
  db = createInitialDatabase();
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
const SECRET_KEY = process.env.ECC_SECRET_KEY || 'default-super-secret-key-at-least-32-bytes-long-for-ecc-production';

interface TokenPayload {
  userId: number;
  organizationId: number;
  tokenVersion: number;
  exp: number;
}

function signToken(payload: Omit<TokenPayload, 'exp'>, expiresInSeconds = 7200): string {
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
    return res.status(401).json({ detail: 'Необходима авторизация' });
  }
  const token = authHeader.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ detail: 'Недействительный или истекший токен доступа' });
  }
  const user = db.users.find(u => u.id === payload.userId && u.organization_id === payload.organizationId);
  if (!user || !user.is_active || user.token_version !== payload.tokenVersion) {
    return res.status(401).json({ detail: 'Сессия недействительна. Войдите снова.' });
  }
  (req as any).user = user;
  next();
}

// --- API ENDPOINTS ---

// Login Rate Limiter (10 attempts per minute per IP/Email)
interface RateLimitBucket {
  attempts: number;
  resetAt: number;
}
const loginRateLimitBuckets = new Map<string, RateLimitBucket>();

function recordFailedLogin(key: string) {
  const now = Date.now();
  const bucket = loginRateLimitBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    loginRateLimitBuckets.set(key, { attempts: 1, resetAt: now + 60000 });
  } else {
    bucket.attempts += 1;
  }
}

function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = loginRateLimitBuckets.get(key);
  if (!bucket) return false;
  if (now > bucket.resetAt) {
    loginRateLimitBuckets.delete(key);
    return false;
  }
  return bucket.attempts >= 10;
}

// Healthcheck
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Auth Login
app.post('/api/v1/auth/token', (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const email = (req.body.username || req.body.email || '').toString().trim().toLowerCase();
  const password = (req.body.password || '').toString();

  const rateLimitKey = `${clientIp}:${email}`;
  if (isLoginRateLimited(rateLimitKey)) {
    return res.status(429).json({ detail: 'Превышен лимит попыток входа (10 попыток). Пожалуйста, подождите 60 секунд.' });
  }

  const user = db.users.find(u => u.email.toLowerCase() === email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailedLogin(rateLimitKey);
    return res.status(400).json({ detail: 'Неверный адрес электронной почты или пароль' });
  }
  if (!user.is_active) {
    return res.status(400).json({ detail: 'Учётная запись деактивирована администратором' });
  }

  // Clear failed rate limit bucket on successful login
  loginRateLimitBuckets.delete(rateLimitKey);

  const token = signToken({
    userId: user.id,
    organizationId: user.organization_id,
    tokenVersion: user.token_version
  }, 7200);

  logAudit(user.organization_id, user.id, 'auth.login', 'user', user.id, { email: user.email });

  res.json({
    access_token: token,
    token_type: 'bearer',
    expires_in: 7200
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
    created_at: user.created_at
  });
});

// Change Password
app.post('/api/v1/auth/change-password', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const { current_password, new_password } = req.body;

  if (!verifyPassword(current_password, user.password_hash)) {
    return res.status(400).json({ detail: 'Неверный текущий пароль' });
  }
  if (!new_password || new_password.length < 12) {
    return res.status(400).json({ detail: 'Новый пароль должен содержать не менее 12 символов' });
  }

  user.password_hash = hashPassword(new_password);
  user.token_version += 1;
  saveDb();

  logAudit(user.organization_id, user.id, 'auth.change_password', 'user', user.id);
  res.json({ status: 'ok' });
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
  const { email, full_name, password, role } = req.body;
  if (!email || !full_name || !password || !role) {
    return res.status(400).json({ detail: 'Заполните все обязательные поля' });
  }
  const cleanEmail = email.trim().toLowerCase();
  if (db.users.some(u => u.organization_id === user.organization_id && u.email.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ detail: 'Пользователь с таким email уже существует' });
  }

  db.counters.user += 1;
  const newUser: User = {
    id: db.counters.user,
    organization_id: user.organization_id,
    email: cleanEmail,
    full_name: full_name.trim(),
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
  const { expected_version, full_name, role, is_active } = req.body;
  if (typeof expected_version !== 'number') {
    return res.status(422).json({ detail: 'expected_version обязателен' });
  }
  if (target.version !== expected_version) {
    return res.status(409).json({ detail: 'Конфликт версий записи. Обновите данные.' });
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
    if (!is_active) {
      target.token_version += 1;
    }
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
app.get('/api/v1/assets', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  const limit = parseInt((req.query.limit as string) || '200', 10);

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
  res.json(list.slice(0, limit));
});

app.post('/api/v1/assets', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }
  const { name, asset_tag, category, manufacturer, model, serial_number, assigned_to, status } = req.body;
  if (!name || !asset_tag || !category) {
    return res.status(400).json({ detail: 'Название, инвентарный номер и категория обязательны' });
  }

  const cleanTag = asset_tag.trim();
  if (db.assets.some(a => a.organization_id === user.organization_id && a.asset_tag.toLowerCase() === cleanTag.toLowerCase())) {
    return res.status(400).json({ detail: 'Оборудование с таким инвентарным номером уже существует' });
  }

  db.counters.asset += 1;
  const now = new Date().toISOString();
  const newAsset: Asset = {
    id: db.counters.asset,
    organization_id: user.organization_id,
    name: name.trim(),
    asset_tag: cleanTag,
    category: category.trim(),
    manufacturer: manufacturer ? manufacturer.trim() : null,
    model: model ? model.trim() : null,
    serial_number: serial_number ? serial_number.trim() : null,
    assigned_to: assigned_to ? assigned_to.trim() : null,
    status: status || 'active',
    created_at: now,
    updated_at: now,
    version: 1
  };
  db.assets.push(newAsset);
  saveDb();

  logAudit(user.organization_id, user.id, 'asset.created', 'asset', newAsset.id, {
    name: newAsset.name,
    asset_tag: newAsset.asset_tag
  });

  res.status(201).json(newAsset);
});

app.get('/api/v1/assets/export', authenticate, (req, res) => {
  const user = (req as any).user as User;
  const list = db.assets.filter(a => a.organization_id === user.organization_id);

  function csvEscape(val: unknown): string {
    if (val === null || val === undefined) return '""';
    let s = String(val);
    if (/^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    return `"${s.replace(/"/g, '""')}"`;
  }

  const header = ['name', 'asset_tag', 'category', 'manufacturer', 'model', 'serial_number', 'assigned_to', 'status'];
  const rows = list.map(a => [
    csvEscape(a.name),
    csvEscape(a.asset_tag),
    csvEscape(a.category),
    csvEscape(a.manufacturer || ''),
    csvEscape(a.model || ''),
    csvEscape(a.serial_number || ''),
    csvEscape(a.assigned_to || ''),
    csvEscape(a.status)
  ].join(','));

  const csv = [header.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="assets.csv"');
  res.send(csv);
});

app.post('/api/v1/assets/import', authenticate, upload.single('file'), (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ detail: 'Файл не загружен' });
  }

  const content = req.file.buffer.toString('utf-8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    return res.json({ created: 0, skipped: 0, errors: [] });
  }

  const headers = lines[0].split(',').map(h => h.replace(/^["']|["']$/g, '').trim());
  let created = 0;
  let skipped = 0;
  const errors: { row: number; error: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    // Simple CSV parser supporting quotes
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

    const name = record.name;
    const asset_tag = record.asset_tag;
    const category = record.category || 'Компьютер';

    if (!name || !asset_tag) {
      errors.push({ row: i + 1, error: 'Отсутствует name или asset_tag' });
      continue;
    }

    if (db.assets.some(a => a.organization_id === user.organization_id && a.asset_tag.toLowerCase() === asset_tag.toLowerCase())) {
      skipped += 1;
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
      manufacturer: record.manufacturer || null,
      model: record.model || null,
      serial_number: record.serial_number || null,
      assigned_to: record.assigned_to || null,
      status: (record.status as AssetStatus) || 'active',
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

  saveDb();
  res.json({ created, skipped, errors });
});

app.patch('/api/v1/assets/bulk', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'viewer') {
    return res.status(403).json({ detail: 'Недостаточно прав' });
  }

  const { asset_ids, versions, status, assigned_to } = req.body;
  if (!Array.isArray(asset_ids) || asset_ids.length === 0) {
    return res.status(400).json({ detail: 'Выберите хотя бы одно оборудование' });
  }

  const updatedAssets: Asset[] = [];
  let updatedCount = 0;

  for (const id of asset_ids) {
    const asset = db.assets.find(a => a.id === id && a.organization_id === user.organization_id);
    if (!asset) continue;

    if (versions && versions[id] !== undefined && versions[id] !== asset.version) {
      continue; // Skip or report conflict
    }

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (status && status !== asset.status) {
      changes.status = { old: asset.status, new: status };
      asset.status = status;
    }
    if (assigned_to !== undefined && assigned_to !== asset.assigned_to) {
      changes.assigned_to = { old: asset.assigned_to, new: assigned_to };
      asset.assigned_to = assigned_to;
    }

    if (Object.keys(changes).length > 0) {
      asset.version += 1;
      asset.updated_at = new Date().toISOString();
      updatedAssets.push(asset);
      updatedCount += 1;

      logAudit(user.organization_id, user.id, 'asset.updated', 'asset', asset.id, { changes });
    }
  }

  saveDb();
  res.json({
    selected: asset_ids.length,
    updated: updatedCount,
    assets: updatedAssets
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
    title: newReq.title,
    asset_id: newReq.asset_id
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
  const list = db.softwareLicenses.filter(s => s.organization_id === user.organization_id);
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

// System Backup & Restore
app.get('/api/v1/system/backup', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может создавать резервную копию' });
  }

  const orgId = user.organization_id;
  const org = db.organizations.find(o => o.id === orgId);
  const backupData = {
    schema_version: '1.0',
    exported_at: new Date().toISOString(),
    organization: org,
    departments: db.departments.filter(d => d.organization_id === orgId),
    employees: db.employees.filter(e => e.organization_id === orgId),
    assets: db.assets.filter(a => a.organization_id === orgId),
    software_licenses: db.softwareLicenses.filter(s => s.organization_id === orgId),
    maintenance_requests: db.maintenanceRequests.filter(m => m.organization_id === orgId),
    audit_events: db.auditEvents.filter(a => a.organization_id === orgId)
  };

  logAudit(orgId, user.id, 'system.backup', 'system', orgId, { timestamp: backupData.exported_at });

  const filename = `ecc-backup-${org ? org.name.replace(/\s+/g, '_') : 'org'}-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(backupData, null, 2));
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
    } else if (req.body && typeof req.body === 'object') {
      data = req.body;
    } else {
      return res.status(400).json({ detail: 'Файл резервной копии не передан' });
    }
  } catch {
    return res.status(400).json({ detail: 'Неверный формат JSON резервной копии' });
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(422).json({ detail: 'Некорректный файл резервной копии: ожидается JSON-объект' });
  }
  if (!data.schema_version && !data.organization && !Array.isArray(data.assets) && !Array.isArray(data.departments)) {
    return res.status(422).json({ detail: 'Файл не содержит валидной структуры резервной копии ECC' });
  }

  const orgId = user.organization_id;
  if (Array.isArray(data.departments)) {
    db.departments = db.departments.filter(d => d.organization_id !== orgId).concat(data.departments.map((d: any) => ({ ...d, organization_id: orgId })));
  }
  if (Array.isArray(data.employees)) {
    db.employees = db.employees.filter(e => e.organization_id !== orgId).concat(data.employees.map((e: any) => ({ ...e, organization_id: orgId })));
  }
  if (Array.isArray(data.assets)) {
    db.assets = db.assets.filter(a => a.organization_id !== orgId).concat(data.assets.map((a: any) => ({ ...a, organization_id: orgId })));
  }
  if (Array.isArray(data.software_licenses)) {
    db.softwareLicenses = db.softwareLicenses.filter(s => s.organization_id !== orgId).concat(data.software_licenses.map((s: any) => ({ ...s, organization_id: orgId })));
  }
  if (Array.isArray(data.maintenance_requests)) {
    db.maintenanceRequests = db.maintenanceRequests.filter(m => m.organization_id !== orgId).concat(data.maintenance_requests.map((m: any) => ({ ...m, organization_id: orgId })));
  }
  if (Array.isArray(data.audit_events)) {
    db.auditEvents = db.auditEvents.filter(a => a.organization_id !== orgId).concat(data.audit_events.map((a: any) => ({ ...a, organization_id: orgId })));
  }

  saveDb();
  logAudit(orgId, user.id, 'system.restore', 'system', orgId, { restored_at: new Date().toISOString() });

  res.json({ status: 'ok', detail: 'Данные успешно восстановлены из резервной копии' });
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

  const mem = process.memoryUsage();
  res.json({
    started_at: serverStartedAt,
    uptime_seconds: Math.round(process.uptime()),
    node_version: process.version,
    memory: {
      rss_mb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heap_used_mb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heap_total_mb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10
    },
    storage: {
      store_file: 'ecc_store.json',
      size_kb: Math.round((dbSizeBytes / 1024) * 10) / 10,
      total_audit_events: db.auditEvents.filter(e => e.organization_id === user.organization_id).length
    },
    requests: {
      total: telemetryCounters.totalRequests,
      api: telemetryCounters.apiRequests,
      error_4xx: telemetryCounters.error4xx,
      error_5xx: telemetryCounters.error5xx,
      rate_limit_blocks: telemetryCounters.rateLimitBlocks
    },
    security_posture: [
      { id: 'headers', label: 'HTTP Security Headers (X-Frame-Options, nosniff, Referrer-Policy)', status: 'active' },
      { id: 'rate_limit', label: 'Защита входа от перебора паролей (10 попыток / 60 сек)', status: 'active' },
      { id: 'token_revocation', label: 'Отзыв токенов по token_version при смене пароля/статуса', status: 'active' },
      { id: 'optimistic_locking', label: 'Оптимистическая блокировка версий для защиты от гонок записи', status: 'active' },
      { id: 'csv_formula', label: 'Экранирование формул при экспорте CSV (=, +, -, @)', status: 'active' },
      { id: 'tenant_isolation', label: 'Изоляция данных на уровне organization_id и RBAC', status: 'active' }
    ],
    recent_logs: structuredLogs.slice(0, 40)
  });
});

// Audit Events Log
app.get('/api/v1/audit-events', authenticate, (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ detail: 'Только администратор может просматривать журнал аудита' });
  }
  const limit = parseInt((req.query.limit as string) || '100', 10);
  const entityType = ((req.query.entity_type as string) || '').trim();
  let events = db.auditEvents.filter(e => e.organization_id === user.organization_id);
  if (entityType) {
    events = events.filter(e => e.entity_type === entityType);
  }
  res.json(events.slice(0, limit));
});

// --- VITE DEV OR STATIC SERVING ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
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

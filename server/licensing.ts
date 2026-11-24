import crypto from 'crypto';

export type ProductEdition = 'community' | 'professional' | 'enterprise';
export type LicenseStatus = 'community' | 'active' | 'expired';

export type EnterpriseFeature =
  | 'core_inventory'
  | 'audit_export'
  | 'sha256_backups'
  | 'recovery_drills'
  | 'enterprise_sla_reporting'
  | 'support_bundle_export'
  | 'custom_retention_policy'
  | 'dedicated_support';

export interface EditionDefinition {
  edition: ProductEdition;
  label: string;
  description: string;
  limits: {
    max_users: number | null;
    max_assets: number | null;
    max_software_licenses: number | null;
  };
  features: EnterpriseFeature[];
}

export const EDITION_CATALOG: Record<ProductEdition, EditionDefinition> = {
  community: {
    edition: 'community',
    label: 'Community Edition',
    description: 'Базовая редакция для пилотов, обучения и некоммерческого использования.',
    limits: {
      max_users: 10,
      max_assets: 250,
      max_software_licenses: 50
    },
    features: [
      'core_inventory',
      'audit_export',
      'sha256_backups',
      'recovery_drills'
    ]
  },
  professional: {
    edition: 'professional',
    label: 'Professional Edition',
    description: 'Коммерческая редакция для ИТ-отделов: расширенные квоты, SLA-отчётность и пакет поддержки.',
    limits: {
      max_users: 100,
      max_assets: 2500,
      max_software_licenses: 500
    },
    features: [
      'core_inventory',
      'audit_export',
      'sha256_backups',
      'recovery_drills',
      'enterprise_sla_reporting',
      'support_bundle_export',
      'custom_retention_policy'
    ]
  },
  enterprise: {
    edition: 'enterprise',
    label: 'Enterprise Edition',
    description: 'Корпоративная редакция без ограничений по квотам с полным SLA-контролем и выделенной поддержкой.',
    limits: {
      max_users: null,
      max_assets: null,
      max_software_licenses: null
    },
    features: [
      'core_inventory',
      'audit_export',
      'sha256_backups',
      'recovery_drills',
      'enterprise_sla_reporting',
      'support_bundle_export',
      'custom_retention_policy',
      'dedicated_support'
    ]
  }
};

export interface OfflineLicensePayload {
  schema_version: 1;
  license_id: string;
  edition: 'professional' | 'enterprise';
  customer_name: string;
  organization_name: string;
  issued_at: string;
  expires_at: string;
  max_users?: number | null;
  max_assets?: number | null;
  max_software_licenses?: number | null;
  notes?: string | null;
}

export interface StoredLicenseRecord {
  organization_id: number;
  license_id: string;
  edition: 'professional' | 'enterprise';
  customer_name: string;
  organization_name: string;
  issued_at: string;
  expires_at: string;
  activated_at: string;
  activated_by_user_id: number;
  max_users: number | null;
  max_assets: number | null;
  max_software_licenses: number | null;
  notes: string | null;
  key_fingerprint: string;
}

export interface UsageCounters {
  users: number;
  assets: number;
  software_licenses: number;
}

export interface EditionEntitlements {
  edition: ProductEdition;
  edition_label: string;
  license_status: LicenseStatus;
  features: EnterpriseFeature[];
  limits: {
    max_users: number | null;
    max_assets: number | null;
    max_software_licenses: number | null;
  };
  usage: UsageCounters;
  license: Omit<StoredLicenseRecord, 'organization_id' | 'activated_by_user_id'> | null;
}

export function resolveLicenseSigningKey(): { key: string; configured: boolean } {
  const configured = process.env.ECC_LICENSE_SIGNING_KEY;
  if (configured) {
    if (configured.includes('REPLACE_WITH')) {
      throw new Error('ECC_LICENSE_SIGNING_KEY is still a placeholder; configure a unique random secret.');
    }
    if (Buffer.byteLength(configured, 'utf-8') < 32) {
      throw new Error('ECC_LICENSE_SIGNING_KEY must contain at least 32 bytes.');
    }
    return { key: configured, configured: true };
  }
  // Fail closed: a published fallback key would let anyone mint commercial licenses.
  return {
    key: '',
    configured: false
  };
}

export function signOfflineLicenseToken(payload: OfflineLicensePayload, signingKey: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', signingKey).update(`ECC1.${body}`).digest('base64url');
  return `ECC1.${body}.${sig}`;
}

export function verifyOfflineLicenseToken(
  rawToken: string,
  signingKey: string,
  targetOrganizationName: string
): { payload: OfflineLicensePayload; key_fingerprint: string } {
  const trimmed = rawToken.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== 'ECC1' || !parts[1] || !parts[2]) {
    throw new Error('Некорректный формат офлайн-ключа: ожидается формат ECC1.<payload>.<signature>');
  }
  const [, body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', signingKey).update(`ECC1.${body}`).digest('base64url');
  const providedBuf = Buffer.from(sig, 'utf-8');
  const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    throw new Error('Недействительная цифровая подпись лицензионного ключа');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
  } catch {
    throw new Error('Невозможно декодировать содержимое лицензионного ключа');
  }

  if (!parsed || typeof parsed !== 'object' || parsed.schema_version !== 1) {
    throw new Error('Неподдерживаемая версия схемы лицензии');
  }
  if (parsed.edition !== 'professional' && parsed.edition !== 'enterprise') {
    throw new Error('Недопустимая редакция в лицензии (ожидается professional или enterprise)');
  }
  const licenseId = typeof parsed.license_id === 'string' ? parsed.license_id.trim() : '';
  const customerName = typeof parsed.customer_name === 'string' ? parsed.customer_name.trim() : '';
  const orgName = typeof parsed.organization_name === 'string' ? parsed.organization_name.trim() : '';
  if (!licenseId || !customerName || !orgName) {
    throw new Error('В лицензии отсутствуют обязательные реквизиты (license_id, customer_name, organization_name)');
  }

  const issuedAt = new Date(parsed.issued_at);
  const expiresAt = new Date(parsed.expires_at);
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
    throw new Error('Некорректные даты issued_at / expires_at в лицензии');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error('Срок действия указанного лицензионного ключа уже истёк');
  }
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    throw new Error('Дата окончания лицензии не может быть раньше даты выпуска');
  }

  if (orgName !== '*' && orgName.toLowerCase() !== targetOrganizationName.trim().toLowerCase()) {
    throw new Error(`Лицензия выпущена для организации «${orgName}», текущая организация: «${targetOrganizationName}»`);
  }

  const validateLimit = (val: unknown, label: string): number | null | undefined => {
    if (val === undefined || val === null) return val as null | undefined;
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
      throw new Error(`Некорректный лимит ${label} в лицензии`);
    }
    return val;
  };

  const payload: OfflineLicensePayload = {
    schema_version: 1,
    license_id: licenseId,
    edition: parsed.edition,
    customer_name: customerName,
    organization_name: orgName,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    max_users: validateLimit(parsed.max_users, 'max_users'),
    max_assets: validateLimit(parsed.max_assets, 'max_assets'),
    max_software_licenses: validateLimit(parsed.max_software_licenses, 'max_software_licenses'),
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim() || null : null
  };

  const fingerprint = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
  return { payload, key_fingerprint: fingerprint };
}

export function resolveOrgEntitlements(
  stored: StoredLicenseRecord | undefined,
  usage: UsageCounters,
  nowMs = Date.now()
): EditionEntitlements {
  if (!stored) {
    const def = EDITION_CATALOG.community;
    return {
      edition: 'community',
      edition_label: def.label,
      license_status: 'community',
      features: [...def.features],
      limits: { ...def.limits },
      usage,
      license: null
    };
  }

  const expiresMs = new Date(stored.expires_at).getTime();
  const isExpired = Number.isNaN(expiresMs) || expiresMs <= nowMs;

  if (isExpired) {
    const def = EDITION_CATALOG.community;
    const { organization_id: _orgId, activated_by_user_id: _actor, ...publicLicense } = stored;
    return {
      edition: 'community',
      edition_label: `${def.label} (лицензия истекла)`,
      license_status: 'expired',
      features: [...def.features],
      limits: { ...def.limits },
      usage,
      license: publicLicense
    };
  }

  const def = EDITION_CATALOG[stored.edition];
  const { organization_id: _orgId, activated_by_user_id: _actor, ...publicLicense } = stored;
  return {
    edition: stored.edition,
    edition_label: def.label,
    license_status: 'active',
    features: [...def.features],
    limits: {
      max_users: stored.max_users !== undefined ? stored.max_users : def.limits.max_users,
      max_assets: stored.max_assets !== undefined ? stored.max_assets : def.limits.max_assets,
      max_software_licenses:
        stored.max_software_licenses !== undefined
          ? stored.max_software_licenses
          : def.limits.max_software_licenses
    },
    usage,
    license: publicLicense
  };
}

export function hasFeature(entitlements: EditionEntitlements, feature: EnterpriseFeature): boolean {
  return entitlements.features.includes(feature);
}

export interface EnterpriseSlaInput {
  organizationName: string;
  entitlements: EditionEntitlements;
  assets: Array<{ status: string }>;
  softwareLicenses: Array<{ status: string; seats_total: number; seats_used: number; expires_at: string | null }>;
  maintenanceRequests: Array<{ status: string; priority: string; created_at: string; resolved_at: string | null }>;
  snapshots: Array<{ created_at: string; integrity_status: string }>;
  drills: Array<{ assessment: string; generated_at: string; measurements_seconds: { observed_rto: number; observed_rpo: number | null } }>;
}

export interface EnterpriseSlaReport {
  generated_at: string;
  organization_name: string;
  edition: ProductEdition;
  license_id: string | null;
  availability_and_assets: {
    total_assets: number;
    active_assets: number;
    in_repair_assets: number;
    retired_assets: number;
    operational_availability_pct: number;
  };
  maintenance_sla: {
    total_tickets: number;
    resolved_tickets: number;
    open_or_in_progress: number;
    open_high_or_urgent: number;
    oldest_open_priority_hours: number | null;
    mean_time_to_resolve_hours: number | null;
  };
  software_compliance: {
    total_licenses: number;
    seats_total: number;
    seats_used: number;
    utilization_pct: number;
    expiring_within_60d: number;
  };
  resilience_and_dr: {
    verified_snapshots_count: number;
    corrupted_snapshots_count: number;
    latest_snapshot_at: string | null;
    total_drills: number;
    drills_within_targets: number;
    dr_compliance_pct: number | null;
  };
}

export function buildEnterpriseSlaReport(input: EnterpriseSlaInput): EnterpriseSlaReport {
  const nowMs = Date.now();
  const totalAssets = input.assets.length;
  const activeAssets = input.assets.filter(a => a.status === 'active').length;
  const inRepairAssets = input.assets.filter(a => a.status === 'in_repair').length;
  const retiredAssets = input.assets.filter(a => a.status === 'retired').length;
  const operationalBase = activeAssets + inRepairAssets;
  const availabilityPct = operationalBase > 0
    ? Math.round((activeAssets / operationalBase) * 1000) / 10
    : 100;

  const resolvedWithTime = input.maintenanceRequests.filter(m => m.status === 'resolved' && m.resolved_at);
  const mttrHours = resolvedWithTime.length > 0
    ? Math.round(
        (resolvedWithTime.reduce((sum, m) => {
          const deltaMs = Math.max(0, new Date(m.resolved_at as string).getTime() - new Date(m.created_at).getTime());
          return sum + deltaMs / 3600000;
        }, 0) / resolvedWithTime.length) * 100
      ) / 100
    : null;

  const activeTickets = input.maintenanceRequests.filter(m => m.status === 'open' || m.status === 'in_progress');
  const openHighOrUrgent = activeTickets.filter(m => m.priority === 'high' || m.priority === 'urgent');
  const oldestOpenPriorityHours = openHighOrUrgent.length > 0
    ? Math.round(
        (Math.max(...openHighOrUrgent.map(m => Math.max(0, nowMs - new Date(m.created_at).getTime()))) / 3600000) * 10
      ) / 10
    : null;

  const seatsTotal = input.softwareLicenses.reduce((sum, l) => sum + (l.seats_total || 0), 0);
  const seatsUsed = input.softwareLicenses.reduce((sum, l) => sum + (l.seats_used || 0), 0);
  const in60dMs = nowMs + 60 * 24 * 60 * 60 * 1000;
  const expiringWithin60d = input.softwareLicenses.filter(l => {
    if (l.status !== 'active' || !l.expires_at) return false;
    return new Date(l.expires_at).getTime() <= in60dMs;
  }).length;

  const verifiedSnapshots = input.snapshots.filter(s => s.integrity_status === 'verified');
  const corruptedSnapshots = input.snapshots.filter(s => s.integrity_status === 'corrupted');
  const assessedDrills = input.drills.filter(d => d.assessment !== 'not_assessed');
  const passedDrills = assessedDrills.filter(d => d.assessment === 'within_targets');

  return {
    generated_at: new Date(nowMs).toISOString(),
    organization_name: input.organizationName,
    edition: input.entitlements.edition,
    license_id: input.entitlements.license?.license_id ?? null,
    availability_and_assets: {
      total_assets: totalAssets,
      active_assets: activeAssets,
      in_repair_assets: inRepairAssets,
      retired_assets: retiredAssets,
      operational_availability_pct: availabilityPct
    },
    maintenance_sla: {
      total_tickets: input.maintenanceRequests.length,
      resolved_tickets: input.maintenanceRequests.filter(m => m.status === 'resolved').length,
      open_or_in_progress: activeTickets.length,
      open_high_or_urgent: openHighOrUrgent.length,
      oldest_open_priority_hours: oldestOpenPriorityHours,
      mean_time_to_resolve_hours: mttrHours
    },
    software_compliance: {
      total_licenses: input.softwareLicenses.length,
      seats_total: seatsTotal,
      seats_used: seatsUsed,
      utilization_pct: seatsTotal > 0 ? Math.round((seatsUsed / seatsTotal) * 1000) / 10 : 0,
      expiring_within_60d: expiringWithin60d
    },
    resilience_and_dr: {
      verified_snapshots_count: verifiedSnapshots.length,
      corrupted_snapshots_count: corruptedSnapshots.length,
      latest_snapshot_at: input.snapshots[0]?.created_at ?? null,
      total_drills: input.drills.length,
      drills_within_targets: passedDrills.length,
      dr_compliance_pct: assessedDrills.length > 0
        ? Math.round((passedDrills.length / assessedDrills.length) * 1000) / 10
        : null
    }
  };
}

export function formatEnterpriseSlaCsv(report: EnterpriseSlaReport): string {
  const safe = (val: unknown) => {
    if (val === null || val === undefined) return '""';
    let s = String(val);
    if (/^[=+\-@]/.test(s.replace(/^[ \t\r\n]+/, '')) || /^[\t\r\n]/.test(s)) {
      s = `'${s}`;
    }
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows: Array<[string, string | number | null]> = [
    ['generated_at', report.generated_at],
    ['organization_name', report.organization_name],
    ['edition', report.edition],
    ['license_id', report.license_id ?? ''],
    ['total_assets', report.availability_and_assets.total_assets],
    ['active_assets', report.availability_and_assets.active_assets],
    ['in_repair_assets', report.availability_and_assets.in_repair_assets],
    ['retired_assets', report.availability_and_assets.retired_assets],
    ['operational_availability_pct', report.availability_and_assets.operational_availability_pct],
    ['maintenance_total_tickets', report.maintenance_sla.total_tickets],
    ['maintenance_resolved_tickets', report.maintenance_sla.resolved_tickets],
    ['maintenance_open_or_in_progress', report.maintenance_sla.open_or_in_progress],
    ['maintenance_open_high_or_urgent', report.maintenance_sla.open_high_or_urgent],
    ['maintenance_oldest_open_priority_hours', report.maintenance_sla.oldest_open_priority_hours],
    ['maintenance_mttr_hours', report.maintenance_sla.mean_time_to_resolve_hours],
    ['software_total_licenses', report.software_compliance.total_licenses],
    ['software_seats_total', report.software_compliance.seats_total],
    ['software_seats_used', report.software_compliance.seats_used],
    ['software_utilization_pct', report.software_compliance.utilization_pct],
    ['software_expiring_within_60d', report.software_compliance.expiring_within_60d],
    ['verified_snapshots_count', report.resilience_and_dr.verified_snapshots_count],
    ['corrupted_snapshots_count', report.resilience_and_dr.corrupted_snapshots_count],
    ['total_drills', report.resilience_and_dr.total_drills],
    ['drills_within_targets', report.resilience_and_dr.drills_within_targets],
    ['dr_compliance_pct', report.resilience_and_dr.dr_compliance_pct]
  ];
  return '\uFEFF' + ['metric,value', ...rows.map(([k, v]) => `${safe(k)},${safe(v)}`)].join('\n');
}

export function buildSanitizedSupportBundle(params: {
  organizationName: string;
  entitlements: EditionEntitlements;
  nodeVersion: string;
  uptimeSeconds: number;
  readinessChecks: Array<{ id: string; label: string; status: string; detail: string }>;
  requestsSummary: {
    total: number;
    api: number;
    error_4xx: number;
    error_5xx: number;
    rate_limit_blocks: number;
    avg_duration_ms: number;
    p95_duration_ms: number;
  };
  recentHttpErrors: Array<{ id: number; timestamp: string; method: string; path: string; status: number; duration_ms: number }>;
}) {
  return {
    bundle_type: 'ecc_sanitized_support_bundle',
    schema_version: 1,
    generated_at: new Date().toISOString(),
    redaction_notice: 'Contains no passwords, password hashes, signing secrets, bearer tokens, emails, or tenant record payloads.',
    runtime: {
      node_version: params.nodeVersion,
      uptime_seconds: params.uptimeSeconds
    },
    subscription: {
      organization_name: params.organizationName,
      edition: params.entitlements.edition,
      license_status: params.entitlements.license_status,
      license_id: params.entitlements.license?.license_id ?? null,
      expires_at: params.entitlements.license?.expires_at ?? null,
      limits: params.entitlements.limits,
      usage: params.entitlements.usage
    },
    readiness_checks: params.readinessChecks,
    requests_summary: params.requestsSummary,
    recent_http_errors: params.recentHttpErrors.slice(0, 25)
  };
}

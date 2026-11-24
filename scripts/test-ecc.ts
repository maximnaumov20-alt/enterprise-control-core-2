import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveLicenseSigningKey, signOfflineLicenseToken } from '../server/licensing';

const TEST_PORT = 3999;
const TEST_LICENSE_SIGNING_KEY = 'ecc-test-offline-license-signing-key-at-least-32-bytes';

// The application must not silently use a published/default license verification key.
const previousLicenseSigningKey = process.env.ECC_LICENSE_SIGNING_KEY;
delete process.env.ECC_LICENSE_SIGNING_KEY;
const missingLicenseSigningKey = resolveLicenseSigningKey();
assert.equal(missingLicenseSigningKey.configured, false);
assert.equal(missingLicenseSigningKey.key, '');
if (previousLicenseSigningKey === undefined) {
  delete process.env.ECC_LICENSE_SIGNING_KEY;
} else {
  process.env.ECC_LICENSE_SIGNING_KEY = previousLicenseSigningKey;
}
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return res;
    } catch {
      // Server still booting
    }
    await sleep(200);
  }
  throw new Error(`ECC API server failed to respond within ${timeoutMs}ms`);
}

async function login(email: string, password: string, headers: Record<string, string> = {}) {
  const body = new URLSearchParams({ username: email, password });
  const res = await fetch(`${BASE_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body
  });
  return { status: res.status, headers: res.headers, json: await res.json() };
}

async function apiJson(route: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${route}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, json, text };
}

async function runTests() {
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-test-'));
  const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  const serverProc = spawn(tsxBin, ['server.ts'], {
    detached: true,
    env: {
      ...process.env,
      ECC_PORT: String(TEST_PORT),
      ECC_DATA_DIR: tmpDataDir,
      ECC_DISABLE_VITE: 'true',
      ECC_SECRET_KEY: 'ecc-automated-test-secret-key-at-least-32-bytes-long',
      ECC_LICENSE_SIGNING_KEY: TEST_LICENSE_SIGNING_KEY,
      ACCESS_TOKEN_MINUTES: '20',
      AUTH_RATE_LIMIT_MAX: '5',
      AUTH_RATE_LIMIT_WINDOW_SECONDS: '60',
      ECC_BACKUP_RETENTION_COUNT: '2',
      CORS_ORIGINS: 'https://ecc.example.com'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderrBuf = '';
  serverProc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString();
  });

  try {
    // 1. Health + security headers
    const healthRes = await waitForHealth();
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(healthRes.headers.get('cache-control'), 'no-store');
    assert.equal(healthRes.headers.get('x-powered-by'), null);
    assert.match(healthRes.headers.get('content-security-policy') || '', /default-src 'none'/);
    console.log('✓ 1. Healthcheck & API security headers');

    // 2. Bad JSON 400 + Unknown /api/* 404 + Strict CORS
    const badJsonRes = await fetch(`${BASE_URL}/api/v1/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken": '
    });
    assert.equal(badJsonRes.status, 400);
    const badJsonBody = await badJsonRes.json();
    assert.equal(typeof badJsonBody.detail, 'string');

    const unknownApiRes = await fetch(`${BASE_URL}/api/v1/does-not-exist`);
    assert.equal(unknownApiRes.status, 404);
    assert.equal(unknownApiRes.headers.get('content-type')?.includes('application/json'), true);

    const corsAllowed = await fetch(`${BASE_URL}/health`, {
      headers: { Origin: 'https://ecc.example.com' }
    });
    assert.equal(corsAllowed.headers.get('access-control-allow-origin'), 'https://ecc.example.com');

    const corsDenied = await fetch(`${BASE_URL}/health`, {
      headers: { Origin: 'https://evil.example.org' }
    });
    assert.equal(corsDenied.headers.get('access-control-allow-origin'), null);
    console.log('✓ 2. Malformed JSON 400, clean API 404 & strict CORS allowlist');

    // 3. Auth login & 20m TTL + 401 WWW-Authenticate
    const badLogin = await login('admin@example.com', 'wrong-password', { 'X-Real-IP': '198.51.100.10' });
    assert.equal(badLogin.status, 401);
    assert.equal(badLogin.headers.get('www-authenticate'), 'Bearer');

    const adminLogin = await login('admin@example.com', 'admin12345678', { 'X-Real-IP': '198.51.100.11' });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.json.token_type, 'bearer');
    assert.equal(adminLogin.json.expires_in, 1200);
    const adminToken = adminLogin.json.access_token as string;
    console.log('✓ 3. Auth 401 WWW-Authenticate & 20-minute JWT/Bearer TTL (1200s)');

    // 4. Login rate limit by X-Real-IP (ignoring spoofed X-Forwarded-For)
    for (let i = 0; i < 5; i += 1) {
      const attempt = await login('admin@example.com', 'wrong-pass', {
        'X-Real-IP': '198.51.100.77',
        'X-Forwarded-For': `203.0.113.${i + 1}`
      });
      assert.equal(attempt.status, 401);
    }
    const rateLimited = await login('admin@example.com', 'wrong-pass', {
      'X-Real-IP': '198.51.100.77',
      'X-Forwarded-For': '203.0.113.250'
    });
    assert.equal(rateLimited.status, 429);
    assert.ok(Number(rateLimited.headers.get('retry-after')) >= 1);

    const separateIp = await login('admin@example.com', 'wrong-pass', { 'X-Real-IP': '198.51.100.88' });
    assert.equal(separateIp.status, 401);
    console.log('✓ 4. Login rate limit keyed by X-Real-IP (ignoring spoofed X-Forwarded-For)');

    // 5. User creation, duplicate email 409, weak password 422, disable/re-enable token revocation, password change revocation
    const dupUser = await apiJson('/api/v1/users', adminToken, {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', full_name: 'Dup', password: 'StrongPassword123', role: 'viewer' })
    });
    assert.equal(dupUser.status, 409);

    const weakUser = await apiJson('/api/v1/users', adminToken, {
      method: 'POST',
      body: JSON.stringify({ email: 'weak@example.com', full_name: 'Weak', password: 'short', role: 'viewer' })
    });
    assert.equal(weakUser.status, 422);

    const editorCreate = await apiJson('/api/v1/users', adminToken, {
      method: 'POST',
      body: JSON.stringify({ email: 'editor.test@example.com', full_name: 'Editor User', password: 'EditorPassword123!', role: 'editor' })
    });
    assert.equal(editorCreate.status, 201);
    const editorUser = editorCreate.json;

    const viewerCreate = await apiJson('/api/v1/users', adminToken, {
      method: 'POST',
      body: JSON.stringify({ email: 'viewer.test@example.com', full_name: 'Viewer User', password: 'ViewerPassword123!', role: 'viewer' })
    });
    assert.equal(viewerCreate.status, 201);
    const viewerUser = viewerCreate.json;

    const editorLogin1 = await login('editor.test@example.com', 'EditorPassword123!', { 'X-Real-IP': '198.51.100.20' });
    assert.equal(editorLogin1.status, 200);
    const oldEditorToken = editorLogin1.json.access_token as string;

    // Disable editor -> old token must be rejected immediately
    const disableRes = await apiJson(`/api/v1/users/${editorUser.id}`, adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ expected_version: editorUser.version, is_active: false })
    });
    assert.equal(disableRes.status, 200);
    const disabledCheck = await apiJson('/api/v1/auth/me', oldEditorToken);
    assert.equal(disabledCheck.status, 401);

    // Re-enable editor -> old token must STILL remain revoked (token_version incremented again)
    const enableRes = await apiJson(`/api/v1/users/${editorUser.id}`, adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ expected_version: disableRes.json.version, is_active: true })
    });
    assert.equal(enableRes.status, 200);
    const oldTokenAfterEnable = await apiJson('/api/v1/auth/me', oldEditorToken);
    assert.equal(oldTokenAfterEnable.status, 401);

    // Fresh login works + password change revokes previous token
    const editorLogin2 = await login('editor.test@example.com', 'EditorPassword123!', { 'X-Real-IP': '198.51.100.21' });
    assert.equal(editorLogin2.status, 200);
    const freshEditorToken = editorLogin2.json.access_token as string;

    const pwChange = await apiJson('/api/v1/auth/change-password', freshEditorToken, {
      method: 'POST',
      body: JSON.stringify({ current_password: 'EditorPassword123!', new_password: 'NewEditorPassword456!' })
    });
    assert.equal(pwChange.status, 200);
    const afterPwTokenCheck = await apiJson('/api/v1/auth/me', freshEditorToken);
    assert.equal(afterPwTokenCheck.status, 401);

    const editorLogin3 = await login('editor.test@example.com', 'NewEditorPassword456!', { 'X-Real-IP': '198.51.100.22' });
    assert.equal(editorLogin3.status, 200);
    const editorToken = editorLogin3.json.access_token as string;

    const viewerLogin = await login('viewer.test@example.com', 'ViewerPassword123!', { 'X-Real-IP': '198.51.100.23' });
    assert.equal(viewerLogin.status, 200);
    const viewerToken = viewerLogin.json.access_token as string;
    console.log('✓ 5. User validation, disable/re-enable token revocation & password change revocation');

    // 6. RBAC matrix across admin / editor / viewer
    for (const restrictedPath of [
      '/api/v1/users',
      '/api/v1/audit-events',
      '/api/v1/audit-events/export',
      '/api/v1/system/backup',
      '/api/v1/system/telemetry',
      '/api/v1/system/recovery-drills',
      '/api/v1/system/backup/snapshots'
    ]) {
      assert.equal((await apiJson(restrictedPath, viewerToken)).status, 403, `viewer GET ${restrictedPath}`);
      assert.equal((await apiJson(restrictedPath, editorToken)).status, 403, `editor GET ${restrictedPath}`);
    }
    assert.equal((await apiJson('/api/v1/departments', viewerToken)).status, 403);
    assert.equal((await apiJson('/api/v1/employees', viewerToken)).status, 403);
    assert.equal((await apiJson('/api/v1/departments', editorToken)).status, 200);
    assert.equal((await apiJson('/api/v1/employees', editorToken)).status, 200);
    assert.equal(
      (await apiJson('/api/v1/assets', viewerToken, {
        method: 'POST',
        body: JSON.stringify({ name: 'Blocked', asset_tag: 'BLK-01', category: 'Компьютер' })
      })).status,
      403
    );
    console.log('✓ 6. RBAC matrix enforced for admin, editor & viewer');

    // 7. Assets CRUD, validation, optimistic locking & atomic bulk update
    const assetA = await apiJson('/api/v1/assets', editorToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Server A', asset_tag: 'TST-SRV-01', category: 'Сервер', status: 'active' })
    });
    assert.equal(assetA.status, 201);
    const assetB = await apiJson('/api/v1/assets', editorToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Switch B', asset_tag: 'TST-SW-02', category: 'Сеть', status: 'active' })
    });
    assert.equal(assetB.status, 201);

    const dupAsset = await apiJson('/api/v1/assets', editorToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Dup Tag', asset_tag: 'tst-srv-01', category: 'Сервер' })
    });
    assert.equal(dupAsset.status, 409);

    // Atomic bulk failure when second asset has stale version -> first asset MUST remain unchanged
    const atomicFail = await apiJson('/api/v1/assets/bulk', editorToken, {
      method: 'PATCH',
      body: JSON.stringify({
        asset_ids: [assetA.json.id, assetB.json.id],
        versions: { [assetA.json.id]: assetA.json.version, [assetB.json.id]: 999 },
        status: 'in_repair'
      })
    });
    assert.equal(atomicFail.status, 409);
    const checkAssetA = await apiJson(`/api/v1/assets/${assetA.json.id}`, editorToken);
    assert.equal(checkAssetA.json.status, 'active');
    assert.equal(checkAssetA.json.version, assetA.json.version);

    // Missing ID in bulk -> 404
    const bulkMissing = await apiJson('/api/v1/assets/bulk', editorToken, {
      method: 'PATCH',
      body: JSON.stringify({
        asset_ids: [assetA.json.id, 999999],
        versions: { [assetA.json.id]: assetA.json.version, 999999: 1 },
        status: 'in_repair'
      })
    });
    assert.equal(bulkMissing.status, 404);

    // Valid bulk update
    const bulkOk = await apiJson('/api/v1/assets/bulk', editorToken, {
      method: 'PATCH',
      body: JSON.stringify({
        asset_ids: [assetA.json.id, assetB.json.id],
        versions: { [assetA.json.id]: assetA.json.version, [assetB.json.id]: assetB.json.version },
        status: 'in_repair',
        assigned_to: 'ИТ-служба'
      })
    });
    assert.equal(bulkOk.status, 200);
    assert.equal(bulkOk.json.updated, 2);
    assert.equal(bulkOk.json.assets[0].version, assetA.json.version + 1);

    // Repeating same bulk payload (no-op) must NOT increment version
    const bulkNoop = await apiJson('/api/v1/assets/bulk', editorToken, {
      method: 'PATCH',
      body: JSON.stringify({
        asset_ids: [assetA.json.id, assetB.json.id],
        versions: {
          [assetA.json.id]: bulkOk.json.assets[0].version,
          [assetB.json.id]: bulkOk.json.assets[1].version
        },
        status: 'in_repair',
        assigned_to: 'ИТ-служба'
      })
    });
    assert.equal(bulkNoop.status, 200);
    assert.equal(bulkNoop.json.updated, 0);
    assert.equal(bulkNoop.json.assets[0].version, assetA.json.version + 1);
    console.log('✓ 7. Optimistic locking & atomic bulk asset updates');

    // 8. CSV import & formula neutralization on asset + audit CSV export
    const csvPayload = [
      'name,asset_tag,category,status',
      '"=HYPERLINK(""http://evil.local"")",TST-CSV-01,Компьютер,active',
      '"+SUM(1,2)",TST-CSV-02,Компьютер,active'
    ].join('\n');
    const csvForm = new FormData();
    csvForm.append('file', new Blob([csvPayload], { type: 'text/csv' }), 'import.csv');
    const importRes = await apiJson('/api/v1/assets/import', editorToken, {
      method: 'POST',
      body: csvForm
    });
    assert.equal(importRes.status, 200);
    assert.equal(importRes.json.created, 2);

    const exportAssetsRes = await fetch(`${BASE_URL}/api/v1/assets/export`, {
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    assert.equal(exportAssetsRes.status, 200);
    const exportedAssetsCsv = await exportAssetsRes.text();
    assert.ok(exportedAssetsCsv.includes(`"'=HYPERLINK`), 'Asset CSV export must neutralize =formula');
    assert.ok(exportedAssetsCsv.includes(`"'+SUM(1,2)"`), 'Asset CSV export must neutralize +formula');

    const auditCsvRes = await fetch(`${BASE_URL}/api/v1/audit-events/export?entity_type=asset`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(auditCsvRes.status, 200);
    const auditCsvBuf = Buffer.from(await auditCsvRes.arrayBuffer());
    assert.equal(auditCsvBuf[0], 0xef, 'Audit CSV must start with UTF-8 BOM byte 0xEF');
    assert.equal(auditCsvBuf[1], 0xbb, 'Audit CSV must start with UTF-8 BOM byte 0xBB');
    assert.equal(auditCsvBuf[2], 0xbf, 'Audit CSV must start with UTF-8 BOM byte 0xBF');
    const auditCsvText = auditCsvBuf.subarray(3).toString('utf-8');
    assert.ok(auditCsvText.startsWith('id,created_at'), 'Audit CSV header mismatch');
    console.log('✓ 8. CSV import, spreadsheet formula neutralization & audit CSV export');

    // 9. Maintenance privacy for viewer, priority/status updates, and asset delete protection (409)
    const adminMaint = await apiJson('/api/v1/maintenance-requests', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        asset_id: assetA.json.id,
        title: 'Admin private maintenance',
        description: 'Replace RAID battery',
        priority: 'high'
      })
    });
    assert.equal(adminMaint.status, 201);

    const viewerMaint = await apiJson('/api/v1/maintenance-requests', viewerToken, {
      method: 'POST',
      body: JSON.stringify({
        asset_id: assetB.json.id,
        title: 'Viewer maintenance ticket',
        description: 'Port flickering',
        priority: 'normal'
      })
    });
    assert.equal(viewerMaint.status, 201);

    const viewerMaintList = await apiJson('/api/v1/maintenance-requests', viewerToken);
    assert.equal(viewerMaintList.status, 200);
    assert.equal(viewerMaintList.json.some((m: any) => m.id === adminMaint.json.id), false);
    assert.equal(viewerMaintList.json.some((m: any) => m.id === viewerMaint.json.id), true);
    assert.equal((await apiJson(`/api/v1/maintenance-requests/${adminMaint.json.id}`, viewerToken)).status, 404);

    // Editor can change priority + status to resolved
    const maintPatch = await apiJson(`/api/v1/maintenance-requests/${adminMaint.json.id}`, editorToken, {
      method: 'PATCH',
      body: JSON.stringify({ expected_version: adminMaint.json.version, priority: 'urgent', status: 'resolved' })
    });
    assert.equal(maintPatch.status, 200);
    assert.equal(maintPatch.json.priority, 'urgent');
    assert.ok(maintPatch.json.resolved_at);

    // Asset referenced by maintenance cannot be deleted (409)
    const blockedDelete = await apiJson(`/api/v1/assets/${assetA.json.id}`, editorToken, { method: 'DELETE' });
    assert.equal(blockedDelete.status, 409);

    // Delete maintenance then delete asset cleanly
    assert.equal((await apiJson(`/api/v1/maintenance-requests/${adminMaint.json.id}`, editorToken, { method: 'DELETE' })).status, 204);
    assert.equal((await apiJson(`/api/v1/assets/${assetA.json.id}`, editorToken, { method: 'DELETE' })).status, 204);
    console.log('✓ 9. Maintenance viewer isolation, priority/status workflow & 409 delete guard');

    // 10. Software license validation & search filter
    const badSeats = await apiJson('/api/v1/software-licenses', editorToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad Lic', license_type: 'subscription', seats_total: 5, seats_used: 10 })
    });
    assert.equal(badSeats.status, 422);

    const badDates = await apiJson('/api/v1/software-licenses', editorToken, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bad Dates Lic',
        license_type: 'subscription',
        seats_total: 5,
        purchased_at: '2026-10-01',
        expires_at: '2026-01-01'
      })
    });
    assert.equal(badDates.status, 422);
    console.log('✓ 10. Software license seat/date boundary validation');

    // 11. Backup SHA-256 export, dry-run verify, tampered rejection, snapshots & retention (limit=2)
    const backupRes = await fetch(`${BASE_URL}/api/v1/system/backup`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(backupRes.status, 200);
    const backupHeaderDigest = backupRes.headers.get('x-ecc-backup-sha256');
    assert.ok(backupHeaderDigest && backupHeaderDigest.length === 64);
    const backupJson = await backupRes.json();
    assert.equal(backupJson.integrity?.algorithm, 'sha256');
    assert.equal(backupJson.integrity?.digest, backupHeaderDigest);

    const verifyOk = await apiJson('/api/v1/system/backup/verify', adminToken, {
      method: 'POST',
      body: JSON.stringify(backupJson)
    });
    assert.equal(verifyOk.status, 200);
    assert.equal(verifyOk.json.valid, true);
    assert.equal(verifyOk.json.checksum_status, 'verified');

    const tampered = structuredClone(backupJson);
    tampered.assets = [];
    const verifyTampered = await apiJson('/api/v1/system/backup/verify', adminToken, {
      method: 'POST',
      body: JSON.stringify(tampered)
    });
    assert.equal(verifyTampered.status, 422);

    const restoreTampered = await apiJson('/api/v1/system/restore', adminToken, {
      method: 'POST',
      body: JSON.stringify(tampered)
    });
    assert.equal(restoreTampered.status, 422);

    // Create 3 snapshots with retention limit 2 -> only 2 newest remain
    const snap1 = await apiJson('/api/v1/system/backup/snapshots', adminToken, { method: 'POST' });
    assert.equal(snap1.status, 201);
    await sleep(15);
    const snap2 = await apiJson('/api/v1/system/backup/snapshots', adminToken, { method: 'POST' });
    assert.equal(snap2.status, 201);
    await sleep(15);
    const snap3 = await apiJson('/api/v1/system/backup/snapshots', adminToken, { method: 'POST' });
    assert.equal(snap3.status, 201);

    const snapsList = await apiJson('/api/v1/system/backup/snapshots', adminToken);
    assert.equal(snapsList.status, 200);
    assert.equal(snapsList.json.length, 2);
    assert.equal(snapsList.json[0].integrity_status, 'verified');

    const snapDownload = await fetch(`${BASE_URL}/api/v1/system/backup/snapshots/${encodeURIComponent(snapsList.json[0].filename)}/download`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(snapDownload.status, 200);
    console.log('✓ 11. SHA-256 backup export, dry-run verify, tamper rejection & snapshot retention rotation');

    // 12. Recovery Drill Report (PR #96 parity)
    const drillBadTz = await apiJson('/api/v1/system/recovery-drills', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        backup_reference: snapsList.json[0].filename,
        incident_at: '2026-11-24T06:10:00',
        restore_completed_at: '2026-11-24T06:18:00Z'
      })
    });
    assert.equal(drillBadTz.status, 422);

    const drillMissingLastCommitted = await apiJson('/api/v1/system/recovery-drills', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        backup_reference: snapsList.json[0].filename,
        incident_at: '2026-11-24T06:10:00Z',
        restore_completed_at: '2026-11-24T06:18:00Z',
        rpo_target_seconds: 300
      })
    });
    assert.equal(drillMissingLastCommitted.status, 422);

    const drillOk = await apiJson('/api/v1/system/recovery-drills', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        backup_reference: snapsList.json[0].filename,
        incident_at: '2026-11-24T06:10:00Z',
        restore_started_at: '2026-11-24T06:12:00Z',
        restore_completed_at: '2026-11-24T06:18:00Z',
        last_committed_at: '2026-11-24T06:07:00Z',
        rto_target_seconds: 900,
        rpo_target_seconds: 300
      })
    });
    assert.equal(drillOk.status, 201);
    assert.equal(drillOk.json.measurements_seconds.observed_rto, 480);
    assert.equal(drillOk.json.measurements_seconds.restore_execution, 360);
    assert.equal(drillOk.json.measurements_seconds.observed_rpo, 180);
    assert.equal(drillOk.json.assessment, 'within_targets');

    const drillDownload = await apiJson(`/api/v1/system/recovery-drills/${drillOk.json.id}/download`, adminToken);
    assert.equal(drillDownload.status, 200);
    assert.equal(drillDownload.json.organization_id, undefined);
    console.log('✓ 12. Measured recovery drill validation, RTO/RPO calculations & export');

    // 13. System telemetry & readiness checks
    const telemetry = await apiJson('/api/v1/system/telemetry', adminToken);
    assert.equal(telemetry.status, 200);
    assert.equal(typeof telemetry.json.requests.avg_duration_ms, 'number');
    assert.equal(typeof telemetry.json.requests.p95_duration_ms, 'number');
    assert.equal(telemetry.json.backup_readiness.local_snapshots_count, 2);
    assert.equal(telemetry.json.backup_readiness.last_drill_assessment, 'within_targets');
    assert.equal(telemetry.json.readiness_checks.length, 7);
    assert.equal(telemetry.json.readiness_checks.find((c: any) => c.id === 'secret_key')?.status, 'pass');
    assert.equal(telemetry.json.readiness_checks.find((c: any) => c.id === 'license_signing_key')?.status, 'pass');
    assert.equal(telemetry.json.readiness_checks.find((c: any) => c.id === 'backup_retention')?.status, 'pass');
    assert.equal(telemetry.json.readiness_checks.find((c: any) => c.id === 'recovery_drill')?.status, 'pass');
    console.log('✓ 13. System telemetry, latency percentiles & operational readiness checks');

    // 14. Commercial Edition boundaries, offline ECC1 activation, quotas, SLA report & sanitized support bundle
    const communityEdition = await apiJson('/api/v1/system/edition', viewerToken);
    assert.equal(communityEdition.status, 200);
    assert.equal(communityEdition.json.edition, 'community');
    assert.equal(communityEdition.json.limits.max_assets, 250);

    // Community gates must block Enterprise endpoints (403), and non-admins cannot view /system/license
    assert.equal((await apiJson('/api/v1/system/license', editorToken)).status, 403);
    assert.equal((await apiJson('/api/v1/enterprise/sla-report', adminToken)).status, 403);
    assert.equal((await apiJson('/api/v1/enterprise/support-bundle', adminToken)).status, 403);

    // Invalid / expired / wrong-org offline keys must be rejected (422)
    assert.equal(
      (await apiJson('/api/v1/system/license/activate', adminToken, {
        method: 'POST',
        body: JSON.stringify({ license_key: 'ECC1.broken.signature' })
      })).status,
      422
    );

    const expiredKey = signOfflineLicenseToken({
      schema_version: 1,
      license_id: 'LIC-EXP-01',
      edition: 'enterprise',
      customer_name: 'Expired Co',
      organization_name: 'Default Organization',
      issued_at: '2024-01-01T00:00:00Z',
      expires_at: '2025-01-01T00:00:00Z'
    }, TEST_LICENSE_SIGNING_KEY);
    assert.equal(
      (await apiJson('/api/v1/system/license/activate', adminToken, {
        method: 'POST',
        body: JSON.stringify({ license_key: expiredKey })
      })).status,
      422
    );

    const wrongOrgKey = signOfflineLicenseToken({
      schema_version: 1,
      license_id: 'LIC-ORG-99',
      edition: 'enterprise',
      customer_name: 'Other Org',
      organization_name: 'Another Company LLC',
      issued_at: new Date(Date.now() - 86400000).toISOString(),
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
    }, TEST_LICENSE_SIGNING_KEY);
    assert.equal(
      (await apiJson('/api/v1/system/license/activate', adminToken, {
        method: 'POST',
        body: JSON.stringify({ license_key: wrongOrgKey })
      })).status,
      422
    );

    // Activate tight Professional quota (current assets + 1) to verify quota enforcement
    const currentAssetUsage = communityEdition.json.usage.assets as number;
    const tightProKey = signOfflineLicenseToken({
      schema_version: 1,
      license_id: 'LIC-PRO-QUOTA',
      edition: 'professional',
      customer_name: 'Pilot Pro Customer',
      organization_name: 'Default Organization',
      issued_at: new Date(Date.now() - 86400000).toISOString(),
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      max_assets: currentAssetUsage + 1
    }, TEST_LICENSE_SIGNING_KEY);
    const proAct = await apiJson('/api/v1/system/license/activate', adminToken, {
      method: 'POST',
      body: JSON.stringify({ license_key: tightProKey })
    });
    assert.equal(proAct.status, 200);
    assert.equal(proAct.json.edition, 'professional');
    assert.equal(proAct.json.limits.max_assets, currentAssetUsage + 1);

    const withinQuotaAsset = await apiJson('/api/v1/assets', editorToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Within Quota Asset', asset_tag: 'TST-QUOTA-1', category: 'Компьютер' })
    });
    assert.equal(withinQuotaAsset.status, 201);

    const overQuotaAsset = await apiJson('/api/v1/assets', editorToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Over Quota Asset', asset_tag: 'TST-QUOTA-2', category: 'Компьютер' })
    });
    assert.equal(overQuotaAsset.status, 403);
    assert.equal(overQuotaAsset.json.code, 'edition_quota_exceeded');

    // Upgrade to unlimited Enterprise license and verify SLA report (JSON + CSV) & sanitized Support Bundle
    const enterpriseKey = signOfflineLicenseToken({
      schema_version: 1,
      license_id: 'LIC-ENT-2026',
      edition: 'enterprise',
      customer_name: 'Enterprise Corp',
      organization_name: 'Default Organization',
      issued_at: new Date(Date.now() - 86400000).toISOString(),
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString()
    }, TEST_LICENSE_SIGNING_KEY);
    const entAct = await apiJson('/api/v1/system/license/activate', adminToken, {
      method: 'POST',
      body: JSON.stringify({ license_key: enterpriseKey })
    });
    assert.equal(entAct.status, 200);
    assert.equal(entAct.json.edition, 'enterprise');
    assert.equal(entAct.json.limits.max_assets, null);

    const slaJson = await apiJson('/api/v1/enterprise/sla-report', adminToken);
    assert.equal(slaJson.status, 200);
    assert.equal(slaJson.json.license_id, 'LIC-ENT-2026');
    assert.equal(typeof slaJson.json.availability_and_assets.operational_availability_pct, 'number');
    assert.equal(slaJson.json.resilience_and_dr.dr_compliance_pct, 100);

    const slaCsvRes = await fetch(`${BASE_URL}/api/v1/enterprise/sla-report?format=csv`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(slaCsvRes.status, 200);
    const slaCsvBuf = Buffer.from(await slaCsvRes.arrayBuffer());
    assert.equal(slaCsvBuf[0], 0xef);
    assert.ok(slaCsvBuf.subarray(3).toString('utf-8').startsWith('metric,value'));

    const bundleRes = await apiJson('/api/v1/enterprise/support-bundle', adminToken);
    assert.equal(bundleRes.status, 200);
    assert.equal(bundleRes.json.bundle_type, 'ecc_sanitized_support_bundle');
    assert.equal(bundleRes.json.subscription.license_id, 'LIC-ENT-2026');
    const bundleRaw = JSON.stringify(bundleRes.json);
    assert.equal(bundleRaw.includes('scrypt:'), false, 'Support bundle must not contain password hashes');
    assert.equal(bundleRaw.includes(TEST_LICENSE_SIGNING_KEY), false, 'Support bundle must not leak signing keys');
    assert.equal(bundleRaw.includes(adminToken), false, 'Support bundle must not leak bearer tokens');

    // Non-admin blocked from Enterprise endpoints
    assert.equal((await apiJson('/api/v1/enterprise/sla-report', editorToken)).status, 403);
    assert.equal((await apiJson('/api/v1/enterprise/support-bundle', viewerToken)).status, 403);

    // Deactivate license -> cleanly reverts to Community without losing data
    const deact = await apiJson('/api/v1/system/license/deactivate', adminToken, { method: 'POST' });
    assert.equal(deact.status, 200);
    assert.equal(deact.json.edition, 'community');
    assert.equal((await apiJson('/api/v1/enterprise/sla-report', adminToken)).status, 403);
    console.log('✓ 14. Commercial edition boundaries, offline ECC1 activation, quotas, SLA report & sanitized support bundle');

    console.log('\nALL ECC INTEGRATION & SECURITY PARITY TESTS PASSED (14/14 SUITES)!');
  } catch (err) {
    console.error('TEST FAILURE:', err);
    if (stderrBuf) {
      console.error('SERVER STDERR:\n', stderrBuf);
    }
    process.exitCode = 1;
  } finally {
    if (serverProc.pid) {
      try {
        process.kill(-serverProc.pid, 'SIGTERM');
      } catch { /* already exited */ }
      await sleep(250);
      try {
        process.kill(-serverProc.pid, 'SIGKILL');
      } catch { /* already exited */ }
    }
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  }
}

runTests();

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  api,
  Asset,
  AssetInput,
  AssetStatus,
  AssetHistoryEvent,
  AssigneeOption,
  AuditEvent,
  BackupSnapshot,
  BackupVerifyResult,
  CurrentUser,
  Department,
  EditionResponse,
  Employee,
  EmployeeInput,
  EnterpriseSlaReport,
  MaintenancePriority,
  MaintenanceRequest,
  MaintenanceRequestInput,
  MaintenanceStatus,
  ManagedUser,
  RecoveryDrillAssessment,
  RecoveryDrillReport,
  SoftwareLicense,
  SoftwareLicenseInput,
  SoftwareLicenseStatus,
  SoftwareLicenseType,
  SystemStats,
  SystemTelemetry,
  UserRole,
  setAccessToken
} from "./api";

const emptyForm: AssetInput = {
  name: "",
  asset_tag: "",
  category: "Компьютер",
  manufacturer: "",
  model: "",
  serial_number: "",
  assigned_to: "",
  status: "active"
};

const statusLabels: Record<AssetStatus, string> = {
  active: "В эксплуатации",
  in_repair: "В ремонте",
  retired: "Списано"
};

const emptySoftwareForm: SoftwareLicenseInput = {
  name: "",
  publisher: "",
  version: "",
  license_type: "subscription",
  license_reference: "",
  seats_total: 1,
  seats_used: 0,
  purchased_at: null,
  expires_at: null,
  status: "active",
  notes: ""
};

const licenseTypeLabels: Record<SoftwareLicenseType, string> = {
  subscription: "Подписка",
  perpetual: "Бессрочная",
  oem: "OEM",
  site: "Корпоративная"
};

const licenseStatusLabels: Record<SoftwareLicenseStatus, string> = {
  active: "Активна",
  suspended: "Приостановлена",
  retired: "Закрыта"
};

const emptyEmployeeForm: EmployeeInput = {
  employee_number: "",
  full_name: "",
  department_id: null,
  email: null,
  job_title: "",
  phone: ""
};

const emptyMaintenanceForm: MaintenanceRequestInput = {
  asset_id: 0,
  title: "",
  description: "",
  priority: "normal"
};

const maintenanceStatusLabels: Record<MaintenanceStatus, string> = {
  open: "Открыта",
  in_progress: "В работе",
  resolved: "Решена",
  cancelled: "Отменена"
};

const maintenancePriorityLabels: Record<MaintenancePriority, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный"
};

function renderAssetBarcode(code: string) {
  const bars: { width: number; isBlack: boolean }[] = [];
  bars.push({ width: 3, isBlack: true });
  bars.push({ width: 2, isBlack: false });
  bars.push({ width: 2, isBlack: true });
  bars.push({ width: 2, isBlack: false });
  for (let i = 0; i < code.length; i++) {
    const val = code.charCodeAt(i);
    bars.push({ width: (val % 3) + 2, isBlack: true });
    bars.push({ width: ((val >> 2) % 2) + 1, isBlack: false });
    bars.push({ width: ((val >> 1) % 3) + 1, isBlack: true });
    bars.push({ width: 2, isBlack: false });
  }
  bars.push({ width: 3, isBlack: true });
  bars.push({ width: 2, isBlack: false });
  bars.push({ width: 2, isBlack: true });

  let curX = 12;
  return (
    <svg width="240" height="54" viewBox="0 0 240 54" style={{ margin: "0 auto", display: "block" }}>
      {bars.map((bar, i) => {
        const x = curX;
        curX += bar.width + 1;
        if (bar.isBlack) {
          return <rect key={i} x={x} y={2} width={bar.width} height={38} fill="#111827" />;
        }
        return null;
      })}
      <text x="120" y="50" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#334155">{code}</text>
    </svg>
  );
}

function renderMiniQr() {
  // Deterministic SVG QR pattern
  const matrix = [
    [1,1,1,1,1,1,1,0,1,0,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,1,1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1,0,1,0,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,1,1,1,0,1,1,1,0,1],
    [1,0,0,0,0,0,1,0,1,0,1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,0,1,0,1,1,1,1,1,1,1],
    [0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [1,1,0,1,0,1,1,1,0,1,0,1,1,0,1,1,1],
    [0,0,0,0,0,0,0,0,1,0,1,1,0,1,0,0,1],
    [1,1,1,1,1,1,1,0,1,1,0,1,0,1,1,0,1],
    [1,0,0,0,0,0,1,0,0,1,1,0,1,0,0,1,0],
    [1,0,1,1,1,0,1,0,1,0,1,1,1,1,0,1,1],
    [1,0,1,1,1,0,1,0,0,1,0,0,1,0,1,0,0],
    [1,0,1,1,1,0,1,0,1,1,1,1,0,1,1,0,1],
    [1,0,0,0,0,0,1,0,1,0,0,1,1,0,0,1,1],
    [1,1,1,1,1,1,1,0,1,1,1,0,1,1,0,1,1],
  ];
  return (
    <svg width="68" height="68" viewBox="0 0 17 17">
      {matrix.map((row, r) =>
        row.map((cell, c) => (cell ? <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#111827" /> : null))
      )}
    </svg>
  );
}

export default function App() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [form, setForm] = useState<AssetInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assetImportFile, setAssetImportFile] = useState<File | null>(null);
  const [assetImporting, setAssetImporting] = useState(false);
  const [assetImportSummary, setAssetImportSummary] = useState<{ created: number; skipped: number; errors: { row: number; error: string }[] } | null>(null);
  const [historyAsset, setHistoryAsset] = useState<Asset | null>(null);
  const [assetHistory, setAssetHistory] = useState<AssetHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<"" | AssetStatus>("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkClearAssignee, setBulkClearAssignee] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [assetStatusFilter, setAssetStatusFilter] = useState<string>("all");
  const [labelAsset, setLabelAsset] = useState<Asset | null>(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [apiOnline, setApiOnline] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin12345678");
  const [loginLoading, setLoginLoading] = useState(false);

  type Section = "overview" | "assets" | "software" | "maintenance" | "employees" | "users" | "audit" | "backups" | "monitoring" | "licensing";
  const [section, setSection] = useState<Section>("overview");

  const [stats, setStats] = useState<SystemStats | null>(null);
  const [editionSummary, setEditionSummary] = useState<EditionResponse | null>(null);
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [licenseSaving, setLicenseSaving] = useState(false);
  const [slaReport, setSlaReport] = useState<EnterpriseSlaReport | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [logStatusFilter, setLogStatusFilter] = useState<"all" | "2xx" | "4xx" | "5xx">("all");
  const [logPathSearch, setLogPathSearch] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeForm, setEmployeeForm] = useState<EmployeeInput>(emptyEmployeeForm);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [employeeSaving, setEmployeeSaving] = useState(false);
  const [departmentForm, setDepartmentForm] = useState({ name: "", code: "" });
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [editingDepartmentVersion, setEditingDepartmentVersion] = useState<number | null>(null);
  const [departmentSaving, setDepartmentSaving] = useState(false);
  const [selectedEmployeeAssets, setSelectedEmployeeAssets] = useState<Employee | null>(null);

  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [maintenanceForm, setMaintenanceForm] = useState<MaintenanceRequestInput>(emptyMaintenanceForm);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceStatusFilter, setMaintenanceStatusFilter] = useState<string>("all");
  const [maintenancePriorityFilter, setMaintenancePriorityFilter] = useState<string>("all");

  const [softwareLicenses, setSoftwareLicenses] = useState<SoftwareLicense[]>([]);
  const [softwareSearch, setSoftwareSearch] = useState("");
  const [softwareForm, setSoftwareForm] = useState<SoftwareLicenseInput>(emptySoftwareForm);
  const [editingSoftwareId, setEditingSoftwareId] = useState<number | null>(null);
  const [softwareSaving, setSoftwareSaving] = useState(false);
  const [softwareStatusFilter, setSoftwareStatusFilter] = useState<string>("all");

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditEntityFilter, setAuditEntityFilter] = useState<string>("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditLimit, setAuditLimit] = useState(100);
  const [userForm, setUserForm] = useState({ email: "", full_name: "", password: "", role: "viewer" as UserRole });
  const [userSaving, setUserSaving] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupVerification, setBackupVerification] = useState<BackupVerifyResult | null>(null);
  const [backupVerifying, setBackupVerifying] = useState(false);
  const [backupRestoring, setBackupRestoring] = useState(false);
  const [backupSnapshots, setBackupSnapshots] = useState<BackupSnapshot[]>([]);
  const [snapshotCreating, setSnapshotCreating] = useState(false);
  const [recoveryDrills, setRecoveryDrills] = useState<RecoveryDrillReport[]>([]);
  const [drillSaving, setDrillSaving] = useState(false);
  const [drillForm, setDrillForm] = useState({
    backup_reference: "",
    incident_at: "",
    restore_started_at: "",
    restore_completed_at: "",
    last_committed_at: "",
    rto_target_seconds: "900",
    rpo_target_seconds: ""
  });

  async function loadOverview(roleOverride?: UserRole) {
    setStatsLoading(true);
    const effectiveRole = roleOverride ?? currentUser?.role;
    try {
      const [statsData, recentEvents, health, editionData] = await Promise.all([
        api.stats(),
        effectiveRole === "admin" ? api.auditEvents(6) : Promise.resolve([] as AuditEvent[]),
        api.health(),
        api.edition()
      ]);
      setStats(statsData);
      setEvents(recentEvents);
      setApiOnline(health.status === "ok");
      setEditionSummary(editionData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить сводку");
    } finally {
      setStatsLoading(false);
    }
  }

  async function loadAssets(term = search, roleOverride?: UserRole) {
    setLoading(true);
    const effectiveRole = roleOverride ?? currentUser?.role;
    try {
      const [items, health, emps] = await Promise.all([
        api.assets(term),
        api.health(),
        effectiveRole !== "viewer" ? api.employees() : Promise.resolve([] as Employee[])
      ]);
      setAssets(items);
      setEmployees(emps);
      setApiOnline(health.status === "ok");
      setError("");
    } catch (e) {
      setApiOnline(false);
      if (e instanceof Error && (e.message.includes("token") || e.message.includes("401"))) {
        setToken(null);
        setCurrentUser(null);
      }
      setError(e instanceof Error ? e.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      void loadOverview(currentUser?.role);
      void loadAssets("", currentUser?.role);
    } else {
      setAssets([]);
      setApiOnline(false);
    }
  }, [token]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoginLoading(true);
    setError("");
    try {
      const result = await api.login(email.trim().toLowerCase(), password);
      setAccessToken(result.access_token);
      const user = await api.me();
      setCurrentUser(user);
      setToken(result.access_token);
      setPassword("");
      setSection("overview");
    } catch (e) {
      setAccessToken(null);
      setToken(null);
      setCurrentUser(null);
      setError(e instanceof Error ? e.message : "Не удалось войти");
    } finally {
      setLoginLoading(false);
    }
  }

  function logout() {
    setAccessToken(null);
    setToken(null);
    setCurrentUser(null);
    resetForm();
  }

  async function submitPasswordChange(event: FormEvent) {
    event.preventDefault();
    setPasswordSaving(true);
    setError("");
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setShowPasswordForm(false);
      setNotice("Пароль успешно изменён.");
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : "Не удалось изменить пароль");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function openOverview() {
    setSection("overview");
    setError("");
    await loadOverview();
  }

  async function openEmployees(term = employeeSearch) {
    setSection("employees");
    setError("");
    try {
      const [employeeItems, departmentItems] = await Promise.all([api.employees(term), api.departments()]);
      setEmployees(employeeItems);
      setDepartments(departmentItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить сотрудников");
    }
  }

  function beginEmployeeEdit(item: Employee) {
    setEditingEmployeeId(item.id);
    setEmployeeForm({
      employee_number: item.employee_number,
      full_name: item.full_name,
      department_id: item.department_id,
      email: item.email,
      job_title: item.job_title || "",
      phone: item.phone || ""
    });
  }

  async function submitEmployee(event: FormEvent) {
    event.preventDefault();
    setEmployeeSaving(true);
    setError("");
    try {
      const payload = {
        ...employeeForm,
        employee_number: employeeForm.employee_number.trim(),
        full_name: employeeForm.full_name.trim(),
        email: employeeForm.email?.trim() || null,
        job_title: employeeForm.job_title?.trim() || null,
        phone: employeeForm.phone?.trim() || null
      };
      if (editingEmployeeId === null) {
        await api.createEmployee(payload);
      } else {
        const employee = employees.find(item => item.id === editingEmployeeId);
        if (!employee) throw new Error("Сотрудник не найден");
        await api.updateEmployee(editingEmployeeId, { ...payload, expected_version: employee.version });
      }
      setEditingEmployeeId(null);
      setEmployeeForm(emptyEmployeeForm);
      setEmployees(await api.employees(employeeSearch));
      setNotice("Данные сотрудника сохранены.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить сотрудника");
    } finally {
      setEmployeeSaving(false);
    }
  }

  async function toggleEmployee(employee: Employee) {
    setError("");
    try {
      await api.updateEmployee(employee.id, {
        expected_version: employee.version,
        is_active: !employee.is_active
      });
      setEmployees(await api.employees(employeeSearch));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить статус");
    }
  }

  function beginDepartmentEdit(dept: Department) {
    setEditingDepartmentId(dept.id);
    setEditingDepartmentVersion(dept.version);
    setDepartmentForm({ name: dept.name, code: dept.code });
  }

  function resetDepartmentForm() {
    setEditingDepartmentId(null);
    setEditingDepartmentVersion(null);
    setDepartmentForm({ name: "", code: "" });
  }

  async function submitDepartment(event: FormEvent) {
    event.preventDefault();
    setDepartmentSaving(true);
    setError("");
    try {
      const payload = {
        name: departmentForm.name.trim(),
        code: departmentForm.code.trim().toUpperCase()
      };
      if (editingDepartmentId === null) {
        await api.createDepartment(payload);
        setNotice("Подразделение успешно добавлено.");
      } else {
        await api.updateDepartment(editingDepartmentId, {
          ...payload,
          expected_version: editingDepartmentVersion ?? 1
        });
        setNotice("Подразделение обновлено.");
      }
      resetDepartmentForm();
      setDepartments(await api.departments());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить подразделение");
    } finally {
      setDepartmentSaving(false);
    }
  }

  async function removeDepartment(dept: Department) {
    if (!confirm(`Удалить подразделение «${dept.name}» (${dept.code})?`)) return;
    setError("");
    try {
      await api.deleteDepartment(dept.id);
      if (editingDepartmentId === dept.id) resetDepartmentForm();
      setDepartments(await api.departments());
      setNotice("Подразделение удалено.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить подразделение");
    }
  }

  async function openMaintenance() {
    setSection("maintenance");
    setError("");
    try {
      const [requests, assetList, assigneeList] = await Promise.all([
        api.maintenanceRequests(),
        api.assets(),
        currentUser?.role !== "viewer" ? api.assignees() : Promise.resolve([] as AssigneeOption[])
      ]);
      setMaintenanceRequests(requests);
      setAssets(assetList);
      setAssignees(assigneeList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить заявки");
    }
  }

  async function submitMaintenance(event: FormEvent) {
    event.preventDefault();
    if (!maintenanceForm.asset_id) {
      setError("Выберите оборудование для заявки");
      return;
    }
    setMaintenanceSaving(true);
    setError("");
    try {
      await api.createMaintenanceRequest({
        ...maintenanceForm,
        title: maintenanceForm.title.trim(),
        description: maintenanceForm.description.trim()
      });
      setMaintenanceForm(emptyMaintenanceForm);
      setMaintenanceRequests(await api.maintenanceRequests());
      setNotice("Заявка на обслуживание успешно зарегистрирована.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать заявку");
    } finally {
      setMaintenanceSaving(false);
    }
  }

  async function changeMaintenanceStatus(item: MaintenanceRequest, status: MaintenanceStatus) {
    setError("");
    try {
      await api.updateMaintenanceRequest(item.id, {
        expected_version: item.version,
        status
      });
      setMaintenanceRequests(await api.maintenanceRequests());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить статус заявки");
    }
  }

  async function changeMaintenancePriority(item: MaintenanceRequest, priority: MaintenancePriority) {
    setError("");
    try {
      await api.updateMaintenanceRequest(item.id, {
        expected_version: item.version,
        priority
      });
      setMaintenanceRequests(await api.maintenanceRequests());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить приоритет заявки");
    }
  }

  async function changeMaintenanceAssignee(item: MaintenanceRequest, assignedToUserId: number | null) {
    setError("");
    try {
      await api.updateMaintenanceRequest(item.id, {
        expected_version: item.version,
        assigned_to_user_id: assignedToUserId
      });
      setMaintenanceRequests(await api.maintenanceRequests());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось назначить исполнителя");
    }
  }

  async function removeMaintenanceRequest(item: MaintenanceRequest) {
    if (!confirm(`Удалить заявку «${item.title}»?`)) return;
    setError("");
    try {
      await api.deleteMaintenanceRequest(item.id);
      setMaintenanceRequests(await api.maintenanceRequests());
      setNotice("Заявка удалена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить заявку");
    }
  }

  async function openSoftware(searchTerm = softwareSearch) {
    setSection("software");
    setError("");
    try {
      setSoftwareLicenses(await api.softwareLicenses(searchTerm));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить лицензии ПО");
    }
  }

  function beginSoftwareEdit(item: SoftwareLicense) {
    setEditingSoftwareId(item.id);
    setSoftwareForm({
      name: item.name,
      publisher: item.publisher || "",
      version: item.version || "",
      license_type: item.license_type,
      license_reference: item.license_reference || "",
      seats_total: item.seats_total,
      seats_used: item.seats_used,
      purchased_at: item.purchased_at,
      expires_at: item.expires_at,
      status: item.status,
      notes: item.notes || ""
    });
  }

  async function submitSoftware(event: FormEvent) {
    event.preventDefault();
    if (softwareForm.seats_used > softwareForm.seats_total) {
      setError("Количество используемых мест не может превышать общее количество");
      return;
    }
    setSoftwareSaving(true);
    setError("");
    try {
      const payload: SoftwareLicenseInput = {
        ...softwareForm,
        name: softwareForm.name.trim(),
        publisher: softwareForm.publisher?.trim() || null,
        version: softwareForm.version?.trim() || null,
        license_reference: softwareForm.license_reference?.trim() || null,
        notes: softwareForm.notes?.trim() || null
      };
      if (editingSoftwareId === null) {
        await api.createSoftwareLicense(payload);
      } else {
        const lic = softwareLicenses.find(item => item.id === editingSoftwareId);
        if (!lic) throw new Error("Лицензия не найдена");
        await api.updateSoftwareLicense(editingSoftwareId, {
          ...payload,
          expected_version: lic.record_version
        });
      }
      setEditingSoftwareId(null);
      setSoftwareForm(emptySoftwareForm);
      setSoftwareLicenses(await api.softwareLicenses(softwareSearch));
      setNotice("Лицензия успешно сохранена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить лицензию");
    } finally {
      setSoftwareSaving(false);
    }
  }

  async function adjustLicenseSeats(item: SoftwareLicense, delta: number) {
    const nextSeats = Math.max(0, Math.min(item.seats_total, item.seats_used + delta));
    if (nextSeats === item.seats_used) return;
    setError("");
    try {
      await api.updateSoftwareLicense(item.id, {
        expected_version: item.record_version,
        seats_used: nextSeats
      });
      setSoftwareLicenses(await api.softwareLicenses(softwareSearch));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить количество мест");
    }
  }

  function exportSoftwareCsv() {
    const escapeCell = (val: unknown) => {
      let s = val == null ? "" : String(val);
      if (/^[=+\-@]/.test(s.replace(/^[ \t\r\n]+/, "")) || /^[\t\r\n]/.test(s)) {
        s = `'${s}`;
      }
      return `"${s.replace(/"/g, '""')}"`;
    };
    const headers = ["name", "publisher", "version", "license_type", "license_reference", "seats_used", "seats_total", "status", "purchased_at", "expires_at"];
    const rows = filteredSoftware.map(item =>
      [
        item.name,
        item.publisher,
        item.version,
        item.license_type,
        item.license_reference,
        item.seats_used,
        item.seats_total,
        item.status,
        item.purchased_at,
        item.expires_at
      ]
        .map(escapeCell)
        .join(",")
    );
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `software-licenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  async function removeSoftware(item: SoftwareLicense) {
    if (!confirm(`Удалить лицензию «${item.name}»?`)) return;
    setError("");
    try {
      await api.deleteSoftwareLicense(item.id);
      setSoftwareLicenses(await api.softwareLicenses(softwareSearch));
      setNotice("Лицензия удалена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить лицензию");
    }
  }

  async function openUsers() {
    setSection("users");
    setError("");
    try {
      setUsers(await api.users());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить пользователей");
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setUserSaving(true);
    setError("");
    try {
      await api.createUser(userForm);
      setUserForm({ email: "", full_name: "", password: "", role: "viewer" });
      setUsers(await api.users());
      setNotice("Пользователь успешно создан.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать пользователя");
    } finally {
      setUserSaving(false);
    }
  }

  async function changeUser(user: ManagedUser, changes: { role?: UserRole; is_active?: boolean }) {
    setError("");
    try {
      await api.updateUser(user.id, { ...changes, expected_version: user.version });
      setUsers(await api.users());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить пользователя");
    }
  }

  async function openAudit(filter = auditEntityFilter, searchTerm = auditSearch, limitVal = auditLimit) {
    setSection("audit");
    setError("");
    try {
      const [auditList, usersList] = await Promise.all([
        api.auditEvents(limitVal, filter, searchTerm),
        users.length === 0 ? api.users() : Promise.resolve(users)
      ]);
      setEvents(auditList);
      if (users.length === 0) setUsers(usersList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить журнал аудита");
    }
  }

  async function exportAuditCsv() {
    setError("");
    try {
      const blob = await api.exportAuditCsv(auditEntityFilter, auditSearch);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ecc-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось экспортировать журнал аудита");
    }
  }

  async function openBackups() {
    setSection("backups");
    setError("");
    try {
      const [, drills, snapshots] = await Promise.all([
        loadOverview(),
        api.recoveryDrills(),
        api.backupSnapshots()
      ]);
      setRecoveryDrills(drills);
      setBackupSnapshots(snapshots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить отчёты по восстановлению");
    }
  }

  async function createSnapshotNow() {
    setSnapshotCreating(true);
    setError("");
    try {
      const created = await api.createBackupSnapshot();
      setBackupSnapshots(await api.backupSnapshots());
      setNotice(`Создан локальный снимок ${created.filename} (SHA-256 проверен).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать снимок резервной копии");
    } finally {
      setSnapshotCreating(false);
    }
  }

  async function downloadSnapshotFile(snapshot: BackupSnapshot) {
    setError("");
    try {
      const blob = await api.downloadBackupSnapshot(snapshot.filename);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = snapshot.filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скачать локальный снимок");
    }
  }

  async function deleteSnapshotFile(snapshot: BackupSnapshot) {
    if (!confirm(`Удалить локальный снимок «${snapshot.filename}»?`)) return;
    setError("");
    try {
      await api.deleteBackupSnapshot(snapshot.filename);
      setBackupSnapshots(await api.backupSnapshots());
      setNotice(`Снимок ${snapshot.filename} удалён.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить снимок");
    }
  }

  function useSnapshotForDrill(snapshot: BackupSnapshot) {
    const now = Date.now();
    setDrillForm(prev => ({
      ...prev,
      backup_reference: snapshot.filename,
      incident_at: prev.incident_at || new Date(now - 9 * 60 * 1000).toISOString(),
      restore_started_at: prev.restore_started_at || new Date(now - 7 * 60 * 1000).toISOString(),
      restore_completed_at: prev.restore_completed_at || new Date(now - 1 * 60 * 1000).toISOString(),
      last_committed_at: prev.last_committed_at || snapshot.created_at,
      rto_target_seconds: prev.rto_target_seconds || "900",
      rpo_target_seconds: prev.rpo_target_seconds || "300"
    }));
    setNotice(`Ссылка на снимок ${snapshot.filename} подставлена в форму учений DR.`);
  }

  function fillRehearsalTimestamps() {
    const now = Date.now();
    const committed = new Date(now - 12 * 60 * 1000).toISOString();
    const incident = new Date(now - 9 * 60 * 1000).toISOString();
    const started = new Date(now - 7 * 60 * 1000).toISOString();
    const completed = new Date(now - 1 * 60 * 1000).toISOString();
    setDrillForm({
      backup_reference: `ecc-backup-${new Date(now).toISOString().slice(0, 10)}.json`,
      incident_at: incident,
      restore_started_at: started,
      restore_completed_at: completed,
      last_committed_at: committed,
      rto_target_seconds: "900",
      rpo_target_seconds: "300"
    });
  }

  async function submitRecoveryDrill(event: FormEvent) {
    event.preventDefault();
    setDrillSaving(true);
    setError("");
    try {
      await api.createRecoveryDrill({
        backup_reference: drillForm.backup_reference.trim(),
        incident_at: drillForm.incident_at.trim(),
        restore_started_at: drillForm.restore_started_at.trim() || null,
        restore_completed_at: drillForm.restore_completed_at.trim(),
        last_committed_at: drillForm.last_committed_at.trim() || null,
        rto_target_seconds: drillForm.rto_target_seconds.trim() ? Number(drillForm.rto_target_seconds.trim()) : null,
        rpo_target_seconds: drillForm.rpo_target_seconds.trim() ? Number(drillForm.rpo_target_seconds.trim()) : null
      });
      setRecoveryDrills(await api.recoveryDrills());
      setNotice("Отчёт об учениях по восстановлению (RTO/RPO) сохранён.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать отчёт об учениях");
    } finally {
      setDrillSaving(false);
    }
  }

  async function downloadDrillJson(drill: RecoveryDrillReport) {
    setError("");
    try {
      const blob = await api.downloadRecoveryDrill(drill.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ecc-recovery-drill-${drill.id}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скачать отчёт");
    }
  }

  async function openLicensing() {
    setSection("licensing");
    setError("");
    try {
      const licData = await api.license();
      setEditionSummary(licData);
      if (licData.features.includes("enterprise_sla_reporting")) {
        setSlaReport(await api.enterpriseSlaReport());
      } else {
        setSlaReport(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить сведения о редакции и лицензии");
    }
  }

  async function activateLicenseSubmit(event: FormEvent) {
    event.preventDefault();
    if (!licenseKeyInput.trim()) return;
    setLicenseSaving(true);
    setError("");
    try {
      const updated = await api.activateLicense(licenseKeyInput.trim());
      setEditionSummary(updated);
      setLicenseKeyInput("");
      if (updated.features.includes("enterprise_sla_reporting")) {
        setSlaReport(await api.enterpriseSlaReport());
      }
      setNotice(`Активирована редакция ${updated.edition_label}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось активировать лицензионный ключ");
    } finally {
      setLicenseSaving(false);
    }
  }

  async function deactivateLicenseAction() {
    if (!confirm("Деактивировать коммерческую лицензию и вернуться на Community Edition? Рабочие данные сохранятся.")) return;
    setLicenseSaving(true);
    setError("");
    try {
      const updated = await api.deactivateLicense();
      setEditionSummary(updated);
      setSlaReport(null);
      setNotice("Лицензия деактивирована. Активна редакция Community Edition.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось деактивировать лицензию");
    } finally {
      setLicenseSaving(false);
    }
  }

  async function downloadSlaCsv() {
    setError("");
    try {
      const blob = await api.downloadEnterpriseSlaCsv();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ecc-enterprise-sla-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выгрузить SLA-отчёт CSV");
    }
  }

  async function downloadSupportBundleFile() {
    setError("");
    try {
      const blob = await api.downloadSupportBundle();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ecc-support-bundle-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      setNotice("Обезличенный диагностический пакет поддержки выгружен.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сформировать пакет поддержки");
    }
  }

  async function openMonitoring() {
    setSection("monitoring");
    setError("");
    setTelemetryLoading(true);
    try {
      const [tel, health] = await Promise.all([api.telemetry(), api.health()]);
      setTelemetry(tel);
      setApiOnline(health.status === "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить телеметрию системы");
    } finally {
      setTelemetryLoading(false);
    }
  }

  function exportTelemetryLogsJson() {
    if (!telemetry) return;
    const payload = {
      exported_at: new Date().toISOString(),
      filter_status: logStatusFilter,
      filter_path: logPathSearch.trim() || null,
      count: filteredLogs.length,
      logs: filteredLogs
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ecc-http-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  async function downloadBackup() {
    setError("");
    try {
      const blob = await api.backup();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ecc-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      setNotice("Резервная копия успешно выгружена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выгрузить резервную копию");
    }
  }

  async function runBackupVerify(fileOverride?: File | null) {
    const target = fileOverride ?? backupFile;
    if (!target) return;
    setBackupVerifying(true);
    setBackupVerification(null);
    setError("");
    try {
      const result = await api.verifyBackup(target);
      setBackupVerification(result);
    } catch (e) {
      setBackupVerification(null);
      setError(e instanceof Error ? e.message : "Проверка целостности резервной копии не пройдена");
    } finally {
      setBackupVerifying(false);
    }
  }

  async function restoreBackupSubmit(event: FormEvent) {
    event.preventDefault();
    if (!backupFile) {
      setError("Выберите файл резервной копии");
      return;
    }
    if (!confirm("Внимание! Восстановление из копии заменит текущие данные организации. Продолжить?")) return;
    setBackupRestoring(true);
    setError("");
    try {
      const res = await api.restore(backupFile);
      setNotice(res.detail || "Данные успешно восстановлены.");
      setBackupFile(null);
      setBackupVerification(null);
      await loadOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка восстановления данных");
    } finally {
      setBackupRestoring(false);
    }
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function beginEdit(asset: Asset) {
    setEditingId(asset.id);
    setForm({
      name: asset.name,
      asset_tag: asset.asset_tag,
      category: asset.category,
      manufacturer: asset.manufacturer || "",
      model: asset.model || "",
      serial_number: asset.serial_number || "",
      assigned_to: asset.assigned_to || "",
      status: asset.status
    });
    document.getElementById("asset-form")?.scrollIntoView({ behavior: "smooth" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: AssetInput = {
        ...form,
        name: form.name.trim(),
        asset_tag: form.asset_tag.trim(),
        category: form.category.trim(),
        manufacturer: form.manufacturer?.trim() || null,
        model: form.model?.trim() || null,
        serial_number: form.serial_number?.trim() || null,
        assigned_to: form.assigned_to?.trim() || null
      };

      if (editingId === null) {
        await api.createAsset(payload);
        setNotice("Оборудование успешно зарегистрировано.");
      } else {
        const asset = assets.find(item => item.id === editingId);
        if (!asset) throw new Error("Запись не найдена");
        await api.updateAsset(editingId, { ...payload, expected_version: asset.version });
        setNotice("Данные оборудования обновлены.");
      }
      resetForm();
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить оборудование");
    } finally {
      setSaving(false);
    }
  }

  async function removeAsset(asset: Asset) {
    if (!confirm(`Удалить ${asset.name} (${asset.asset_tag}) из реестра?`)) return;
    setError("");
    try {
      await api.deleteAsset(asset.id);
      await loadAssets();
      setNotice("Оборудование удалено.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось удалить запись";
      if (msg.includes("maintenance requests") || msg.includes("заявками")) {
        setError("Оборудование связано с заявками на обслуживание и не может быть удалено. Сначала закройте или удалите связанные заявки в разделе «Обслуживание».");
      } else {
        setError(msg);
      }
    }
  }

  async function exportAssets() {
    setError("");
    try {
      const blob = await api.exportAssetsCsv();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "assets.csv";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось экспортировать CSV");
    }
  }

  async function importAssets() {
    if (!assetImportFile) return;
    setAssetImporting(true);
    setError("");
    try {
      const summary = await api.importAssetsCsv(assetImportFile);
      setAssetImportSummary(summary);
      setAssetImportFile(null);
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось импортировать CSV");
    } finally {
      setAssetImporting(false);
    }
  }

  async function applyBulkEdit() {
    if (selectedAssetIds.size === 0) return;
    setBulkSaving(true);
    setError("");
    try {
      const asset_ids = Array.from(selectedAssetIds);
      const versions: Record<number, number> = {};
      assets.forEach(asset => {
        if (selectedAssetIds.has(asset.id)) versions[asset.id] = asset.version;
      });
      const payload: { asset_ids: number[]; versions: Record<number, number>; status?: AssetStatus; assigned_to?: string | null } = {
        asset_ids,
        versions
      };
      if (bulkStatus) payload.status = bulkStatus;
      if (bulkClearAssignee) payload.assigned_to = null;
      else if (bulkAssignee.trim()) payload.assigned_to = bulkAssignee.trim();

      await api.bulkUpdateAssets(payload);
      setSelectedAssetIds(new Set());
      setBulkStatus("");
      setBulkAssignee("");
      setBulkClearAssignee(false);
      await loadAssets();
      setNotice("Массовое изменение успешно применено.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось применить массовое изменение");
    } finally {
      setBulkSaving(false);
    }
  }

  async function openAssetHistory(asset: Asset) {
    setHistoryAsset(asset);
    setHistoryLoading(true);
    try {
      setAssetHistory(await api.assetHistory(asset.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить историю актива");
    } finally {
      setHistoryLoading(false);
    }
  }

  const filteredAssets = useMemo(() => {
    if (assetStatusFilter === "all") return assets;
    return assets.filter(a => a.status === assetStatusFilter);
  }, [assets, assetStatusFilter]);

  const filteredMaintenance = useMemo(() => {
    return maintenanceRequests.filter(m => {
      const matchStatus = maintenanceStatusFilter === "all" || m.status === maintenanceStatusFilter;
      const matchPriority = maintenancePriorityFilter === "all" || m.priority === maintenancePriorityFilter;
      return matchStatus && matchPriority;
    });
  }, [maintenanceRequests, maintenanceStatusFilter, maintenancePriorityFilter]);

  const filteredSoftware = useMemo(() => {
    if (softwareStatusFilter === "all") return softwareLicenses;
    if (softwareStatusFilter === "expiring") {
      const sixtyDaysFromNow = Date.now() + 60 * 24 * 60 * 60 * 1000;
      return softwareLicenses.filter(
        s => s.status === "active" && Boolean(s.expires_at) && new Date(s.expires_at as string).getTime() < sixtyDaysFromNow
      );
    }
    return softwareLicenses.filter(s => s.status === softwareStatusFilter);
  }, [softwareLicenses, softwareStatusFilter]);

  const filteredLogs = useMemo(() => {
    if (!telemetry) return [];
    const q = logPathSearch.trim().toLowerCase();
    return telemetry.recent_logs.filter(log => {
      const matchStatus =
        logStatusFilter === "all" ||
        (logStatusFilter === "2xx" && log.status >= 200 && log.status < 300) ||
        (logStatusFilter === "4xx" && log.status >= 400 && log.status < 500) ||
        (logStatusFilter === "5xx" && log.status >= 500);
      const matchPath = !q || log.path.toLowerCase().includes(q) || log.method.toLowerCase().includes(q);
      return matchStatus && matchPath;
    });
  }, [telemetry, logStatusFilter, logPathSearch]);

  const counts = useMemo(() => {
    const total = assets.length;
    const active = assets.filter(item => item.status === "active").length;
    const repair = assets.filter(item => item.status === "in_repair").length;
    return { total, active, repair };
  }, [assets]);

  if (!token || !currentUser) {
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="brand login-brand">
            <div className="brand-mark">E</div>
            <div>
              <strong>ECC</strong>
              <span>CONTROL CENTER</span>
            </div>
          </div>
          <div className="eyebrow">ЗАЩИЩЁННЫЙ ДОСТУП</div>
          <h1>Вход в систему</h1>
          <p>Войдите под учётной записью вашей организации</p>
          {error && <div className="alert">{error}</div>}
          <label>
            Электронная почта
            <input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label>
            Пароль
            <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <button className="primary" type="submit" disabled={loginLoading}>
            {loginLoading ? "Вход..." : "Войти"}
          </button>
          <div style={{ marginTop: "16px", padding: "12px", background: "#f8fafd", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "11px" }}>
            <div style={{ fontWeight: 600, color: "#475569", marginBottom: "8px" }}>Быстрый вход под ролью:</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setEmail("admin@example.com"); setPassword("admin12345678"); }}
                style={{ padding: "5px 9px", fontSize: "11px", borderRadius: "4px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", color: "#1e293b" }}
              >
                Администратор
              </button>
              <button
                type="button"
                onClick={() => { setEmail("editor@example.com"); setPassword("editor12345678"); }}
                style={{ padding: "5px 9px", fontSize: "11px", borderRadius: "4px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", color: "#1e293b" }}
              >
                Инженер (Editor)
              </button>
              <button
                type="button"
                onClick={() => { setEmail("viewer@example.com"); setPassword("viewer12345678"); }}
                style={{ padding: "5px 9px", fontSize: "11px", borderRadius: "4px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", color: "#1e293b" }}
              >
                Аудитор (Viewer)
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <strong>ECC</strong>
            <span>CONTROL CENTER</span>
          </div>
        </div>
        <div className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <button type="button" className={`nav-item ${section === "overview" ? "active" : ""}`} onClick={() => void openOverview()}>
          <span>📊</span> Обзор
        </button>
        <button type="button" className={`nav-item ${section === "assets" ? "active" : ""}`} onClick={() => setSection("assets")}>
          <span>▦</span> Оборудование
        </button>
        <button type="button" className={`nav-item ${section === "software" ? "active" : ""}`} onClick={() => void openSoftware()}>
          <span>▤</span> Лицензии ПО
        </button>
        <button type="button" className={`nav-item ${section === "maintenance" ? "active" : ""}`} onClick={() => void openMaintenance()}>
          <span>⚙</span> Обслуживание
        </button>
        {currentUser.role !== "viewer" && (
          <button type="button" className={`nav-item ${section === "employees" ? "active" : ""}`} onClick={() => void openEmployees()}>
            <span>👥</span> Сотрудники
          </button>
        )}

        {currentUser.role === "admin" && (
          <>
            <div className="nav-caption" style={{ marginTop: "16px" }}>УПРАВЛЕНИЕ И БЕЗОПАСНОСТЬ</div>
            <button type="button" className={`nav-item ${section === "users" ? "active" : ""}`} onClick={() => void openUsers()}>
              <span>🛡</span> Пользователи
            </button>
            <button type="button" className={`nav-item ${section === "audit" ? "active" : ""}`} onClick={() => void openAudit()}>
              <span>≡</span> Журнал действий
            </button>
            <button type="button" className={`nav-item ${section === "backups" ? "active" : ""}`} onClick={() => void openBackups()}>
              <span>💾</span> Резервные копии
            </button>
            <button type="button" className={`nav-item ${section === "monitoring" ? "active" : ""}`} onClick={() => void openMonitoring()}>
              <span>📡</span> Мониторинг
            </button>
            <button type="button" className={`nav-item ${section === "licensing" ? "active" : ""}`} onClick={() => void openLicensing()}>
              <span>🔑</span> Редакция и лицензия
            </button>
          </>
        )}

        <div className="sidebar-bottom">
          <span className={apiOnline ? "dot online" : "dot"} /> API {apiOnline ? "подключён" : "не подключён"}
          <small>Версия 0.3.0 · {editionSummary?.edition_label ?? "Community Edition"}</small>
        </div>
      </aside>

      <main className="main">
        {/* Modal: Asset History */}
        {historyAsset && (
          <div className="modal-overlay" role="presentation" onClick={() => setHistoryAsset(null)}>
            <section className="modal-card history-modal" role="dialog" aria-modal="true" aria-labelledby="asset-history-title" onClick={e => e.stopPropagation()}>
              <div className="panel-heading">
                <div>
                  <h2 id="asset-history-title">История оборудования</h2>
                  <p>{historyAsset.name} · {historyAsset.asset_tag}</p>
                </div>
                <button type="button" className="subtle" onClick={() => setHistoryAsset(null)}>Закрыть</button>
              </div>
              {historyLoading ? (
                <div className="empty">Загрузка истории...</div>
              ) : assetHistory.length === 0 ? (
                <div className="empty">Записей пока нет.</div>
              ) : (
                <ol className="history-list">
                  {assetHistory.map(event => {
                    const changes = (event.details.changes || {}) as Record<string, { old: unknown; new: unknown }>;
                    const labels: Record<string, string> = {
                      name: "Название",
                      asset_tag: "Инвентарный номер",
                      category: "Категория",
                      manufacturer: "Производитель",
                      model: "Модель",
                      serial_number: "Серийный номер",
                      assigned_to: "Ответственный",
                      status: "Статус"
                    };
                    const actionLabels: Record<string, string> = {
                      "asset.created": "Создание актива",
                      "asset.imported": "Импорт актива",
                      "asset.updated": "Изменение актива",
                      "asset.deleted": "Удаление актива"
                    };
                    return (
                      <li key={event.id}>
                        <div className="history-event-head">
                          <strong>{actionLabels[event.action] || event.action}</strong>
                          <time>{new Date(event.created_at).toLocaleString()}</time>
                        </div>
                        <small>Пользователь ID: {event.actor_user_id ?? "учётная запись удалена"}</small>
                        {Object.entries(changes).map(([field, values]) => (
                          <div className="history-change" key={field}>
                            <span>{labels[field] || field}:</span> {String(values.old ?? "—")} → {String(values.new ?? "—")}
                          </div>
                        ))}
                        {!Object.keys(changes).length && (
                          <div className="history-change">{String(event.details.name || event.details.asset_tag || "")}</div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}

        {/* Modal: Printable Asset Label */}
        {labelAsset && (
          <div className="modal-overlay" role="presentation" onClick={() => setLabelAsset(null)}>
            <section className="modal-card" style={{ width: "min(100%, 420px)" }} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="panel-heading">
                <div>
                  <h2>Инвентарная наклейка</h2>
                  <p>Формат для термопринтера или листа этикеток</p>
                </div>
                <button type="button" className="subtle" onClick={() => setLabelAsset(null)}>Закрыть</button>
              </div>

              <div className="asset-label-preview">
                <div className="label-header">
                  <span className="label-org">{currentUser.organization_name}</span>
                  <span className="label-title">IT-ИНВЕНТАРЬ</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div className="label-tag">{labelAsset.asset_tag}</div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>{labelAsset.name}</div>
                  </div>
                  <div>{renderMiniQr()}</div>
                </div>
                <div className="label-grid">
                  <div>
                    <strong>Модель:</strong> {labelAsset.model || "—"}
                  </div>
                  <div>
                    <strong>Серийный номер:</strong> {labelAsset.serial_number || "—"}
                  </div>
                  <div>
                    <strong>Категория:</strong> {labelAsset.category}
                  </div>
                  <div>
                    <strong>Ответственный:</strong> {labelAsset.assigned_to || "Склад"}
                  </div>
                </div>
                <div className="label-barcode">
                  {renderAssetBarcode(labelAsset.asset_tag)}
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
                <button type="button" className="primary" style={{ flex: 1 }} onClick={() => window.print()}>
                  🖨 Печать этикетки
                </button>
                <button type="button" className="subtle" onClick={() => setLabelAsset(null)}>
                  Отмена
                </button>
              </div>
            </section>
          </div>
        )}

        {/* Modal: Employee Assigned Equipment */}
        {selectedEmployeeAssets && (
          <div className="modal-overlay" role="presentation" onClick={() => setSelectedEmployeeAssets(null)}>
            <section className="modal-card history-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="panel-heading">
                <div>
                  <h2>Закреплённое оборудование</h2>
                  <p>{selectedEmployeeAssets.full_name} · {selectedEmployeeAssets.employee_number}</p>
                </div>
                <button type="button" className="subtle" onClick={() => setSelectedEmployeeAssets(null)}>Закрыть</button>
              </div>
              {(() => {
                const assigned = assets.filter(a => a.assigned_to === selectedEmployeeAssets.full_name);
                if (assigned.length === 0) {
                  return <div className="empty">За данным сотрудником не числится оборудования.</div>;
                }
                return (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>НАЗВАНИЕ</th>
                          <th>ИНВ. НОМЕР</th>
                          <th>КАТЕГОРИЯ</th>
                          <th>СТАТУС</th>
                          <th>ДЕЙСТВИЯ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assigned.map(item => (
                          <tr key={item.id}>
                            <td><strong>{item.name}</strong><small>{item.model || "—"}</small></td>
                            <td className="mono">{item.asset_tag}</td>
                            <td>{item.category}</td>
                            <td><span className={`status status-${item.status}`}>{statusLabels[item.status]}</span></td>
                            <td className="actions">
                              <button onClick={() => { setSelectedEmployeeAssets(null); setLabelAsset(item); }}>Этикетка</button>
                              <button onClick={() => { setSelectedEmployeeAssets(null); setSection("assets"); beginEdit(item); }}>Открыть</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </section>
          </div>
        )}

        {/* Modal: Password Change */}
        {showPasswordForm && (
          <div className="modal-overlay">
            <form className="modal-card" onSubmit={submitPasswordChange}>
              <div className="panel-heading">
                <div>
                  <h2>Смена пароля</h2>
                  <p>Новый пароль должен содержать не менее 12 символов</p>
                </div>
                <button type="button" className="subtle" onClick={() => setShowPasswordForm(false)}>Закрыть</button>
              </div>
              <label>
                Текущий пароль
                <input type="password" required autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
              </label>
              <label>
                Новый пароль
                <input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              </label>
              <button className="primary" type="submit" disabled={passwordSaving}>
                {passwordSaving ? "Сохранение..." : "Изменить пароль"}
              </button>
            </form>
          </div>
        )}

        {notice && <div className="notice">{notice}</div>}

        <header className="topbar">
          <div className="crumb">
            Рабочее пространство <span>/</span> {
              section === "overview" ? "Обзор и аналитика" :
              section === "assets" ? "Оборудование" :
              section === "software" ? "Лицензии ПО" :
              section === "maintenance" ? "Обслуживание" :
              section === "employees" ? "Сотрудники" :
              section === "users" ? "Пользователи" :
              section === "audit" ? "Журнал действий" :
              section === "backups" ? "Резервные копии" : "Мониторинг и диагностика"
            }
          </div>
          <div className="top-user">
            <div>
              <strong>{currentUser.full_name}</strong>
              <small>{currentUser.organization_name} · {{ admin: "Администратор", editor: "Оператор", viewer: "Наблюдатель" }[currentUser.role]}</small>
            </div>
            <button className="subtle" onClick={() => { setError(""); setShowPasswordForm(true); }}>Сменить пароль</button>
            <button className="subtle" onClick={logout}>Выйти</button>
          </div>
        </header>

        {/* --- SECTION: OVERVIEW --- */}
        {section === "overview" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">СИТУАЦИОННЫЙ ЦЕНТР</div>
                <h1>Сводный обзор инфраструктуры</h1>
                <p>Ключевые метрики IT-активов, лицензий ПО и сервисных заявок</p>
              </div>
              <button className="subtle" onClick={() => void openOverview()}>
                {statsLoading ? "Обновление..." : "🔄 Обновить сводку"}
              </button>
            </div>

            {error && <div className="alert">{error}</div>}

            {stats && (
              <>
                <div className="overview-grid">
                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>IT-ОБОРУДОВАНИЕ</span>
                      <span style={{ color: "#10b981" }}>{stats.assets.active} акт.</span>
                    </div>
                    <div className="kpi-value">{stats.assets.total}</div>
                    <div className="kpi-sub">
                      {stats.assets.in_repair} в ремонте · {stats.assets.retired} списано
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>ЛИЦЕНЗИИ ПО</span>
                      <span>{stats.software.utilization_rate}%</span>
                    </div>
                    <div className="kpi-value">{stats.software.used_seats} <small style={{ fontSize: "14px", fontWeight: 400, color: "#64748b" }}>/ {stats.software.total_seats}</small></div>
                    <div className="meter-track">
                      <div
                        className={`meter-fill ${stats.software.utilization_rate > 90 ? "danger" : stats.software.utilization_rate > 75 ? "warning" : "success"}`}
                        style={{ width: `${Math.min(100, stats.software.utilization_rate)}%` }}
                      />
                    </div>
                    <div className="kpi-sub">
                      {stats.software.total_licenses} лицензий · {stats.software.expiring_soon > 0 ? <strong style={{ color: "#d97706" }}>{stats.software.expiring_soon} истекает скоро</strong> : "сроки в норме"}
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>СЕРВИСНЫЕ ЗАЯВКИ</span>
                      {stats.maintenance.urgent_or_high > 0 && <span style={{ color: "#ef4444", fontWeight: 700 }}>{stats.maintenance.urgent_or_high} срочн.</span>}
                    </div>
                    <div className="kpi-value">{stats.maintenance.open + stats.maintenance.in_progress}</div>
                    <div className="kpi-sub">
                      {stats.maintenance.open} открыто · {stats.maintenance.in_progress} в работе · {stats.maintenance.resolved} решено
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>СОТРУДНИКИ</span>
                      <span>{stats.departments.total} отделов</span>
                    </div>
                    <div className="kpi-value">{stats.employees.total}</div>
                    <div className="kpi-sub">
                      {stats.employees.with_assets} сотрудников с закреплённым оборудованием
                    </div>
                  </div>
                </div>

                {(stats.software.expiring_soon > 0 || stats.maintenance.urgent_or_high > 0 || stats.assets.in_repair > 0) && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Операционные предупреждения</h2>
                        <p>Позиции, требующие внимания IT-службы</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {stats.software.expiring_soon > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", paddingBottom: "8px", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "13px", color: "#334155" }}>
                            <strong style={{ color: "#d97706" }}>Истекающие лицензии ПО:</strong> {stats.software.expiring_soon} активных подписок заканчиваются в ближайшие 60 дней.
                          </span>
                          <button
                            type="button"
                            className="subtle"
                            onClick={() => {
                              setSoftwareStatusFilter("expiring");
                              void openSoftware(softwareSearch);
                            }}
                          >
                            Проверить лицензии →
                          </button>
                        </div>
                      )}
                      {stats.maintenance.urgent_or_high > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", paddingBottom: "8px", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "13px", color: "#334155" }}>
                            <strong style={{ color: "#dc2626" }}>Срочные и приоритетные заявки:</strong> {stats.maintenance.urgent_or_high} открытых или в работе обращений требуют реакции.
                          </span>
                          <button
                            type="button"
                            className="subtle"
                            onClick={() => {
                              setMaintenanceStatusFilter("all");
                              setMaintenancePriorityFilter("urgent");
                              void openMaintenance();
                            }}
                          >
                            Открыть заявки →
                          </button>
                        </div>
                      )}
                      {stats.assets.in_repair > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "13px", color: "#334155" }}>
                            <strong style={{ color: "#0f172a" }}>Оборудование в ремонте:</strong> {stats.assets.in_repair} ед. техники временно выведены из эксплуатации.
                          </span>
                          <button
                            type="button"
                            className="subtle"
                            onClick={() => {
                              setAssetStatusFilter("in_repair");
                              setSection("assets");
                            }}
                          >
                            К списку в ремонте →
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                <div className="section-split">
                  <div className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Структура оборудования по категориям</h2>
                        <p>Распределение аппаратных активов компании</p>
                      </div>
                      <button className="subtle" onClick={() => setSection("assets")}>Перейти к реестру →</button>
                    </div>

                    {Object.keys(stats.assets.by_category).length === 0 ? (
                      <div className="empty">Оборудование ещё не добавлено.</div>
                    ) : (
                      <div>
                        {Object.entries(stats.assets.by_category).map(([cat, count]) => {
                          const pct = stats.assets.total > 0 ? Math.round((count / stats.assets.total) * 100) : 0;
                          return (
                            <div className="bar-row" key={cat}>
                              <span className="bar-label">{cat}</span>
                              <div className="bar-track">
                                <div className="bar-fill" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="bar-count">{count}</span>
                              <span style={{ fontSize: "10px", color: "#64748b", width: "32px", textAlign: "right" }}>{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Быстрые действия</h2>
                        <p>Типовые операции IT-отдела</p>
                      </div>
                    </div>
                    <div className="quick-actions">
                      {currentUser.role !== "viewer" && (
                        <button type="button" className="action-btn" onClick={() => { setSection("assets"); resetForm(); document.getElementById("asset-form")?.scrollIntoView(); }}>
                          <span>＋</span> Зарегистрировать оборудование
                        </button>
                      )}
                      <button type="button" className="action-btn" onClick={() => void openMaintenance()}>
                        <span>⚙</span> Подать заявку на ремонт
                      </button>
                      {currentUser.role !== "viewer" && (
                        <button type="button" className="action-btn" onClick={() => void openEmployees()}>
                          <span>👥</span> Управление сотрудниками
                        </button>
                      )}
                      <button type="button" className="action-btn" onClick={() => void exportAssets()}>
                        <span>⬇</span> Выгрузить реестр в CSV
                      </button>
                      {currentUser.role === "admin" && (
                        <button type="button" className="action-btn" onClick={() => void downloadBackup()}>
                          <span>💾</span> Скачать резервную копию базы
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {currentUser.role === "admin" && (
                  <div className="panel inventory">
                    <div className="panel-heading">
                      <div>
                        <h2>События системы в реальном времени</h2>
                        <p>Последние операции пользователей в организации</p>
                      </div>
                      <button className="subtle" onClick={() => void openAudit()}>Полный журнал аудита →</button>
                    </div>
                    {events.length === 0 ? (
                      <div className="empty">Событий пока нет.</div>
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>ВРЕМЯ</th>
                              <th>ДЕЙСТВИЕ</th>
                              <th>ОБЪЕКТ</th>
                              <th>ДЕТАЛИ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {events.slice(0, 5).map(event => (
                              <tr key={event.id}>
                                <td>{new Date(event.created_at).toLocaleTimeString()}</td>
                                <td><strong>{event.action}</strong></td>
                                <td>{event.entity_type} #{event.entity_id}</td>
                                <td className="audit-details">{JSON.stringify(event.details)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* --- SECTION: ASSETS --- */}
        {section === "assets" && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">УПРАВЛЕНИЕ АКТИВАМИ</div>
                <h1>Оборудование</h1>
                <p>Единый реестр IT-активов организации</p>
              </div>
              {currentUser.role !== "viewer" && (
                <button className="primary" onClick={() => { resetForm(); document.getElementById("asset-form")?.scrollIntoView({ behavior: "smooth" }); }}>
                  ＋ Добавить актив
                </button>
              )}
            </section>

            <section className="stats">
              <div className="stat-card">
                <span>Всего в реестре</span>
                <strong>{counts.total}</strong>
                <small>Записей по текущему запросу</small>
              </div>
              <div className="stat-card">
                <span>В эксплуатации</span>
                <strong>{counts.active}</strong>
                <small>Активное оборудование</small>
              </div>
              <div className="stat-card">
                <span>В ремонте</span>
                <strong>{counts.repair}</strong>
                <small>Требует обслуживания</small>
              </div>
            </section>

            <section className="panel transfer-panel">
              <div className="panel-heading">
                <div>
                  <h2>Импорт и экспорт</h2>
                  <p>CSV, UTF-8 · до 5 000 строк за импорт · дубликаты пропускаются</p>
                </div>
                <button type="button" className="subtle" onClick={() => void exportAssets()}>Экспорт CSV</button>
              </div>
              {currentUser.role !== "viewer" && (
                <div className="transfer-actions">
                  <label>
                    Файл CSV
                    <input type="file" accept=".csv,text/csv" onChange={e => { setAssetImportFile(e.target.files?.[0] || null); setAssetImportSummary(null); }} />
                  </label>
                  <button type="button" className="primary" disabled={!assetImportFile || assetImporting} onClick={() => void importAssets()}>
                    {assetImporting ? "Импорт..." : "Импортировать"}
                  </button>
                </div>
              )}
              {assetImportSummary && (
                <div className="import-summary">
                  <strong>Создано: {assetImportSummary.created} · Пропущено: {assetImportSummary.skipped}</strong>
                  {assetImportSummary.errors.length > 0 && (
                    <ul>{assetImportSummary.errors.slice(0, 20).map((item, index) => <li key={index}>Строка {item.row}: {item.error}</li>)}</ul>
                  )}
                  {assetImportSummary.errors.length > 20 && <small>Показаны первые 20 ошибок из {assetImportSummary.errors.length}.</small>}
                </div>
              )}
            </section>

            {currentUser.role !== "viewer" && (
              <section className="panel" id="asset-form">
                <div className="panel-heading">
                  <div>
                    <h2>{editingId === null ? "Добавить оборудование" : "Редактировать оборудование"}</h2>
                    <p>Основные сведения об IT-активе</p>
                  </div>
                  {editingId !== null && <button className="subtle" onClick={resetForm}>Отмена</button>}
                </div>
                <form onSubmit={submit}>
                  <div className="form-grid">
                    <label>
                      Название *
                      <input required maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Например, Рабочая станция" />
                    </label>
                    <label>
                      Инвентарный номер *
                      <input required maxLength={80} value={form.asset_tag} onChange={e => setForm({ ...form, asset_tag: e.target.value })} placeholder="AST-00101" disabled={editingId !== null} />
                    </label>
                    <label>
                      Категория *
                      <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                        <option>Компьютер</option>
                        <option>Ноутбук</option>
                        <option>Сервер</option>
                        <option>Монитор</option>
                        <option>Принтер</option>
                        <option>Сетевое оборудование</option>
                        <option>Другое</option>
                      </select>
                    </label>
                    <label>
                      Статус
                      <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as AssetStatus })}>
                        <option value="active">В эксплуатации</option>
                        <option value="in_repair">В ремонте</option>
                        <option value="retired">Списано</option>
                      </select>
                    </label>
                    <label>
                      Производитель
                      <input maxLength={120} value={form.manufacturer || ""} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="Dell, Apple, Cisco..." />
                    </label>
                    <label>
                      Модель
                      <input maxLength={120} value={form.model || ""} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Модель устройства" />
                    </label>
                    <label>
                      Серийный номер
                      <input maxLength={120} value={form.serial_number || ""} onChange={e => setForm({ ...form, serial_number: e.target.value })} placeholder="SN-..." />
                    </label>
                    <label>
                      Ответственный сотрудник
                      <input
                        list="employees-list-datalist"
                        maxLength={160}
                        value={form.assigned_to || ""}
                        onChange={e => setForm({ ...form, assigned_to: e.target.value })}
                        placeholder="Выберите сотрудника или введите ФИО"
                      />
                      <datalist id="employees-list-datalist">
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.full_name}>{emp.job_title ? `${emp.full_name} (${emp.job_title})` : emp.full_name}</option>
                        ))}
                      </datalist>
                    </label>
                  </div>
                  <div className="form-actions">
                    <span className="required-note">* Обязательные поля</span>
                    <button className="primary" type="submit" disabled={saving}>
                      {saving ? "Сохранение..." : editingId === null ? "Сохранить актив" : "Сохранить изменения"}
                    </button>
                  </div>
                </form>
              </section>
            )}

            <section className="panel inventory">
              <div className="panel-heading">
                <div>
                  <h2>Реестр оборудования</h2>
                  <p>Список зарегистрированных активов</p>
                </div>
                <input className="search" value={search} onChange={e => { setSearch(e.target.value); void loadAssets(e.target.value); }} placeholder="⌕  Поиск по названию или номеру..." />
              </div>

              {/* Status Filter Tabs */}
              <div className="filter-bar">
                <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Фильтр по статусу:</span>
                <div className="filter-tabs">
                  <button type="button" className={`filter-tab ${assetStatusFilter === "all" ? "active" : ""}`} onClick={() => setAssetStatusFilter("all")}>Все ({assets.length})</button>
                  <button type="button" className={`filter-tab ${assetStatusFilter === "active" ? "active" : ""}`} onClick={() => setAssetStatusFilter("active")}>В эксплуатации ({counts.active})</button>
                  <button type="button" className={`filter-tab ${assetStatusFilter === "in_repair" ? "active" : ""}`} onClick={() => setAssetStatusFilter("in_repair")}>В ремонте ({counts.repair})</button>
                  <button type="button" className={`filter-tab ${assetStatusFilter === "retired" ? "active" : ""}`} onClick={() => setAssetStatusFilter("retired")}>Списано ({assets.length - counts.active - counts.repair})</button>
                </div>
              </div>

              {error && <div className="alert">{error}<button onClick={() => void loadAssets()}>Повторить</button></div>}

              {currentUser.role !== "viewer" && (
                <div className="bulk-edit-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Массовое редактирование</h3>
                      <p>Выбрано активов: {selectedAssetIds.size} · максимум 100 за операцию</p>
                    </div>
                    <button type="button" className="subtle" onClick={() => setSelectedAssetIds(new Set())} disabled={selectedAssetIds.size === 0}>Снять выделение</button>
                  </div>
                  <div className="bulk-edit-controls">
                    <label>
                      Новый статус
                      <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value as "" | AssetStatus)}>
                        <option value="">Не менять</option>
                        <option value="active">В эксплуатации</option>
                        <option value="in_repair">В ремонте</option>
                        <option value="retired">Списано</option>
                      </select>
                    </label>
                    <label>
                      Назначить ответственного
                      <input maxLength={160} value={bulkAssignee} disabled={bulkClearAssignee} onChange={e => setBulkAssignee(e.target.value)} placeholder="ФИО сотрудника" />
                    </label>
                    <label className="bulk-clear-option">
                      <input type="checkbox" checked={bulkClearAssignee} onChange={e => { setBulkClearAssignee(e.target.checked); if (e.target.checked) setBulkAssignee(""); }} />
                      Очистить ответственного
                    </label>
                    <button
                      type="button"
                      className="primary"
                      disabled={bulkSaving || selectedAssetIds.size === 0 || (!bulkStatus && !bulkAssignee.trim() && !bulkClearAssignee)}
                      onClick={() => void applyBulkEdit()}
                    >
                      {bulkSaving ? "Применение..." : "Применить к выбранным"}
                    </button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="empty">Загрузка данных...</div>
              ) : filteredAssets.length === 0 ? (
                <div className="empty">Активы не найдены по текущему фильтру.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {currentUser.role !== "viewer" && (
                          <th>
                            <input
                              aria-label="Выбрать все отображаемые активы"
                              type="checkbox"
                              checked={filteredAssets.length > 0 && filteredAssets.every(asset => selectedAssetIds.has(asset.id))}
                              onChange={e => {
                                const checked = e.target.checked;
                                setSelectedAssetIds(previous => {
                                  const next = new Set(previous);
                                  filteredAssets.forEach(asset => (checked ? next.add(asset.id) : next.delete(asset.id)));
                                  return next;
                                });
                              }}
                            />
                          </th>
                        )}
                        <th>ОБОРУДОВАНИЕ</th>
                        <th>ИНВ. НОМЕР</th>
                        <th>КАТЕГОРИЯ</th>
                        <th>ОТВЕТСТВЕННЫЙ</th>
                        <th>СТАТУС</th>
                        <th>ДЕЙСТВИЯ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssets.map(asset => (
                        <tr key={asset.id}>
                          {currentUser.role !== "viewer" && (
                            <td>
                              <input
                                aria-label={`Выбрать ${asset.asset_tag}`}
                                type="checkbox"
                                checked={selectedAssetIds.has(asset.id)}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  setSelectedAssetIds(previous => {
                                    const next = new Set(previous);
                                    if (checked) next.add(asset.id);
                                    else next.delete(asset.id);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                          )}
                          <td>
                            <strong>{asset.name}</strong>
                            <small>{[asset.manufacturer, asset.model].filter(Boolean).join(" ") || "Производитель не указан"}</small>
                          </td>
                          <td className="mono">{asset.asset_tag}</td>
                          <td>{asset.category}</td>
                          <td>{asset.assigned_to || "—"}</td>
                          <td>
                            <span className={`status status-${asset.status}`}>{statusLabels[asset.status]}</span>
                          </td>
                          <td className="actions">
                            <button title="Печать этикетки" onClick={() => setLabelAsset(asset)}>Этикетка</button>
                            <button title="История изменений" onClick={() => void openAssetHistory(asset)}>История</button>
                            {currentUser.role !== "viewer" && (
                              <>
                                <button title="Редактировать" onClick={() => beginEdit(asset)}>Изменить</button>
                                <button className="danger" title="Удалить" onClick={() => void removeAsset(asset)}>Удалить</button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <footer>Enterprise Control Center <span>·</span> Community Edition <span>·</span> Полнофункциональная сборка</footer>
          </>
        )}

        {/* --- SECTION: SOFTWARE LICENSES --- */}
        {section === "software" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">УЧЁТ ПРОГРАММНОГО ОБЕСПЕЧЕНИЯ</div>
                <h1>Лицензии ПО</h1>
                <p>Реестр договоров, типов лицензий и использования рабочих мест</p>
              </div>
            </div>

            {error && <div className="alert">{error}</div>}

            {currentUser.role !== "viewer" && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>{editingSoftwareId === null ? "Добавить лицензию" : "Редактировать лицензию"}</h2>
                    <p>Не вводите ключи активации. Храните только внешний номер договора или заказа.</p>
                  </div>
                  {editingSoftwareId !== null && (
                    <button className="subtle" onClick={() => { setEditingSoftwareId(null); setSoftwareForm(emptySoftwareForm); }}>Отмена</button>
                  )}
                </div>
                <form onSubmit={submitSoftware}>
                  <div className="form-grid user-form-grid">
                    <label>
                      Название ПО *
                      <input required maxLength={160} value={softwareForm.name} onChange={e => setSoftwareForm({ ...softwareForm, name: e.target.value })} />
                    </label>
                    <label>
                      Издатель
                      <input maxLength={120} value={softwareForm.publisher || ""} onChange={e => setSoftwareForm({ ...softwareForm, publisher: e.target.value })} />
                    </label>
                    <label>
                      Версия
                      <input maxLength={80} value={softwareForm.version || ""} onChange={e => setSoftwareForm({ ...softwareForm, version: e.target.value })} />
                    </label>
                    <label>
                      Тип лицензии
                      <select value={softwareForm.license_type} onChange={e => setSoftwareForm({ ...softwareForm, license_type: e.target.value as SoftwareLicenseType })}>
                        <option value="subscription">Подписка</option>
                        <option value="perpetual">Бессрочная</option>
                        <option value="oem">OEM</option>
                        <option value="site">Корпоративная</option>
                      </select>
                    </label>
                    <label>
                      Номер договора / заказа
                      <input maxLength={120} value={softwareForm.license_reference || ""} onChange={e => setSoftwareForm({ ...softwareForm, license_reference: e.target.value })} />
                    </label>
                    <label>
                      Всего мест *
                      <input type="number" min={1} max={1000000} required value={softwareForm.seats_total} onChange={e => setSoftwareForm({ ...softwareForm, seats_total: Number(e.target.value) })} />
                    </label>
                    <label>
                      Используется мест
                      <input type="number" min={0} max={1000000} required value={softwareForm.seats_used} onChange={e => setSoftwareForm({ ...softwareForm, seats_used: Number(e.target.value) })} />
                    </label>
                    <label>
                      Статус
                      <select value={softwareForm.status} onChange={e => setSoftwareForm({ ...softwareForm, status: e.target.value as SoftwareLicenseStatus })}>
                        <option value="active">Активна</option>
                        <option value="suspended">Приостановлена</option>
                        <option value="retired">Закрыта</option>
                      </select>
                    </label>
                    <label>
                      Дата покупки
                      <input type="date" value={softwareForm.purchased_at || ""} onChange={e => setSoftwareForm({ ...softwareForm, purchased_at: e.target.value || null })} />
                    </label>
                    <label>
                      Дата окончания
                      <input type="date" value={softwareForm.expires_at || ""} onChange={e => setSoftwareForm({ ...softwareForm, expires_at: e.target.value || null })} />
                    </label>
                    <label className="wide-field">
                      Примечания
                      <input maxLength={4000} value={softwareForm.notes || ""} onChange={e => setSoftwareForm({ ...softwareForm, notes: e.target.value })} />
                    </label>
                  </div>
                  <div className="form-actions">
                    <span className="required-note">Используемые места не могут превышать общее количество</span>
                    <button className="primary" type="submit" disabled={softwareSaving}>
                      {softwareSaving ? "Сохранение..." : editingSoftwareId === null ? "Сохранить лицензию" : "Сохранить изменения"}
                    </button>
                  </div>
                </form>
              </section>
            )}

            <section className="panel inventory">
              <div className="panel-heading">
                <div>
                  <h2>Реестр лицензий</h2>
                  <p>{filteredSoftware.length} записей</p>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    className="search"
                    value={softwareSearch}
                    onChange={e => {
                      const term = e.target.value;
                      setSoftwareSearch(term);
                      void openSoftware(term);
                    }}
                    placeholder="⌕  Поиск по названию, издателю, договору..."
                  />
                  <select value={softwareStatusFilter} onChange={e => setSoftwareStatusFilter(e.target.value)} style={{ fontSize: "11px", padding: "6px" }}>
                    <option value="all">Все статусы</option>
                    <option value="active">Только активные</option>
                    <option value="expiring">Истекают (&lt; 60 дн.)</option>
                    <option value="suspended">Приостановленные</option>
                    <option value="retired">Закрытые</option>
                  </select>
                  <button type="button" className="subtle" onClick={exportSoftwareCsv}>Экспорт CSV</button>
                  <button type="button" className="subtle" onClick={() => void openSoftware(softwareSearch)}>Обновить</button>
                </div>
              </div>

              {filteredSoftware.length === 0 ? (
                <div className="empty">Лицензии не найдены.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ПРОГРАММА</th>
                        <th>ТИП</th>
                        <th>ДОГОВОР</th>
                        <th>МЕСТА (УТИЛИЗАЦИЯ)</th>
                        <th>ОКОНЧАНИЕ</th>
                        <th>СТАТУС</th>
                        {currentUser.role !== "viewer" && <th>ДЕЙСТВИЯ</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSoftware.map(item => {
                        const pct = Math.round((item.seats_used / item.seats_total) * 100);
                        const isExpiringSoon = item.expires_at && new Date(item.expires_at).getTime() - Date.now() < 60 * 24 * 60 * 60 * 1000;
                        return (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.name}</strong>
                              <small>{[item.publisher, item.version].filter(Boolean).join(" · ")}</small>
                            </td>
                            <td>{licenseTypeLabels[item.license_type]}</td>
                            <td className="mono">{item.license_reference || "—"}</td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                {currentUser.role !== "viewer" && (
                                  <button
                                    type="button"
                                    className="subtle"
                                    style={{ padding: "2px 6px", fontSize: "10px" }}
                                    disabled={item.seats_used <= 0}
                                    onClick={() => void adjustLicenseSeats(item, -1)}
                                    title="Освободить 1 место"
                                  >
                                    −
                                  </button>
                                )}
                                <span className="mono">{item.seats_used} / {item.seats_total}</span>
                                {currentUser.role !== "viewer" && (
                                  <button
                                    type="button"
                                    className="subtle"
                                    style={{ padding: "2px 6px", fontSize: "10px" }}
                                    disabled={item.seats_used >= item.seats_total}
                                    onClick={() => void adjustLicenseSeats(item, 1)}
                                    title="Занять 1 место"
                                  >
                                    +
                                  </button>
                                )}
                                <div style={{ width: "60px", height: "5px", background: "#f1f5f9", borderRadius: "3px", overflow: "hidden" }}>
                                  <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: pct > 90 ? "#ef4444" : "#3b82f6" }} />
                                </div>
                              </div>
                            </td>
                            <td>
                              {item.expires_at || "Бессрочно"}
                              {isExpiringSoon && <small style={{ color: "#d97706", display: "block" }}>скоро истекает</small>}
                            </td>
                            <td>
                              <span className={`status ${item.status === "active" ? "status-active" : item.status === "suspended" ? "status-in_repair" : "status-retired"}`}>
                                {licenseStatusLabels[item.status]}
                              </span>
                            </td>
                            {currentUser.role !== "viewer" && (
                              <td className="actions">
                                <button onClick={() => beginSoftwareEdit(item)}>Изменить</button>
                                <button className="danger" onClick={() => void removeSoftware(item)}>Удалить</button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}

        {/* --- SECTION: MAINTENANCE --- */}
        {section === "maintenance" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">ЗАЯВКИ НА РЕМОНТ И ОБСЛУЖИВАНИЕ</div>
                <h1>Обслуживание</h1>
                <p>Регистрация неисправностей и контроль выполнения регламентных работ</p>
              </div>
            </div>

            {error && <div className="alert">{error}</div>}

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Создать заявку</h2>
                  <p>Выберите оборудование и подробно опишите проблему</p>
                </div>
              </div>
              {assets.length === 0 ? (
                <div className="empty">Сначала добавьте оборудование в реестр.</div>
              ) : (
                <form onSubmit={submitMaintenance}>
                  <div className="form-grid user-form-grid">
                    <label>
                      Оборудование *
                      <select required value={maintenanceForm.asset_id} onChange={e => setMaintenanceForm({ ...maintenanceForm, asset_id: Number(e.target.value) })}>
                        <option value={0} disabled>Выберите актив</option>
                        {assets.map(asset => (
                          <option key={asset.id} value={asset.id}>{asset.asset_tag} · {asset.name} ({asset.assigned_to || "Склад"})</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Тема заявки *
                      <input required maxLength={160} value={maintenanceForm.title} onChange={e => setMaintenanceForm({ ...maintenanceForm, title: e.target.value })} placeholder="Краткое описание проблемы" />
                    </label>
                    <label>
                      Приоритет
                      <select value={maintenanceForm.priority} onChange={e => setMaintenanceForm({ ...maintenanceForm, priority: e.target.value as MaintenancePriority })}>
                        <option value="low">Низкий</option>
                        <option value="normal">Обычный</option>
                        <option value="high">Высокий</option>
                        <option value="urgent">Срочный</option>
                      </select>
                    </label>
                    <label className="wide-field">
                      Описание проблемы
                      <textarea required maxLength={4000} rows={3} value={maintenanceForm.description} onChange={e => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })} placeholder="Подробное описание обстоятельств сбоя, симптомов..." />
                    </label>
                  </div>
                  <div className="form-actions">
                    <span className="required-note">Заявка будет зарегистрирована и отправлена ответственным инженерам</span>
                    <button className="primary" type="submit" disabled={maintenanceSaving}>
                      {maintenanceSaving ? "Отправка..." : "Отправить заявку"}
                    </button>
                  </div>
                </form>
              )}
            </section>

            <section className="panel inventory">
              <div className="panel-heading">
                <div>
                  <h2>Заявки</h2>
                  <p>{filteredMaintenance.length} записей</p>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <select value={maintenanceStatusFilter} onChange={e => setMaintenanceStatusFilter(e.target.value)} style={{ fontSize: "11px", padding: "6px" }}>
                    <option value="all">Все статусы</option>
                    <option value="open">Открытые</option>
                    <option value="in_progress">В работе</option>
                    <option value="resolved">Решённые</option>
                    <option value="cancelled">Отменённые</option>
                  </select>
                  <select value={maintenancePriorityFilter} onChange={e => setMaintenancePriorityFilter(e.target.value)} style={{ fontSize: "11px", padding: "6px" }}>
                    <option value="all">Все приоритеты</option>
                    <option value="urgent">Срочный</option>
                    <option value="high">Высокий</option>
                    <option value="normal">Обычный</option>
                    <option value="low">Низкий</option>
                  </select>
                  <button className="subtle" onClick={() => void openMaintenance()}>Обновить</button>
                </div>
              </div>

              {filteredMaintenance.length === 0 ? (
                <div className="empty">Заявок по текущему фильтру нет.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ЗАЯВКА</th>
                        <th>АКТИВ</th>
                        <th>ПРИОРИТЕТ</th>
                        <th>ИСПОЛНИТЕЛЬ</th>
                        <th>СТАТУС</th>
                        <th>ДАТА</th>
                        <th>ДЕЙСТВИЯ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMaintenance.map(item => {
                        const targetAsset = assets.find(a => a.id === item.asset_id);
                        const assignedUser = assignees.find(u => u.id === item.assigned_to_user_id);
                        return (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.title}</strong>
                              <small>{item.description}</small>
                            </td>
                            <td>
                              {targetAsset ? <span><strong>{targetAsset.asset_tag}</strong><small>{targetAsset.name}</small></span> : `#${item.asset_id}`}
                            </td>
                            <td>
                              {currentUser.role === "viewer" ? (
                                <span style={{ fontWeight: 600, color: item.priority === "urgent" ? "#dc2626" : item.priority === "high" ? "#ea580c" : "#475569" }}>
                                  {maintenancePriorityLabels[item.priority]}
                                </span>
                              ) : (
                                <select
                                  value={item.priority}
                                  onChange={e => void changeMaintenancePriority(item, e.target.value as MaintenancePriority)}
                                  style={{ fontWeight: 600, color: item.priority === "urgent" ? "#dc2626" : item.priority === "high" ? "#ea580c" : "#475569" }}
                                >
                                  <option value="low">Низкий</option>
                                  <option value="normal">Обычный</option>
                                  <option value="high">Высокий</option>
                                  <option value="urgent">Срочно</option>
                                </select>
                              )}
                            </td>
                            <td>
                              {currentUser.role === "viewer" ? (
                                <span>{assignedUser ? assignedUser.full_name : item.assigned_to_user_id ? `Инженер #${item.assigned_to_user_id}` : "Не назначен"}</span>
                              ) : (
                                <select
                                  value={item.assigned_to_user_id ?? ""}
                                  onChange={e => void changeMaintenanceAssignee(item, e.target.value ? Number(e.target.value) : null)}
                                >
                                  <option value="">Не назначен</option>
                                  {assignees.map(u => (
                                    <option key={u.id} value={u.id}>{u.full_name}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td>
                              {currentUser.role === "viewer" ? (
                                <span className={`status ${item.status === "resolved" ? "status-active" : item.status === "in_progress" ? "status-in_repair" : "status-retired"}`}>
                                  {maintenanceStatusLabels[item.status]}
                                </span>
                              ) : (
                                <select value={item.status} onChange={e => void changeMaintenanceStatus(item, e.target.value as MaintenanceStatus)}>
                                  <option value="open">Открыта</option>
                                  <option value="in_progress">В работе</option>
                                  <option value="resolved">Решена</option>
                                  <option value="cancelled">Отменена</option>
                                </select>
                              )}
                            </td>
                            <td>
                              {new Date(item.created_at).toLocaleDateString()}
                              {item.resolved_at && <small>Решена: {new Date(item.resolved_at).toLocaleDateString()}</small>}
                            </td>
                            <td className="actions">
                              {targetAsset && (
                                <button onClick={() => setLabelAsset(targetAsset)}>Этикетка</button>
                              )}
                              {(currentUser.role === "admin" || item.requested_by_user_id === currentUser.id) && (
                                <button className="danger" onClick={() => void removeMaintenanceRequest(item)}>Удалить</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}

        {/* --- SECTION: EMPLOYEES --- */}
        {section === "employees" && currentUser.role !== "viewer" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">СТРУКТУРА ОРГАНИЗАЦИИ</div>
                <h1>Сотрудники и подразделения</h1>
                <p>Справочник персонала и прикрепление оборудования</p>
              </div>
            </div>

            {error && <div className="alert">{error}</div>}

            {currentUser.role === "admin" && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>{editingDepartmentId === null ? "Добавить подразделение" : "Редактировать подразделение"}</h2>
                    <p>Короткий код используется в идентификаторах и отчётах</p>
                  </div>
                  {editingDepartmentId !== null && (
                    <button type="button" className="subtle" onClick={resetDepartmentForm}>Отмена</button>
                  )}
                </div>
                <form className="department-form" onSubmit={submitDepartment}>
                  <label>
                    Название
                    <input required maxLength={120} value={departmentForm.name} onChange={e => setDepartmentForm({ ...departmentForm, name: e.target.value })} placeholder="Например, Департамент аналитики" />
                  </label>
                  <label>
                    Код
                    <input required maxLength={40} value={departmentForm.code} onChange={e => setDepartmentForm({ ...departmentForm, code: e.target.value })} placeholder="DATA" />
                  </label>
                  <button className="primary" type="submit" disabled={departmentSaving}>
                    {departmentSaving ? "Сохранение..." : editingDepartmentId === null ? "Добавить" : "Сохранить"}
                  </button>
                </form>

                {departments.length > 0 && (
                  <div className="table-wrap" style={{ marginTop: "16px" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>ПОДРАЗДЕЛЕНИЕ</th>
                          <th>КОД</th>
                          <th>СОТРУДНИКОВ</th>
                          <th>ДЕЙСТВИЯ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {departments.map(dept => {
                          const memberCount = employees.filter(e => e.department_id === dept.id).length;
                          return (
                            <tr key={dept.id}>
                              <td><strong>{dept.name}</strong></td>
                              <td className="mono">{dept.code}</td>
                              <td className="mono">{memberCount}</td>
                              <td className="actions">
                                <button type="button" onClick={() => beginDepartmentEdit(dept)}>Изменить</button>
                                <button type="button" className="danger" onClick={() => void removeDepartment(dept)}>Удалить</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>{editingEmployeeId === null ? "Добавить сотрудника" : "Редактировать сотрудника"}</h2>
                  <p>Контактные и организационные данные</p>
                </div>
                {editingEmployeeId !== null && (
                  <button className="subtle" onClick={() => { setEditingEmployeeId(null); setEmployeeForm(emptyEmployeeForm); }}>Отмена</button>
                )}
              </div>
              <form onSubmit={submitEmployee}>
                <div className="form-grid user-form-grid">
                  <label>
                    Табельный номер *
                    <input required maxLength={40} value={employeeForm.employee_number} onChange={e => setEmployeeForm({ ...employeeForm, employee_number: e.target.value })} placeholder="EMP-012" />
                  </label>
                  <label>
                    ФИО *
                    <input required maxLength={160} value={employeeForm.full_name} onChange={e => setEmployeeForm({ ...employeeForm, full_name: e.target.value })} placeholder="Фамилия Имя Отчество" />
                  </label>
                  <label>
                    Подразделение
                    <select value={employeeForm.department_id || 0} onChange={e => setEmployeeForm({ ...employeeForm, department_id: Number(e.target.value) || null })}>
                      <option value={0}>Не указано</option>
                      {departments.map(dept => (
                        <option key={dept.id} value={dept.id}>{dept.name} ({dept.code})</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Должность
                    <input maxLength={120} value={employeeForm.job_title || ""} onChange={e => setEmployeeForm({ ...employeeForm, job_title: e.target.value })} placeholder="Системный администратор" />
                  </label>
                  <label>
                    Электронная почта
                    <input type="email" value={employeeForm.email || ""} onChange={e => setEmployeeForm({ ...employeeForm, email: e.target.value })} placeholder="user@company.com" />
                  </label>
                  <label>
                    Телефон
                    <input maxLength={40} value={employeeForm.phone || ""} onChange={e => setEmployeeForm({ ...employeeForm, phone: e.target.value })} placeholder="+7..." />
                  </label>
                </div>
                <div className="form-actions">
                  <span className="required-note">Данные доступны администраторам и операторам организации</span>
                  <button className="primary" type="submit" disabled={employeeSaving}>
                    {employeeSaving ? "Сохранение..." : editingEmployeeId === null ? "Добавить сотрудника" : "Сохранить изменения"}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel inventory">
              <div className="panel-heading">
                <div>
                  <h2>Справочник сотрудников</h2>
                  <p>{employees.length} сотрудников · {departments.length} подразделений</p>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="search"
                    value={employeeSearch}
                    onChange={e => {
                      const term = e.target.value;
                      setEmployeeSearch(term);
                      void openEmployees(term);
                    }}
                    placeholder="⌕  Поиск сотрудника..."
                  />
                  <button type="button" className="subtle" onClick={() => void openEmployees(employeeSearch)}>Обновить</button>
                </div>
              </div>

              {employees.length === 0 ? (
                <div className="empty">Сотрудников пока нет.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>СОТРУДНИК</th>
                        <th>ТАБЕЛЬНЫЙ №</th>
                        <th>ПОДРАЗДЕЛЕНИЕ</th>
                        <th>ДОЛЖНОСТЬ</th>
                        <th>КОНТАКТЫ</th>
                        <th>СТАТУС</th>
                        <th>ДЕЙСТВИЯ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map(employee => {
                        const assignedCount = assets.filter(a => a.assigned_to === employee.full_name).length;
                        return (
                          <tr key={employee.id}>
                            <td>
                              <strong>{employee.full_name}</strong>
                              {assignedCount > 0 && <small style={{ color: "#2563eb" }}>Закреплено активов: {assignedCount}</small>}
                            </td>
                            <td className="mono">{employee.employee_number}</td>
                            <td>{departments.find(d => d.id === employee.department_id)?.name || "—"}</td>
                            <td>{employee.job_title || "—"}</td>
                            <td>{employee.email || employee.phone || "—"}</td>
                            <td>
                              <span className={`status ${employee.is_active ? "status-active" : "status-retired"}`}>
                                {employee.is_active ? "Работает" : "Неактивен"}
                              </span>
                            </td>
                            <td className="actions">
                              <button onClick={() => setSelectedEmployeeAssets(employee)}>
                                Оборудование ({assignedCount})
                              </button>
                              <button onClick={() => beginEmployeeEdit(employee)}>Изменить</button>
                              <button className="danger" onClick={() => void toggleEmployee(employee)}>
                                {employee.is_active ? "Отключить" : "Включить"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}

        {/* --- SECTION: USERS & RBAC --- */}
        {section === "users" && currentUser.role === "admin" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">АДМИНИСТРИРОВАНИЕ</div>
                <h1>Пользователи системы</h1>
                <p>Управление доступом сотрудников к платформе Enterprise Control Center</p>
              </div>
            </div>

            {error && <div className="alert">{error}</div>}

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Создать учётную запись</h2>
                  <p>Пароль должен содержать не менее 12 символов</p>
                </div>
              </div>
              <form onSubmit={createUser}>
                <div className="form-grid user-form-grid">
                  <label>
                    Электронная почта
                    <input type="email" required value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} />
                  </label>
                  <label>
                    Имя сотрудника
                    <input required maxLength={160} value={userForm.full_name} onChange={e => setUserForm({ ...userForm, full_name: e.target.value })} />
                  </label>
                  <label>
                    Временный пароль
                    <input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} />
                  </label>
                  <label>
                    Роль
                    <select value={userForm.role} onChange={e => setUserForm({ ...userForm, role: e.target.value as UserRole })}>
                      <option value="viewer">Наблюдатель (Viewer)</option>
                      <option value="editor">Оператор (Editor)</option>
                      <option value="admin">Администратор (Admin)</option>
                    </select>
                  </label>
                </div>
                <div className="form-actions">
                  <span className="required-note">Доступ будет ограничен текущей организацией</span>
                  <button className="primary" type="submit" disabled={userSaving}>
                    {userSaving ? "Создание..." : "Создать пользователя"}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel inventory">
              <div className="panel-heading">
                <div>
                  <h2>Учётные записи организации</h2>
                  <p>{users.length} пользователей</p>
                </div>
                <button className="subtle" onClick={() => void openUsers()}>Обновить</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ПОЛЬЗОВАТЕЛЬ</th>
                      <th>РОЛЬ</th>
                      <th>СТАТУС</th>
                      <th>ДЕЙСТВИЯ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.full_name}</strong>
                          <small>{u.email}</small>
                        </td>
                        <td>
                          <select value={u.role} disabled={u.id === currentUser.id} onChange={e => void changeUser(u, { role: e.target.value as UserRole })}>
                            <option value="viewer">Наблюдатель</option>
                            <option value="editor">Оператор</option>
                            <option value="admin">Администратор</option>
                          </select>
                        </td>
                        <td>
                          <span className={`status ${u.is_active ? "status-active" : "status-retired"}`}>
                            {u.is_active ? "Активен" : "Отключён"}
                          </span>
                        </td>
                        <td>
                          {u.id === currentUser.id ? (
                            <span style={{ fontSize: "11px", color: "#64748b" }}>Текущая учётная запись</span>
                          ) : (
                            <button className="subtle" onClick={() => void changeUser(u, { is_active: !u.is_active })}>
                              {u.is_active ? "Отключить" : "Включить"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        )}

        {/* --- SECTION: AUDIT LOG --- */}
        {section === "audit" && currentUser.role === "admin" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">КОНТРОЛЬ И БЕЗОПАСНОСТЬ</div>
                <h1>Журнал действий</h1>
                <p>Аудит событий и изменений в текущей организации</p>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  className="search"
                  value={auditSearch}
                  onChange={e => {
                    const term = e.target.value;
                    setAuditSearch(term);
                    void openAudit(auditEntityFilter, term, auditLimit);
                  }}
                  placeholder="⌕  Поиск по действию, объекту, деталям..."
                />
                <select
                  value={auditEntityFilter}
                  onChange={e => {
                    const nextEntity = e.target.value;
                    setAuditEntityFilter(nextEntity);
                    void openAudit(nextEntity, auditSearch, auditLimit);
                  }}
                  style={{ fontSize: "11px", padding: "6px" }}
                >
                  <option value="">Все объекты</option>
                  <option value="asset">Оборудование (asset)</option>
                  <option value="software_license">Лицензии ПО</option>
                  <option value="maintenance_request">Обслуживание</option>
                  <option value="employee">Сотрудники</option>
                  <option value="department">Подразделения</option>
                  <option value="user">Пользователи</option>
                  <option value="system">Система</option>
                </select>
                <select
                  value={auditLimit}
                  onChange={e => {
                    const nextLimit = Number(e.target.value);
                    setAuditLimit(nextLimit);
                    void openAudit(auditEntityFilter, auditSearch, nextLimit);
                  }}
                  style={{ fontSize: "11px", padding: "6px" }}
                  aria-label="Лимит записей аудита"
                >
                  <option value={50}>50 записей</option>
                  <option value={100}>100 записей</option>
                  <option value={200}>200 записей</option>
                </select>
                <button type="button" className="subtle" onClick={() => void exportAuditCsv()}>Экспорт CSV</button>
                <button type="button" className="subtle" onClick={() => void openAudit(auditEntityFilter, auditSearch, auditLimit)}>Обновить</button>
              </div>
            </div>

            {error && <div className="alert">{error}</div>}

            <section className="panel inventory">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ВРЕМЯ</th>
                      <th>ИНИЦИАТОР</th>
                      <th>ДЕЙСТВИЕ</th>
                      <th>ОБЪЕКТ</th>
                      <th>ДЕТАЛИ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(event => {
                      const actor = event.actor_user_id ? users.find(u => u.id === event.actor_user_id) : undefined;
                      return (
                        <tr key={event.id}>
                          <td>{new Date(event.created_at).toLocaleString()}</td>
                          <td>
                            {actor ? (
                              <span>
                                <strong>{actor.full_name}</strong>
                                <small className="mono">#{actor.id}</small>
                              </span>
                            ) : (
                              <span className="mono">{event.actor_user_id ? `#${event.actor_user_id}` : "—"}</span>
                            )}
                          </td>
                          <td><strong>{event.action}</strong></td>
                          <td>{event.entity_type} #{event.entity_id}</td>
                          <td className="audit-details">{JSON.stringify(event.details)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {events.length === 0 && <div className="empty">Событий пока нет.</div>}
            </section>
          </section>
        )}

        {/* --- SECTION: BACKUPS & SYSTEM (ROADMAP PHASE 2) --- */}
        {section === "backups" && currentUser.role === "admin" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">РЕЗЕРВНОЕ КОПИРОВАНИЕ И ВОССТАНОВЛЕНИЕ</div>
                <h1>Резервные копии базы данных</h1>
                <p>Экспорт и аварийное восстановление состояния организации (Roadmap Phase 2)</p>
              </div>
            </div>

            {error && <div className="alert">{error}</div>}

            <div className="section-split">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Выгрузка резервной копии</h2>
                    <p>Создание полного JSON-дампа данных организации</p>
                  </div>
                </div>
                <p style={{ fontSize: "12px", color: "#475569", lineHeight: "1.6" }}>
                  Резервная копия содержит полный снимок базы данных: оборудование, историю активов,
                  лицензии ПО, заявки на обслуживание, сотрудников, подразделения и журнал аудита.
                </p>
                <button type="button" className="primary" style={{ marginTop: "12px" }} onClick={() => void downloadBackup()}>
                  ⬇ Скачать полную резервную копию (.json)
                </button>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Восстановление из копии</h2>
                    <p>Загрузка и накат состояния из файла</p>
                  </div>
                </div>
                <form onSubmit={restoreBackupSubmit}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "8px" }}>
                    Выберите файл .json резервной копии:
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={e => {
                        const file = e.target.files?.[0] || null;
                        setBackupFile(file);
                        setBackupVerification(null);
                        if (file) {
                          void runBackupVerify(file);
                        }
                      }}
                      style={{ display: "block", marginTop: "8px" }}
                    />
                  </label>
                  {backupVerifying && (
                    <p style={{ fontSize: "12px", color: "#64748b", margin: "8px 0" }}>
                      Проверка структуры и контрольной суммы SHA-256...
                    </p>
                  )}
                  {backupVerification && (
                    <div style={{ margin: "10px 0", padding: "10px 12px", border: "1px solid #cbd5e1", background: "#f8fafc", fontSize: "12px", lineHeight: 1.6 }}>
                      <div>
                        <strong style={{ color: backupVerification.checksum_status === "verified" ? "#15803d" : "#d97706" }}>
                          {backupVerification.checksum_status === "verified"
                            ? "SHA-256 контрольная сумма подтверждена"
                            : "Файл без подписи SHA-256 (совместимость)"}
                        </strong>
                        {" · "}Схема v{backupVerification.schema_version}
                      </div>
                      <div className="mono" style={{ fontSize: "11px", color: "#475569", wordBreak: "break-all" }}>
                        SHA-256: {backupVerification.sha256_digest}
                      </div>
                      <div style={{ color: "#334155", marginTop: "4px" }}>
                        Активов: <strong>{backupVerification.counts.assets}</strong> · Лицензий: <strong>{backupVerification.counts.software_licenses}</strong> · Заявок: <strong>{backupVerification.counts.maintenance_requests}</strong> · Сотрудников: <strong>{backupVerification.counts.employees}</strong> · Аудит: <strong>{backupVerification.counts.audit_events}</strong>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="subtle"
                      disabled={!backupFile || backupVerifying}
                      onClick={() => void runBackupVerify()}
                    >
                      Проверить (Dry-Run)
                    </button>
                    <button type="submit" className="primary" style={{ background: "#d97706" }} disabled={!backupFile || backupRestoring || backupVerifying || !backupVerification?.valid}>
                      {backupRestoring ? "Восстановление..." : "Восстановить данные"}
                    </button>
                  </div>
                </form>
              </section>
            </div>

            <section className="panel inventory">
              <div className="panel-heading">
                <div>
                  <h2>Локальные снимки и хранение (Backup Retention)</h2>
                  <p>Хранилище серверных снимков с sidecar-файлом SHA-256 и автоматической ротацией</p>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={snapshotCreating}
                    onClick={() => void createSnapshotNow()}
                  >
                    {snapshotCreating ? "Создание..." : "Создать снимок в хранилище"}
                  </button>
                  <button type="button" className="subtle" onClick={() => void openBackups()}>Обновить</button>
                </div>
              </div>
              {backupSnapshots.length === 0 ? (
                <div className="empty">Локальных снимков пока нет. Нажмите «Создать снимок в хранилище».</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ФАЙЛ СНИМКА</th>
                        <th>СОЗДАН</th>
                        <th>РАЗМЕР</th>
                        <th>ЦЕЛОСТНОСТЬ SHA-256</th>
                        <th>ДЕЙСТВИЯ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backupSnapshots.map(snap => (
                        <tr key={snap.filename}>
                          <td>
                            <strong className="mono">{snap.filename}</strong>
                            {snap.sha256_digest && <small className="mono">{snap.sha256_digest.slice(0, 24)}...</small>}
                          </td>
                          <td>{new Date(snap.created_at).toLocaleString()}</td>
                          <td className="mono">{(snap.size_bytes / 1024).toFixed(1)} KB</td>
                          <td
                            style={{
                              fontWeight: 600,
                              color:
                                snap.integrity_status === "verified"
                                  ? "#15803d"
                                  : snap.integrity_status === "corrupted"
                                  ? "#dc2626"
                                  : "#d97706"
                            }}
                          >
                            {snap.integrity_status === "verified"
                              ? "SHA-256 подтверждён"
                              : snap.integrity_status === "corrupted"
                              ? "Повреждён"
                              : "Нет .sha256 sidecar"}
                          </td>
                          <td className="actions">
                            <button type="button" onClick={() => void downloadSnapshotFile(snap)}>Скачать</button>
                            <button type="button" onClick={() => useSnapshotForDrill(snap)}>Учение DR</button>
                            <button type="button" className="danger" onClick={() => void deleteSnapshotFile(snap)}>Удалить</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Учения по восстановлению (Recovery Drill Report · PR #96)</h2>
                  <p>Аудируемый расчёт фактических RTO и RPO по ISO-8601 меткам времени с часовым поясом</p>
                </div>
                <button type="button" className="subtle" onClick={fillRehearsalTimestamps}>
                  Подставить тестовые метки (UTC)
                </button>
              </div>
              <form onSubmit={submitRecoveryDrill}>
                <div className="form-grid user-form-grid">
                  <label>
                    Ссылка на резервную копию *
                    <input
                      required
                      value={drillForm.backup_reference}
                      onChange={e => setDrillForm({ ...drillForm, backup_reference: e.target.value })}
                      placeholder="ecc-postgres-20261124T060000Z.dump.age"
                    />
                  </label>
                  <label>
                    Время инцидента (ISO + TZ) *
                    <input
                      required
                      value={drillForm.incident_at}
                      onChange={e => setDrillForm({ ...drillForm, incident_at: e.target.value })}
                      placeholder="2026-11-24T06:10:00Z"
                    />
                  </label>
                  <label>
                    Начало восстановления (опц.)
                    <input
                      value={drillForm.restore_started_at}
                      onChange={e => setDrillForm({ ...drillForm, restore_started_at: e.target.value })}
                      placeholder="2026-11-24T06:12:00Z"
                    />
                  </label>
                  <label>
                    Завершение восстановления (ISO + TZ) *
                    <input
                      required
                      value={drillForm.restore_completed_at}
                      onChange={e => setDrillForm({ ...drillForm, restore_completed_at: e.target.value })}
                      placeholder="2026-11-24T06:18:00Z"
                    />
                  </label>
                  <label>
                    Последняя транзакция (опц.)
                    <input
                      value={drillForm.last_committed_at}
                      onChange={e => setDrillForm({ ...drillForm, last_committed_at: e.target.value })}
                      placeholder="2026-11-24T06:07:00Z"
                    />
                  </label>
                  <label>
                    Целевой RTO (сек, опц.)
                    <input
                      type="number"
                      min={1}
                      value={drillForm.rto_target_seconds}
                      onChange={e => setDrillForm({ ...drillForm, rto_target_seconds: e.target.value })}
                      placeholder="900"
                    />
                  </label>
                  <label>
                    Целевой RPO (сек, опц.)
                    <input
                      type="number"
                      min={1}
                      value={drillForm.rpo_target_seconds}
                      onChange={e => setDrillForm({ ...drillForm, rpo_target_seconds: e.target.value })}
                      placeholder="300"
                    />
                  </label>
                </div>
                <div className="form-actions">
                  <span className="required-note">
                    Если последняя транзакция не указана, RPO остаётся не измеренным (не вычисляется по возрасту копии)
                  </span>
                  <button type="submit" className="primary" disabled={drillSaving}>
                    {drillSaving ? "Расчёт..." : "Зафиксировать отчёт об учениях"}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel inventory">
              <div className="panel-heading">
                <div>
                  <h2>Журнал отчётов по восстановлению</h2>
                  <p>{recoveryDrills.length} зафиксированных учений</p>
                </div>
                <button type="button" className="subtle" onClick={() => void openBackups()}>Обновить</button>
              </div>
              {recoveryDrills.length === 0 ? (
                <div className="empty">Отчёты об учениях по восстановлению ещё не создавались.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>КОПИЯ</th>
                        <th>OBSERVED RTO</th>
                        <th>EXECUTION</th>
                        <th>OBSERVED RPO</th>
                        <th>ОЦЕНКА</th>
                        <th>СФОРМИРОВАН</th>
                        <th>ДЕЙСТВИЯ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recoveryDrills.map(drill => {
                        const assessmentLabel: Record<RecoveryDrillAssessment, string> = {
                          within_targets: "В рамках целей",
                          target_exceeded: "Превышение цели",
                          not_assessed: "Не оценивалось"
                        };
                        const assessmentColor =
                          drill.assessment === "within_targets"
                            ? "#15803d"
                            : drill.assessment === "target_exceeded"
                            ? "#dc2626"
                            : "#64748b";
                        return (
                          <tr key={drill.id}>
                            <td className="mono"><strong>{drill.backup_reference}</strong></td>
                            <td className="mono">
                              {drill.measurements_seconds.observed_rto} с
                              {drill.targets_seconds.rto !== null && <small>Цель: ≤ {drill.targets_seconds.rto} с</small>}
                            </td>
                            <td className="mono">
                              {drill.measurements_seconds.restore_execution !== null ? `${drill.measurements_seconds.restore_execution} с` : "—"}
                            </td>
                            <td className="mono">
                              {drill.measurements_seconds.observed_rpo !== null ? `${drill.measurements_seconds.observed_rpo} с` : "Не измерен"}
                              {drill.targets_seconds.rpo !== null && <small>Цель: ≤ {drill.targets_seconds.rpo} с</small>}
                            </td>
                            <td style={{ color: assessmentColor, fontWeight: 600 }}>
                              {assessmentLabel[drill.assessment]}
                            </td>
                            <td>{new Date(drill.generated_at).toLocaleString()}</td>
                            <td className="actions">
                              <button type="button" onClick={() => void downloadDrillJson(drill)}>Скачать JSON</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}

        {/* --- SECTION: MONITORING & TELEMETRY (ROADMAP PHASE 2) --- */}
        {section === "monitoring" && currentUser.role === "admin" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">НАБЛЮДАЕМОСТЬ И БЕЗОПАСНОСТЬ</div>
                <h1>Мониторинг и диагностика</h1>
                <p>Состояние среды выполнения, активные механизмы защиты и журнал HTTP-запросов</p>
              </div>
              <button type="button" className="subtle" onClick={() => void openMonitoring()}>
                {telemetryLoading ? "Обновление..." : "🔄 Обновить телеметрию"}
              </button>
            </div>

            {error && <div className="alert">{error}</div>}

            {telemetry && (
              <>
                <div className="overview-grid">
                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>ВРЕМЯ РАБОТЫ (UPTIME)</span>
                      <span className="mono">{telemetry.node_version}</span>
                    </div>
                    <div className="kpi-value">
                      {telemetry.uptime_seconds >= 3600
                        ? `${Math.floor(telemetry.uptime_seconds / 3600)}ч ${Math.floor((telemetry.uptime_seconds % 3600) / 60)}м`
                        : `${Math.floor(telemetry.uptime_seconds / 60)}м ${telemetry.uptime_seconds % 60}с`}
                    </div>
                    <div className="kpi-sub">
                      Запуск: {new Date(telemetry.started_at).toLocaleString()}
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>ПАМЯТЬ ПРОЦЕССА</span>
                      <span className="mono">RSS {telemetry.memory.rss_mb} MB</span>
                    </div>
                    <div className="kpi-value">{telemetry.memory.heap_used_mb} MB</div>
                    <div className="kpi-sub">
                      Heap выделено: {telemetry.memory.heap_total_mb} MB
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>ХРАНИЛИЩЕ ДАННЫХ</span>
                      <span className="mono">{telemetry.storage.store_file}</span>
                    </div>
                    <div className="kpi-value">{telemetry.storage.size_kb} KB</div>
                    <div className="kpi-sub">
                      Событий аудита в организации: {telemetry.storage.total_audit_events}
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>HTTP-ЗАПРОСЫ API</span>
                      <span className="mono">Всего: {telemetry.requests.total}</span>
                    </div>
                    <div className="kpi-value">{telemetry.requests.api}</div>
                    <div className="kpi-sub">
                      4xx: {telemetry.requests.error_4xx} · 5xx: {telemetry.requests.error_5xx} · Блокировок: {telemetry.requests.rate_limit_blocks}
                      {typeof telemetry.requests.avg_duration_ms === "number" && (
                        <> · Ср/p95: {telemetry.requests.avg_duration_ms}/{telemetry.requests.p95_duration_ms ?? 0} мс</>
                      )}
                    </div>
                  </div>
                </div>

                {telemetry.alerts && telemetry.alerts.length > 0 && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Операционные алерты (Deployment Monitoring)</h2>
                        <p>Сигналы по отказам, безопасности и готовности резервного копирования</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {telemetry.alerts.map(alert => (
                        <div
                          key={alert.code}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "12px",
                            paddingBottom: "6px",
                            borderBottom: "1px solid #f1f5f9",
                            fontSize: "13px"
                          }}
                        >
                          <span>
                            <strong style={{ color: alert.level === "critical" ? "#dc2626" : alert.level === "warning" ? "#d97706" : "#0f172a" }}>
                              {alert.level === "critical" ? "КРИТИЧНО" : alert.level === "warning" ? "ВНИМАНИЕ" : "ИНФО"}:
                            </strong>{" "}
                            {alert.message}
                          </span>
                          <span className="mono" style={{ fontSize: "11px", color: "#64748b" }}>{alert.code}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Готовность резервного копирования (Backup &amp; DR)</h2>
                      <p>Последние операции резервного копирования, восстановления и учений RTO/RPO</p>
                    </div>
                    <button type="button" className="subtle" onClick={() => void openBackups()}>
                      Перейти к резервным копиям →
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ПОСЛЕДНИЙ БЭКАП</th>
                          <th>ВОССТАНОВЛЕНИЕ</th>
                          <th>СНИМКОВ В ХРАНИЛИЩЕ</th>
                          <th>ПОСЛЕДНИЕ УЧЕНИЯ DR</th>
                          <th>ОЦЕНКА УЧЕНИЙ</th>
                          <th>ВСЕГО ОТЧЁТОВ</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="mono">
                            {telemetry.backup_readiness.last_backup_at
                              ? new Date(telemetry.backup_readiness.last_backup_at).toLocaleString()
                              : "Не выполнялся"}
                          </td>
                          <td className="mono">
                            {telemetry.backup_readiness.last_restore_at
                              ? new Date(telemetry.backup_readiness.last_restore_at).toLocaleString()
                              : "Не выполнялось"}
                          </td>
                          <td className="mono">{telemetry.backup_readiness.local_snapshots_count ?? 0}</td>
                          <td className="mono">
                            {telemetry.backup_readiness.last_drill_at
                              ? new Date(telemetry.backup_readiness.last_drill_at).toLocaleString()
                              : "Не проводились"}
                          </td>
                          <td
                            style={{
                              fontWeight: 600,
                              color:
                                telemetry.backup_readiness.last_drill_assessment === "within_targets"
                                  ? "#15803d"
                                  : telemetry.backup_readiness.last_drill_assessment === "target_exceeded"
                                  ? "#dc2626"
                                  : "#64748b"
                            }}
                          >
                            {telemetry.backup_readiness.last_drill_assessment === "within_targets"
                              ? "В рамках целей"
                              : telemetry.backup_readiness.last_drill_assessment === "target_exceeded"
                              ? "Превышение цели"
                              : telemetry.backup_readiness.last_drill_assessment === "not_assessed"
                              ? "Не оценивалось"
                              : "—"}
                          </td>
                          <td className="mono">{telemetry.backup_readiness.total_drills}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                {telemetry.readiness_checks && telemetry.readiness_checks.length > 0 && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Чек-лист готовности к эксплуатации (Operational Readiness)</h2>
                        <p>Проверка ключевых параметров конфигурации, резервного копирования и наблюдаемости</p>
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>ПАРАМЕТР</th>
                            <th>СТАТУС</th>
                            <th>ДЕТАЛИ ПРОВЕРКИ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {telemetry.readiness_checks.map(check => (
                            <tr key={check.id}>
                              <td>
                                <strong>{check.label}</strong>
                                <small className="mono">{check.id}</small>
                              </td>
                              <td style={{ fontWeight: 700, color: check.status === "pass" ? "#15803d" : "#d97706" }}>
                                {check.status === "pass" ? "PASS" : "ТРЕБУЕТ ВНИМАНИЯ"}
                              </td>
                              <td style={{ fontSize: "12px", color: "#334155" }}>{check.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Контроль безопасности (Security Posture)</h2>
                      <p>Активные политики защиты на уровне HTTP-транспорта и API</p>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>КОНТРОЛЬ БЕЗОПАСНОСТИ</th>
                          <th>ИДЕНТИФИКАТОР</th>
                          <th>СОСТОЯНИЕ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {telemetry.security_posture.map(item => (
                          <tr key={item.id}>
                            <td><strong>{item.label}</strong></td>
                            <td className="mono">{item.id}</td>
                            <td style={{ color: "#15803d", fontWeight: 600 }}>Активно</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="panel inventory">
                  <div className="panel-heading">
                    <div>
                      <h2>Структурированный журнал HTTP-запросов</h2>
                      <p>Показано {filteredLogs.length} из {telemetry.recent_logs.length} последних запросов к API</p>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        className="search"
                        value={logPathSearch}
                        onChange={e => setLogPathSearch(e.target.value)}
                        placeholder="⌕  Фильтр по пути или методу..."
                      />
                      <select
                        value={logStatusFilter}
                        onChange={e => setLogStatusFilter(e.target.value as "all" | "2xx" | "4xx" | "5xx")}
                        style={{ fontSize: "11px", padding: "6px" }}
                      >
                        <option value="all">Все коды</option>
                        <option value="2xx">2xx Успех</option>
                        <option value="4xx">4xx Ошибки клиента</option>
                        <option value="5xx">5xx Ошибки сервера</option>
                      </select>
                      <button type="button" className="subtle" onClick={exportTelemetryLogsJson} disabled={filteredLogs.length === 0}>
                        Экспорт логов (.json)
                      </button>
                    </div>
                  </div>
                  {filteredLogs.length === 0 ? (
                    <div className="empty">Подходящих HTTP-запросов не найдено.</div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>ВРЕМЯ</th>
                            <th>МЕТОД</th>
                            <th>МАРШРУТ</th>
                            <th>СТАТУС</th>
                            <th>ВРЕМЯ ОТВЕТА</th>
                            <th>USER ID</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLogs.map(log => (
                            <tr key={log.id}>
                              <td className="mono">#{log.id}</td>
                              <td className="mono">{new Date(log.timestamp).toLocaleTimeString()}</td>
                              <td className="mono"><strong>{log.method}</strong></td>
                              <td className="mono">{log.path}</td>
                              <td className="mono" style={{ color: log.status >= 500 ? "#dc2626" : log.status >= 400 ? "#d97706" : "#15803d", fontWeight: 600 }}>
                                {log.status}
                              </td>
                              <td className="mono">{log.duration_ms} мс</td>
                              <td className="mono">{log.user_id ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        )}

        {/* --- SECTION: COMMERCIAL EDITION & LICENSING (ROADMAP PHASE 3) --- */}
        {section === "licensing" && currentUser.role === "admin" && (
          <section className="admin-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">КОММЕРЧЕСКОЕ ЛИЦЕНЗИРОВАНИЕ И SLA (PHASE 3)</div>
                <h1>Редакция и офлайн-активация</h1>
                <p>Границы Community / Enterprise, контроль квот организации, SLA-отчётность и пакеты поддержки</p>
              </div>
              <button type="button" className="subtle" onClick={() => void openLicensing()}>
                Обновить статус
              </button>
            </div>

            {error && <div className="alert">{error}</div>}
            {notice && <div className="notice">{notice}</div>}

            {editionSummary && (
              <>
                <div className="overview-grid">
                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>АКТИВНАЯ РЕДАКЦИЯ</span>
                      <span className="mono">{editionSummary.license_status.toUpperCase()}</span>
                    </div>
                    <div className="kpi-value" style={{ fontSize: "20px" }}>{editionSummary.edition_label}</div>
                    <div className="kpi-sub">
                      {editionSummary.license
                        ? `Лицензиат: ${editionSummary.license.customer_name} · до ${new Date(editionSummary.license.expires_at).toLocaleDateString()}`
                        : "Базовая бесплатная редакция (офлайн-ключ не установлен)"}
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>ПОЛЬЗОВАТЕЛИ</span>
                      <span className="mono">КВОТА</span>
                    </div>
                    <div className="kpi-value">
                      {editionSummary.usage.users} / {editionSummary.limits.max_users ?? "∞"}
                    </div>
                    <div className="kpi-sub">Учётных записей в организации</div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>ОБОРУДОВАНИЕ</span>
                      <span className="mono">КВОТА</span>
                    </div>
                    <div className="kpi-value">
                      {editionSummary.usage.assets} / {editionSummary.limits.max_assets ?? "∞"}
                    </div>
                    <div className="kpi-sub">Инвентарных единиц в реестре</div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-label">
                      <span>ЛИЦЕНЗИИ ПО</span>
                      <span className="mono">КВОТА</span>
                    </div>
                    <div className="kpi-value">
                      {editionSummary.usage.software_licenses} / {editionSummary.limits.max_software_licenses ?? "∞"}
                    </div>
                    <div className="kpi-sub">Записей в реестре ПО</div>
                  </div>
                </div>

                <div className="section-split">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Офлайн-активация коммерческой лицензии</h2>
                        <p>Проверка HMAC-SHA256 подписи ключа формата ECC1.&lt;payload&gt;.&lt;sig&gt;</p>
                      </div>
                    </div>
                    <form onSubmit={activateLicenseSubmit}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "8px" }}>
                        Офлайн-ключ активации *
                        <textarea
                          rows={3}
                          value={licenseKeyInput}
                          onChange={e => setLicenseKeyInput(e.target.value)}
                          placeholder="ECC1.eyJzY2hlbWFfdmVyc2lvbiI6MSwuLi59...."
                          style={{ width: "100%", marginTop: "6px", fontFamily: "monospace", fontSize: "12px", padding: "8px" }}
                        />
                      </label>
                      <div className="form-actions" style={{ justifyContent: "flex-start" }}>
                        <button type="submit" className="primary" disabled={licenseSaving || !licenseKeyInput.trim()}>
                          {licenseSaving ? "Проверка..." : "Активировать лицензию"}
                        </button>
                        {editionSummary.license && (
                          <button
                            type="button"
                            className="danger"
                            disabled={licenseSaving}
                            onClick={() => void deactivateLicenseAction()}
                          >
                            Сбросить до Community
                          </button>
                        )}
                      </div>
                    </form>
                    {editionSummary.license && (
                      <div style={{ marginTop: "12px", padding: "10px 12px", border: "1px solid #cbd5e1", background: "#f8fafc", fontSize: "12px", lineHeight: 1.6 }}>
                        <div><strong>ID лицензии:</strong> <span className="mono">{editionSummary.license.license_id}</span></div>
                        <div><strong>Организация:</strong> {editionSummary.license.organization_name} · <strong>Отпечаток:</strong> <span className="mono">{editionSummary.license.key_fingerprint}</span></div>
                        <div><strong>Срок действия:</strong> {new Date(editionSummary.license.issued_at).toLocaleDateString()} — {new Date(editionSummary.license.expires_at).toLocaleDateString()}</div>
                      </div>
                    )}
                  </section>

                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Коммерческий пакет поддержки (Support Bundle)</h2>
                        <p>Выгрузка обезличенной диагностики и сводки подписки для обращений в поддержку</p>
                      </div>
                    </div>
                    <p style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6 }}>
                      Пакет включает параметры редакции, чек-лист готовности, сводку DR-учений и коды HTTP-ошибок
                      без паролей, хешей, токенов, ключей подписи и персональных данных сотрудников.
                    </p>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                      <button
                        type="button"
                        className="primary"
                        disabled={!editionSummary.features.includes("support_bundle_export")}
                        onClick={() => void downloadSupportBundleFile()}
                      >
                        ⬇ Скачать Support Bundle (.json)
                      </button>
                      <button
                        type="button"
                        className="subtle"
                        disabled={!editionSummary.features.includes("enterprise_sla_reporting")}
                        onClick={() => void downloadSlaCsv()}
                      >
                        ⬇ Экспорт SLA-отчёта (.csv)
                      </button>
                    </div>
                    {!editionSummary.features.includes("support_bundle_export") && (
                      <p style={{ fontSize: "11px", color: "#d97706", marginTop: "10px" }}>
                        Для выгрузки SLA-отчётов и пакета поддержки активируйте лицензию Professional или Enterprise.
                      </p>
                    )}
                  </section>
                </div>

                {slaReport && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Отчёт SLA и операционного соответствия (Enterprise Reporting)</h2>
                        <p>Рассчитано по данным организации «{slaReport.organization_name}» на {new Date(slaReport.generated_at).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="overview-grid">
                      <div className="kpi-card">
                        <div className="kpi-label"><span>ГОТОВНОСТЬ ПАРКА</span></div>
                        <div className="kpi-value">{slaReport.availability_and_assets.operational_availability_pct}%</div>
                        <div className="kpi-sub">
                          В работе: {slaReport.availability_and_assets.active_assets} · Ремонт: {slaReport.availability_and_assets.in_repair_assets} · Списано: {slaReport.availability_and_assets.retired_assets}
                        </div>
                      </div>
                      <div className="kpi-card">
                        <div className="kpi-label"><span>MTTR ПО ЗАЯВКАМ</span></div>
                        <div className="kpi-value">
                          {slaReport.maintenance_sla.mean_time_to_resolve_hours !== null
                            ? `${slaReport.maintenance_sla.mean_time_to_resolve_hours} ч`
                            : "—"}
                        </div>
                        <div className="kpi-sub">
                          Открытых High/Urgent: {slaReport.maintenance_sla.open_high_or_urgent}
                          {slaReport.maintenance_sla.oldest_open_priority_hours !== null
                            ? ` (макс. возраст: ${slaReport.maintenance_sla.oldest_open_priority_hours} ч)`
                            : ""}
                        </div>
                      </div>
                      <div className="kpi-card">
                        <div className="kpi-label"><span>УТИЛИЗАЦИЯ ЛИЦЕНЗИЙ ПО</span></div>
                        <div className="kpi-value">{slaReport.software_compliance.utilization_pct}%</div>
                        <div className="kpi-sub">
                          Мест: {slaReport.software_compliance.seats_used} / {slaReport.software_compliance.seats_total} · Истекает &lt;60 дн: {slaReport.software_compliance.expiring_within_60d}
                        </div>
                      </div>
                      <div className="kpi-card">
                        <div className="kpi-label"><span>СООТВЕТСТВИЕ DR / RTO-RPO</span></div>
                        <div className="kpi-value">
                          {slaReport.resilience_and_dr.dr_compliance_pct !== null
                            ? `${slaReport.resilience_and_dr.dr_compliance_pct}%`
                            : "—"}
                        </div>
                        <div className="kpi-sub">
                          Снимков SHA-256: {slaReport.resilience_and_dr.verified_snapshots_count} · Учений в норме: {slaReport.resilience_and_dr.drills_within_targets} / {slaReport.resilience_and_dr.total_drills}
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Сравнение редакций (Community vs Professional vs Enterprise)</h2>
                      <p>Прозрачные границы функциональности и квот</p>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>РЕДАКЦИЯ</th>
                          <th>ПОЛЬЗОВАТЕЛИ</th>
                          <th>ОБОРУДОВАНИЕ</th>
                          <th>ЛИЦЕНЗИИ ПО</th>
                          <th>ФУНКЦИИ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editionSummary.catalog.map(item => (
                          <tr key={item.edition}>
                            <td>
                              <strong>{item.label}</strong>
                              <small>{item.description}</small>
                            </td>
                            <td className="mono">{item.limits.max_users ?? "Без лимита"}</td>
                            <td className="mono">{item.limits.max_assets ?? "Без лимита"}</td>
                            <td className="mono">{item.limits.max_software_licenses ?? "Без лимита"}</td>
                            <td style={{ fontSize: "12px" }}>{item.features.join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
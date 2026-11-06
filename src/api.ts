import type {
  AuditLogEntry,
  BackupSettings,
  BlastRadiusResult,
  ComplianceRule,
  ConfigSnapshotMeta,
  CredentialProfile,
  DeviceDiffResponse,
  DriftAlert,
  FleetComplianceReport,
  FleetSearchResponse,
  MaintenanceWindow,
  NetworkDevice,
  OverviewMetrics,
  ReadinessAuditResponse,
  TopologyGraph,
} from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errBody.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getOverview: () => request<OverviewMetrics>('/api/overview'),
  verifyFleetReadiness: () =>
    request<ReadinessAuditResponse>('/api/verify-fleet-readiness', { method: 'POST' }),

  listDevices: () => request<NetworkDevice[]>('/api/devices'),
  createDevice: (payload: Record<string, unknown>) =>
    request<{ id: number; hostname: string }>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteDevice: (deviceId: number) =>
    request<{ deleted: number }>(`/api/devices/${deviceId}`, { method: 'DELETE' }),

  backupDevice: (deviceId: number) =>
    request<Record<string, unknown>>(`/api/devices/${deviceId}/backup`, { method: 'POST' }),
  runAllBackups: () =>
    request<{ ran_at: string; total_processed: number; drifted_count: number }>(
      '/api/backups/run-all',
      { method: 'POST' }
    ),

  simulateDrift: (deviceId: number, scenario: string) =>
    request<{ scenario: string; summary: string; backup_result: Record<string, unknown> }>(
      `/api/devices/${deviceId}/simulate-drift`,
      {
        method: 'POST',
        body: JSON.stringify({ scenario }),
      }
    ),

  getDeviceSnapshots: (deviceId: number) =>
    request<ConfigSnapshotMeta[]>(`/api/devices/${deviceId}/snapshots`),

  getDeviceDiff: (
    deviceId: number,
    params?: { base_snapshot_id?: number; target_snapshot_id?: number; ignore_noise?: boolean }
  ) => {
    const q = new URLSearchParams();
    if (params?.base_snapshot_id) q.set('base_snapshot_id', String(params.base_snapshot_id));
    if (params?.target_snapshot_id) q.set('target_snapshot_id', String(params.target_snapshot_id));
    if (params?.ignore_noise !== undefined) q.set('ignore_noise', String(params.ignore_noise));
    const queryStr = q.toString() ? `?${q.toString()}` : '';
    return request<DeviceDiffResponse>(`/api/devices/${deviceId}/diff${queryStr}`);
  },

  promoteToLkg: (deviceId: number, snapshotId: number) =>
    request<{ device_id: number; new_lkg_snapshot_id: number; drift_detected: boolean }>(
      `/api/devices/${deviceId}/promote-lkg/${snapshotId}`,
      { method: 'POST' }
    ),

  rollbackToLkg: (deviceId: number) =>
    request<{ status: string; device_id: number }>(`/api/devices/${deviceId}/rollback-to-lkg`, {
      method: 'POST',
    }),

  getTopology: (site?: string) => {
    const q = site && site !== 'ALL' ? `?site=${encodeURIComponent(site)}` : '';
    return request<TopologyGraph>(`/api/topology${q}`);
  },

  getBlastRadius: (nodeId: string, site?: string) => {
    const q = site && site !== 'ALL' ? `?site=${encodeURIComponent(site)}` : '';
    return request<BlastRadiusResult>(`/api/topology/blast-radius/${encodeURIComponent(nodeId)}${q}`);
  },

  parseNeighborCli: (raw_output: string, vendor: string, attach_to_device_id?: number) =>
    request<{
      parsed_count: number;
      neighbors: Array<{
        remote_hostname: string;
        remote_ip: string;
        remote_platform: string;
        local_port: string;
        remote_port: string;
        protocol: string;
      }>;
    }>('/api/topology/parse-cli', {
      method: 'POST',
      body: JSON.stringify({ raw_output, vendor, attach_to_device_id }),
    }),

  listMaintenanceWindows: () => request<MaintenanceWindow[]>('/api/maintenance-windows'),
  createMaintenanceWindow: (payload: Record<string, unknown>) =>
    request<{ id: number; name: string }>('/api/maintenance-windows', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  toggleMaintenanceWindow: (windowId: number) =>
    request<{ id: number; is_active_override: boolean }>(
      `/api/maintenance-windows/${windowId}/toggle`,
      { method: 'PATCH' }
    ),
  deleteMaintenanceWindow: (windowId: number) =>
    request<{ deleted: number }>(`/api/maintenance-windows/${windowId}`, { method: 'DELETE' }),

  listAlerts: () => request<DriftAlert[]>('/api/alerts'),
  acknowledgeAlert: (alertId: number) =>
    request<{ acknowledged: number }>(`/api/alerts/${alertId}/acknowledge`, { method: 'POST' }),
  acknowledgeAllAlerts: () =>
    request<{ status: string }>('/api/alerts/acknowledge-all', { method: 'POST' }),

  getSettings: () => request<BackupSettings>('/api/settings'),
  updateSettings: (payload: BackupSettings) =>
    request<BackupSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listCredentials: () => request<CredentialProfile[]>('/api/credentials'),
  createCredential: (payload: Record<string, unknown>) =>
    request<{ id: number; name: string }>('/api/credentials', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  verifyCredential: (credId: number) =>
    request<{
      credential_id: number;
      name: string;
      verified_at: string;
      devices_tested: number;
      all_passed: boolean;
      results: Array<{
        hostname: string;
        ip_address: string;
        authenticated: boolean;
        latency_ms: number;
        message: string;
      }>;
    }>(`/api/credentials/${credId}/verify`, { method: 'POST' }),
  deleteCredential: (credId: number) =>
    request<{ deleted: number }>(`/api/credentials/${credId}`, { method: 'DELETE' }),

  // Fleet Config Search
  searchFleetConfigs: (params: {
    query: string;
    is_regex?: boolean;
    case_sensitive?: boolean;
    site?: string;
    vendor?: string;
    scope?: string;
  }) => {
    const q = new URLSearchParams();
    q.set('query', params.query);
    if (params.is_regex !== undefined) q.set('is_regex', String(params.is_regex));
    if (params.case_sensitive !== undefined) q.set('case_sensitive', String(params.case_sensitive));
    if (params.site && params.site !== 'ALL') q.set('site', params.site);
    if (params.vendor && params.vendor !== 'ALL') q.set('vendor', params.vendor);
    if (params.scope) q.set('scope', params.scope);
    return request<FleetSearchResponse>(`/api/fleet/search?${q.toString()}`);
  },

  // Compliance Engine
  listComplianceRules: (vendor?: string) => {
    const q = vendor && vendor !== 'ALL' ? `?vendor=${encodeURIComponent(vendor)}` : '';
    return request<ComplianceRule[]>(`/api/compliance/rules${q}`);
  },
  createComplianceRule: (payload: Record<string, unknown>) =>
    request<ComplianceRule>('/api/compliance/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteComplianceRule: (ruleId: string) =>
    request<{ deleted: string }>(`/api/compliance/rules/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    }),
  scanCompliance: (deviceId?: number) => {
    const q = deviceId ? `?device_id=${deviceId}` : '';
    return request<FleetComplianceReport>(`/api/compliance/scan${q}`, { method: 'POST' });
  },
  getComplianceReport: () => request<FleetComplianceReport>('/api/compliance/report'),

  // Disaster Recovery Export URLs & helpers
  getFleetDrZipUrl: () => '/api/fleet/export/zip',
  getDeviceExportUrl: (deviceId: number, version: 'latest' | 'lkg' = 'latest') =>
    `/api/devices/${deviceId}/export?version=${version}`,

  // Operational Audit Logs
  listAuditLogs: (params?: { limit?: number; action?: string; severity?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.action && params.action !== 'ALL') q.set('action', params.action);
    if (params?.severity && params.severity !== 'ALL') q.set('severity', params.severity);
    const queryStr = q.toString() ? `?${q.toString()}` : '';
    return request<AuditLogEntry[]>(`/api/audit-logs${queryStr}`);
  },

  resetDemo: () => request<{ status: string }>('/api/demo/reset', { method: 'POST' }),
};

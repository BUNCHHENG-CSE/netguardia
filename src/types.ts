export interface OverviewMetrics {
  total_devices: number;
  online_devices: number;
  sites: string[];
  site_count: number;
  verified_clean_devices: number;
  drifted_devices: number;
  stale_devices: number;
  unacknowledged_alerts: number;
  total_neighbor_links: number;
  readiness_score: number;
  last_global_run_at: string | null;
  last_readiness_audit_at: string | null;
  stale_backup_threshold_days: number;
  database?: {
    engine: string;
    mode: string;
    connected: boolean;
    version: string;
    dsn_configured: boolean;
    schema_file: string;
  };
  saas_roi: {
    recommended_plan: string;
    monthly_price_usd: number;
    price_band: string;
    manual_hours_saved_monthly: number;
    downtime_cost_avoided_usd: number;
  };
}

export interface ReadinessCheckItem {
  device_id: number;
  hostname: string;
  site: string;
  vendor: string;
  credential_name: string;
  ssh_verified: boolean;
  latency_ms: number;
  backup_age_days: number;
  is_backup_fresh: boolean;
  has_lkg: boolean;
  drift_detected: boolean;
  readiness_status: 'READY' | 'AUTH_FAILED' | 'STALE_BACKUP' | 'DRIFT_UNVERIFIED';
  detail: string;
}

export interface ReadinessAuditResponse {
  audited_at: string;
  total_devices: number;
  ready_devices: number;
  readiness_percentage: number;
  results: ReadinessCheckItem[];
}

export interface NetworkDevice {
  id: number;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  vendor: string;
  model: string;
  os_type: string;
  role: string;
  site: string;
  credential_id: number | null;
  credential_name: string | null;
  credential_protocol: string | null;
  is_simulated: boolean;
  status: string;
  drift_detected: boolean;
  lkg_snapshot_id: number | null;
  latest_snapshot_id: number | null;
  lkg_version: number | null;
  lkg_hash: string | null;
  lkg_created_at: string | null;
  latest_version: number | null;
  latest_hash: string | null;
  last_backup_at: string | null;
  last_verified_at: string | null;
  backup_age_days: number;
  is_stale: boolean;
  snapshot_count: number;
  neighbor_count: number;
}

export interface ConfigSnapshotMeta {
  id: number;
  device_id: number;
  version_number: number;
  raw_hash: string;
  normalized_hash: string;
  size_bytes: number;
  collected_by: string;
  in_maintenance_window: number;
  is_lkg: number;
  notes: string;
  created_at: string;
}

export interface SideBySideRow {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  left_line: number | null;
  left_text: string | null;
  right_line: number | null;
  right_text: string | null;
  risk: {
    severity: string;
    category: string;
  } | null;
}

export interface RiskFinding {
  severity: string;
  category: string;
  line: string;
  line_number: number | null;
}

export interface DeviceDiffResponse {
  device: {
    id: number;
    hostname: string;
    ip_address: string;
    vendor: string;
    model: string;
    site: string;
    drift_detected: boolean;
  };
  base_snapshot: {
    id: number;
    version_number: number;
    is_lkg: boolean;
    normalized_hash: string;
    created_at: string;
    config_text: string;
  };
  target_snapshot: {
    id: number;
    version_number: number;
    is_lkg: boolean;
    normalized_hash: string;
    created_at: string;
    config_text: string;
  };
  ignore_noise: boolean;
  diff: {
    has_changes: boolean;
    added_count: number;
    removed_count: number;
    suppressed_noise_lines: number;
    highest_severity: string;
    risk_findings: RiskFinding[];
    unified_diff: string;
    side_by_side: SideBySideRow[];
    rollback_cli: string;
  };
}

export interface TopologyNode {
  id: string;
  device_id: number | null;
  hostname: string;
  ip_address: string;
  vendor: string;
  model: string;
  os_type: string;
  role: string;
  site: string;
  tier: number;
  status: string;
  drift_detected: boolean;
  has_lkg: boolean;
  last_backup_at: string | null;
  is_managed: boolean;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  source_hostname: string;
  target_hostname: string;
  source_port: string;
  target_port: string;
  protocol: 'CDP' | 'LLDP';
  site: string;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  stats: {
    total_nodes: number;
    managed_nodes: number;
    unmanaged_discovered_nodes: number;
    total_links: number;
    cdp_links: number;
    lldp_links: number;
  };
}

export interface BlastRadiusResult {
  failed_node_id: string;
  failed_hostname: string;
  failed_role: string;
  failed_site: string;
  isolated_nodes: string[];
  isolated_hostnames: string[];
  degraded_nodes: string[];
  degraded_hostnames: string[];
  affected_edges: string[];
  recovery_readiness: string;
  total_impacted_devices: number;
}

export interface MaintenanceWindow {
  id: number;
  name: string;
  site: string;
  day_of_week: string;
  start_time_utc: string;
  end_time_utc: string;
  is_active_override: number;
  auto_promote_lkg: number;
  created_at: string;
}

export interface DriftAlert {
  id: number;
  device_id: number;
  snapshot_id: number | null;
  severity: 'CRITICAL' | 'HIGH' | 'WARNING' | 'MEDIUM' | 'LOW';
  alert_type: string;
  title: string;
  message: string;
  outside_maintenance_window: boolean;
  added_lines: number;
  removed_lines: number;
  risk_categories: string[];
  acknowledged: boolean;
  created_at: string;
  hostname: string;
  ip_address: string;
  vendor: string;
  site: string;
  role: string;
}

export interface CredentialProfile {
  id: number;
  name: string;
  protocol: string;
  username: string;
  password_masked: string;
  enable_secret_masked: string;
  ssh_key_masked: string;
  snmp_community_masked: string;
  description: string;
  assigned_devices_count: number;
  last_verified_at: string | null;
  created_at: string;
}

export interface BackupSettings {
  schedule_enabled: boolean;
  interval_minutes: number;
  cron_expression: string;
  noise_filter_enabled: boolean;
  alert_on_out_of_window: boolean;
  stale_backup_threshold_days: number;
  webhook_url: string;
  notification_email: string;
  last_global_run_at: string | null;
  last_readiness_audit_at: string | null;
}

// ---------------------------------------------------------------------------
// Fleet Search Types
// ---------------------------------------------------------------------------

export interface SearchContextLine {
  line_number: number;
  text: string;
  is_target: boolean;
}

export interface SearchMatchItem {
  line_number: number;
  matched_line: string;
  context: SearchContextLine[];
}

export interface DeviceSearchResult {
  device_id: number;
  hostname: string;
  ip_address: string;
  site: string;
  vendor: string;
  model: string;
  role: string;
  snapshot_id: number;
  snapshot_version: number;
  is_lkg: boolean;
  match_count: number;
  matches: SearchMatchItem[];
}

export interface FleetSearchResponse {
  query: string;
  is_regex: boolean;
  case_sensitive: boolean;
  scope: string;
  total_devices_searched: number;
  devices_with_matches: number;
  total_matched_lines: number;
  results: DeviceSearchResult[];
}

// ---------------------------------------------------------------------------
// Compliance Engine Types
// ---------------------------------------------------------------------------

export interface ComplianceRule {
  id: number;
  rule_id: string;
  name: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  vendor: string;
  pattern_type: 'must_contain' | 'must_not_contain' | 'regex_match' | 'regex_no_match';
  pattern: string;
  remediation_cli: string;
  enabled: number;
  created_at: string;
}

export interface RuleViolationLine {
  line_number: number | null;
  text: string;
}

export interface ComplianceRuleEvaluation {
  rule_id: string;
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  passed: boolean;
  status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  violating_lines: RuleViolationLine[];
  remediation_cli: string;
  message: string;
}

export interface DeviceComplianceResult {
  device_id: number;
  hostname: string;
  vendor: string;
  model: string;
  site: string;
  score: number;
  passed: boolean;
  total_rules_evaluated: number;
  passed_rules: number;
  failed_rules: number;
  critical_violations: number;
  high_violations: number;
  medium_violations: number;
  evaluations: ComplianceRuleEvaluation[];
}

export interface FleetComplianceReport {
  scanned_at: string;
  total_rules: number;
  total_devices_scanned: number;
  compliant_devices: number;
  non_compliant_devices: number;
  fleet_compliance_score: number;
  devices: DeviceComplianceResult[];
}

// ---------------------------------------------------------------------------
// Operational Audit Trail Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  action: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  actor: string;
  target: string;
  details: string;
  metadata_json?: string;
  metadata?: Record<string, unknown>;
}


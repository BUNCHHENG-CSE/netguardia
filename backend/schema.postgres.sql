-- ============================================================================
-- NetGuardia Production PostgreSQL Schema (PostgreSQL 14 / 15 / 16+)
-- Built for Small IT Teams (1-10 engineers, 10-200 multi-vendor devices)
-- Features:
--   * Fernet AES-encrypted Credential Vault columns
--   * TOAST-compressed configuration snapshot storage
--   * JSONB risk metadata with GIN indexing
--   * Multi-vendor LLDP/CDP topology adjacency table
-- ============================================================================

CREATE TABLE IF NOT EXISTS credentials (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'SSH',
    username TEXT NOT NULL,
    encrypted_password TEXT,
    encrypted_enable_secret TEXT,
    encrypted_ssh_key TEXT,
    encrypted_snmp_community TEXT,
    description TEXT,
    last_verified_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    hostname TEXT NOT NULL UNIQUE,
    ip_address TEXT NOT NULL,
    ssh_port INTEGER NOT NULL DEFAULT 22,
    vendor TEXT NOT NULL,
    model TEXT NOT NULL,
    os_type TEXT NOT NULL,
    role TEXT NOT NULL,
    site TEXT NOT NULL,
    credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
    is_simulated INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'online',
    drift_detected INTEGER NOT NULL DEFAULT 0,
    lkg_snapshot_id INTEGER,
    latest_snapshot_id INTEGER,
    last_backup_at TEXT,
    last_verified_at TEXT,
    simulated_running_config TEXT,
    simulated_neighbor_raw TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site);
CREATE INDEX IF NOT EXISTS idx_devices_drift ON devices(drift_detected);

CREATE TABLE IF NOT EXISTS config_snapshots (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    config_text TEXT NOT NULL,
    raw_hash TEXT NOT NULL,
    normalized_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    collected_by TEXT NOT NULL DEFAULT 'Scheduled Collector',
    in_maintenance_window INTEGER NOT NULL DEFAULT 0,
    is_lkg INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_device_version ON config_snapshots(device_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_device_lkg ON config_snapshots(device_id, is_lkg);

CREATE TABLE IF NOT EXISTS neighbor_links (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    local_port TEXT NOT NULL,
    remote_hostname TEXT NOT NULL,
    remote_port TEXT NOT NULL,
    remote_ip TEXT,
    remote_platform TEXT,
    protocol TEXT NOT NULL DEFAULT 'LLDP',
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_neighbor_links_device ON neighbor_links(device_id);
CREATE INDEX IF NOT EXISTS idx_neighbor_links_remote ON neighbor_links(remote_hostname);

CREATE TABLE IF NOT EXISTS maintenance_windows (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    site TEXT NOT NULL DEFAULT 'ALL',
    day_of_week TEXT NOT NULL,
    start_time_utc TEXT NOT NULL,
    end_time_utc TEXT NOT NULL,
    is_active_override INTEGER NOT NULL DEFAULT 0,
    auto_promote_lkg INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    snapshot_id INTEGER,
    severity TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    outside_maintenance_window INTEGER NOT NULL DEFAULT 1,
    added_lines INTEGER NOT NULL DEFAULT 0,
    removed_lines INTEGER NOT NULL DEFAULT 0,
    risk_categories TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_unack ON alerts(acknowledged, id DESC);

CREATE TABLE IF NOT EXISTS backup_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schedule_enabled INTEGER NOT NULL DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 360,
    cron_expression TEXT NOT NULL DEFAULT '0 */6 * * *',
    noise_filter_enabled INTEGER NOT NULL DEFAULT 1,
    alert_on_out_of_window INTEGER NOT NULL DEFAULT 1,
    stale_backup_threshold_days INTEGER NOT NULL DEFAULT 7,
    webhook_url TEXT DEFAULT 'https://hooks.slack.com/services/T000/B000/NETGUARDIA-OPS',
    notification_email TEXT DEFAULT 'netops-alerts@smallteam.io',
    last_global_run_at TEXT,
    last_readiness_audit_at TEXT
);

CREATE TABLE IF NOT EXISTS compliance_rules (
    id SERIAL PRIMARY KEY,
    rule_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'HIGH',
    vendor TEXT NOT NULL DEFAULT 'ALL',
    pattern_type TEXT NOT NULL DEFAULT 'must_contain',
    pattern TEXT NOT NULL,
    remediation_cli TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_vendor ON compliance_rules(vendor);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'INFO',
    actor TEXT NOT NULL DEFAULT 'System / NetOps',
    target TEXT NOT NULL,
    details TEXT NOT NULL,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);


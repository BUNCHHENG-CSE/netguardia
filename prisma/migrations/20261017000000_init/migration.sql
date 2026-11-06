-- CreateTable
CREATE TABLE "credentials" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'SSH',
    "username" TEXT NOT NULL,
    "encrypted_password" TEXT,
    "encrypted_enable_secret" TEXT,
    "encrypted_ssh_key" TEXT,
    "encrypted_snmp_community" TEXT,
    "description" TEXT,
    "last_verified_at" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "hostname" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "ssh_port" INTEGER NOT NULL DEFAULT 22,
    "vendor" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "os_type" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "credential_id" INTEGER,
    "is_simulated" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'online',
    "drift_detected" INTEGER NOT NULL DEFAULT 0,
    "lkg_snapshot_id" INTEGER,
    "latest_snapshot_id" INTEGER,
    "last_backup_at" TEXT,
    "last_verified_at" TEXT,
    "simulated_running_config" TEXT,
    "simulated_neighbor_raw" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_snapshots" (
    "id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "config_text" TEXT NOT NULL,
    "raw_hash" TEXT NOT NULL,
    "normalized_hash" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "collected_by" TEXT NOT NULL DEFAULT 'Scheduled Collector',
    "in_maintenance_window" INTEGER NOT NULL DEFAULT 0,
    "is_lkg" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "config_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neighbor_links" (
    "id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "local_port" TEXT NOT NULL,
    "remote_hostname" TEXT NOT NULL,
    "remote_port" TEXT NOT NULL,
    "remote_ip" TEXT,
    "remote_platform" TEXT,
    "protocol" TEXT NOT NULL DEFAULT 'LLDP',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "neighbor_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_windows" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT 'ALL',
    "day_of_week" TEXT NOT NULL,
    "start_time_utc" TEXT NOT NULL,
    "end_time_utc" TEXT NOT NULL,
    "is_active_override" INTEGER NOT NULL DEFAULT 0,
    "auto_promote_lkg" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "snapshot_id" INTEGER,
    "severity" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "outside_maintenance_window" INTEGER NOT NULL DEFAULT 1,
    "added_lines" INTEGER NOT NULL DEFAULT 0,
    "removed_lines" INTEGER NOT NULL DEFAULT 0,
    "risk_categories" TEXT,
    "acknowledged" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "schedule_enabled" INTEGER NOT NULL DEFAULT 1,
    "interval_minutes" INTEGER NOT NULL DEFAULT 360,
    "cron_expression" TEXT NOT NULL DEFAULT '0 */6 * * *',
    "noise_filter_enabled" INTEGER NOT NULL DEFAULT 1,
    "alert_on_out_of_window" INTEGER NOT NULL DEFAULT 1,
    "stale_backup_threshold_days" INTEGER NOT NULL DEFAULT 7,
    "webhook_url" TEXT DEFAULT 'https://hooks.slack.com/services/T000/B000/NETGUARDIA-OPS',
    "notification_email" TEXT DEFAULT 'netops-alerts@smallteam.io',
    "last_global_run_at" TEXT,
    "last_readiness_audit_at" TEXT,

    CONSTRAINT "backup_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_credentials_name" ON "credentials"("name");

-- CreateIndex
CREATE UNIQUE INDEX "devices_hostname_key" ON "devices"("hostname");

-- CreateIndex
CREATE INDEX "idx_devices_site_hostname" ON "devices"("site", "hostname");

-- CreateIndex
CREATE INDEX "idx_devices_drift_detected" ON "devices"("drift_detected");

-- CreateIndex
CREATE INDEX "idx_devices_credential_id" ON "devices"("credential_id");

-- CreateIndex
CREATE INDEX "idx_snapshots_device_version" ON "config_snapshots"("device_id", "version_number" DESC);

-- CreateIndex
CREATE INDEX "idx_snapshots_device_lkg" ON "config_snapshots"("device_id", "is_lkg");

-- CreateIndex
CREATE INDEX "idx_neighbor_links_device" ON "neighbor_links"("device_id");

-- CreateIndex
CREATE INDEX "idx_neighbor_links_remote" ON "neighbor_links"("remote_hostname");

-- CreateIndex
CREATE INDEX "idx_maintenance_windows_site" ON "maintenance_windows"("site");

-- CreateIndex
CREATE INDEX "idx_alerts_unack_id" ON "alerts"("acknowledged", "id" DESC);

-- CreateIndex
CREATE INDEX "idx_alerts_device_type" ON "alerts"("device_id", "alert_type");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_snapshots" ADD CONSTRAINT "config_snapshots_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighbor_links" ADD CONSTRAINT "neighbor_links_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

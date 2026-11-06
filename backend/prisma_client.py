"""
Prisma-Style Fluent ORM Client (`PrismaClient`) for NetGuardia.
Backed by SQLAlchemy 2.1 + psycopg3 (PostgreSQL) & SQLite (WAL mode) and aligned 1-to-1
with `prisma/schema.prisma`.

Key ORM Optimizations:
1. Eliminates N+1 queries via single-roundtrip `include` joins (`credential`, `lkg_snapshot`,
   `latest_snapshot`, `device`) and correlated `_count` projections.
2. Column projection / deferred heavy text columns (`omit_blobs=True`) when listing device tables.
3. Bulk DML (`create_many`, `update_many`, `delete_many`) using SQLAlchemy 2.0 core bulk statements.
4. Connection pooling (`QueuePool` with `pool_pre_ping=True` on PostgreSQL; WAL + NORMAL sync on SQLite).
5. Atomic ACID transaction scopes via `with prisma.tx() as tx:`.
"""

from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence
import os

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    delete,
    desc,
    event,
    func,
    insert,
    or_,
    select,
    update,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    aliased,
    joinedload,
    mapped_column,
    relationship,
    sessionmaker,
)

DEFAULT_SQLITE_PATH = Path(__file__).parent / "netguardia.db"
PRISMA_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "prisma" / "schema.prisma"


# ---------------------------------------------------------------------------
# Declarative Models (Mapped 1-to-1 with `prisma/schema.prisma`)
# ---------------------------------------------------------------------------


class Base(DeclarativeBase):
    pass


class CredentialModel(Base):
    __tablename__ = "credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    protocol: Mapped[str] = mapped_column(String, nullable=False, default="SSH")
    username: Mapped[str] = mapped_column(String, nullable=False)
    encrypted_password: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    encrypted_enable_secret: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    encrypted_ssh_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    encrypted_snmp_community: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_verified_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)

    devices: Mapped[List["DeviceModel"]] = relationship(
        "DeviceModel", back_populates="credential"
    )

    __table_args__ = (Index("idx_credentials_name", "name"),)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "protocol": self.protocol,
            "username": self.username,
            "encrypted_password": self.encrypted_password,
            "encrypted_enable_secret": self.encrypted_enable_secret,
            "encrypted_ssh_key": self.encrypted_ssh_key,
            "encrypted_snmp_community": self.encrypted_snmp_community,
            "description": self.description,
            "last_verified_at": self.last_verified_at,
            "created_at": self.created_at,
        }


class DeviceModel(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hostname: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    ip_address: Mapped[str] = mapped_column(String, nullable=False)
    ssh_port: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    vendor: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    os_type: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    site: Mapped[str] = mapped_column(String, nullable=False)
    credential_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("credentials.id", ondelete="SET NULL"), nullable=True
    )
    is_simulated: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String, nullable=False, default="online")
    drift_detected: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lkg_snapshot_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    latest_snapshot_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_backup_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    last_verified_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    simulated_running_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    simulated_neighbor_raw: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)

    credential: Mapped[Optional["CredentialModel"]] = relationship(
        "CredentialModel", back_populates="devices"
    )
    snapshots: Mapped[List["ConfigSnapshotModel"]] = relationship(
        "ConfigSnapshotModel",
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    neighbor_links: Mapped[List["NeighborLinkModel"]] = relationship(
        "NeighborLinkModel",
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    alerts: Mapped[List["AlertModel"]] = relationship(
        "AlertModel",
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_devices_site_hostname", "site", "hostname"),
        Index("idx_devices_drift_detected", "drift_detected"),
        Index("idx_devices_credential_id", "credential_id"),
    )

    def to_dict(self, omit_blobs: bool = False) -> Dict[str, Any]:
        data = {
            "id": self.id,
            "hostname": self.hostname,
            "ip_address": self.ip_address,
            "ssh_port": self.ssh_port,
            "vendor": self.vendor,
            "model": self.model,
            "os_type": self.os_type,
            "role": self.role,
            "site": self.site,
            "credential_id": self.credential_id,
            "is_simulated": self.is_simulated,
            "status": self.status,
            "drift_detected": self.drift_detected,
            "lkg_snapshot_id": self.lkg_snapshot_id,
            "latest_snapshot_id": self.latest_snapshot_id,
            "last_backup_at": self.last_backup_at,
            "last_verified_at": self.last_verified_at,
            "created_at": self.created_at,
        }
        if not omit_blobs:
            data["simulated_running_config"] = self.simulated_running_config
            data["simulated_neighbor_raw"] = self.simulated_neighbor_raw
        return data


class ConfigSnapshotModel(Base):
    __tablename__ = "config_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    config_text: Mapped[str] = mapped_column(Text, nullable=False)
    raw_hash: Mapped[str] = mapped_column(String, nullable=False)
    normalized_hash: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    collected_by: Mapped[str] = mapped_column(
        String, nullable=False, default="Scheduled Collector"
    )
    in_maintenance_window: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_lkg: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)

    device: Mapped["DeviceModel"] = relationship("DeviceModel", back_populates="snapshots")

    __table_args__ = (
        Index("idx_snapshots_device_version", "device_id", desc("version_number")),
        Index("idx_snapshots_device_lkg", "device_id", "is_lkg"),
    )

    def to_dict(self, include_text: bool = True) -> Dict[str, Any]:
        d = {
            "id": self.id,
            "device_id": self.device_id,
            "version_number": self.version_number,
            "raw_hash": self.raw_hash,
            "normalized_hash": self.normalized_hash,
            "size_bytes": self.size_bytes,
            "collected_by": self.collected_by,
            "in_maintenance_window": self.in_maintenance_window,
            "is_lkg": self.is_lkg,
            "notes": self.notes,
            "created_at": self.created_at,
        }
        if include_text:
            d["config_text"] = self.config_text
        return d


class NeighborLinkModel(Base):
    __tablename__ = "neighbor_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    local_port: Mapped[str] = mapped_column(String, nullable=False)
    remote_hostname: Mapped[str] = mapped_column(String, nullable=False)
    remote_port: Mapped[str] = mapped_column(String, nullable=False)
    remote_ip: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    remote_platform: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    protocol: Mapped[str] = mapped_column(String, nullable=False, default="LLDP")
    updated_at: Mapped[str] = mapped_column(String, nullable=False)

    device: Mapped["DeviceModel"] = relationship(
        "DeviceModel", back_populates="neighbor_links"
    )

    __table_args__ = (
        Index("idx_neighbor_links_device", "device_id"),
        Index("idx_neighbor_links_remote", "remote_hostname"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "device_id": self.device_id,
            "local_port": self.local_port,
            "remote_hostname": self.remote_hostname,
            "remote_port": self.remote_port,
            "remote_ip": self.remote_ip,
            "remote_platform": self.remote_platform,
            "protocol": self.protocol,
            "updated_at": self.updated_at,
        }


class MaintenanceWindowModel(Base):
    __tablename__ = "maintenance_windows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    site: Mapped[str] = mapped_column(String, nullable=False, default="ALL")
    day_of_week: Mapped[str] = mapped_column(String, nullable=False)
    start_time_utc: Mapped[str] = mapped_column(String, nullable=False)
    end_time_utc: Mapped[str] = mapped_column(String, nullable=False)
    is_active_override: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    auto_promote_lkg: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (Index("idx_maintenance_windows_site", "site"),)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "site": self.site,
            "day_of_week": self.day_of_week,
            "start_time_utc": self.start_time_utc,
            "end_time_utc": self.end_time_utc,
            "is_active_override": self.is_active_override,
            "auto_promote_lkg": self.auto_promote_lkg,
            "created_at": self.created_at,
        }


class AlertModel(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    snapshot_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    severity: Mapped[str] = mapped_column(String, nullable=False)
    alert_type: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    outside_maintenance_window: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1
    )
    added_lines: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    removed_lines: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    risk_categories: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    acknowledged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(String, nullable=False)

    device: Mapped["DeviceModel"] = relationship("DeviceModel", back_populates="alerts")

    __table_args__ = (
        Index("idx_alerts_unack_id", "acknowledged", desc("id")),
        Index("idx_alerts_device_type", "device_id", "alert_type"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "device_id": self.device_id,
            "snapshot_id": self.snapshot_id,
            "severity": self.severity,
            "alert_type": self.alert_type,
            "title": self.title,
            "message": self.message,
            "outside_maintenance_window": self.outside_maintenance_window,
            "added_lines": self.added_lines,
            "removed_lines": self.removed_lines,
            "risk_categories": self.risk_categories,
            "acknowledged": self.acknowledged,
            "created_at": self.created_at,
        }


class BackupSettingsModel(Base):
    __tablename__ = "backup_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    schedule_enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=360)
    cron_expression: Mapped[str] = mapped_column(
        String, nullable=False, default="0 */6 * * *"
    )
    noise_filter_enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    alert_on_out_of_window: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    stale_backup_threshold_days: Mapped[int] = mapped_column(
        Integer, nullable=False, default=7
    )
    webhook_url: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
        default="https://hooks.slack.com/services/T000/B000/NETGUARDIA-OPS",
    )
    notification_email: Mapped[Optional[str]] = mapped_column(
        String, nullable=True, default="netops-alerts@smallteam.io"
    )
    last_global_run_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    last_readiness_audit_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "schedule_enabled": self.schedule_enabled,
            "interval_minutes": self.interval_minutes,
            "cron_expression": self.cron_expression,
            "noise_filter_enabled": self.noise_filter_enabled,
            "alert_on_out_of_window": self.alert_on_out_of_window,
            "stale_backup_threshold_days": self.stale_backup_threshold_days,
            "webhook_url": self.webhook_url,
            "notification_email": self.notification_email,
            "last_global_run_at": self.last_global_run_at,
            "last_readiness_audit_at": self.last_readiness_audit_at,
        }


class ComplianceRuleModel(Base):
    __tablename__ = "compliance_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False, default="HIGH")
    vendor: Mapped[str] = mapped_column(String, nullable=False, default="ALL")
    pattern_type: Mapped[str] = mapped_column(
        String, nullable=False, default="must_contain"
    )
    pattern: Mapped[str] = mapped_column(Text, nullable=False)
    remediation_cli: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (Index("idx_compliance_rules_vendor", "vendor"),)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "rule_id": self.rule_id,
            "name": self.name,
            "description": self.description,
            "severity": self.severity,
            "vendor": self.vendor,
            "pattern_type": self.pattern_type,
            "pattern": self.pattern,
            "remediation_cli": self.remediation_cli,
            "enabled": self.enabled,
            "created_at": self.created_at,
        }


class AuditLogModel(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[str] = mapped_column(String, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False, default="INFO")
    actor: Mapped[str] = mapped_column(String, nullable=False, default="System / NetOps")
    target: Mapped[str] = mapped_column(String, nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_audit_logs_timestamp", desc("timestamp")),
        Index("idx_audit_logs_action", "action"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "action": self.action,
            "severity": self.severity,
            "actor": self.actor,
            "target": self.target,
            "details": self.details,
            "metadata_json": self.metadata_json,
        }



# ---------------------------------------------------------------------------
# Prisma Model Delegates
# ---------------------------------------------------------------------------


class DeviceDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def find_many(
        self,
        where: Optional[Dict[str, Any]] = None,
        include: Optional[Dict[str, bool]] = None,
        omit_blobs: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Single-query optimized fetch for devices.
        When `include={"credential": True, "lkg_snapshot": True, "latest_snapshot": True, "_count": True}`,
        executes a single SQL query with OUTER JOINs and correlated scalar subqueries (Zero N+1).
        """
        with self._client.session_scope() as session:
            if include and (
                include.get("lkg_snapshot")
                or include.get("latest_snapshot")
                or include.get("_count")
            ):
                LkgSnap = aliased(ConfigSnapshotModel, name="lkg_snap")
                LatSnap = aliased(ConfigSnapshotModel, name="lat_snap")

                snap_count_subq = (
                    select(func.count(ConfigSnapshotModel.id))
                    .where(ConfigSnapshotModel.device_id == DeviceModel.id)
                    .correlate(DeviceModel)
                    .scalar_subquery()
                )
                neigh_count_subq = (
                    select(func.count(NeighborLinkModel.id))
                    .where(NeighborLinkModel.device_id == DeviceModel.id)
                    .correlate(DeviceModel)
                    .scalar_subquery()
                )

                stmt = (
                    select(
                        DeviceModel,
                        CredentialModel,
                        LkgSnap.version_number.label("lkg_version"),
                        LkgSnap.normalized_hash.label("lkg_hash"),
                        LkgSnap.created_at.label("lkg_created_at"),
                        LatSnap.version_number.label("latest_version"),
                        LatSnap.normalized_hash.label("latest_hash"),
                        snap_count_subq.label("snapshot_count"),
                        neigh_count_subq.label("neighbor_count"),
                    )
                    .outerjoin(
                        CredentialModel,
                        DeviceModel.credential_id == CredentialModel.id,
                    )
                    .outerjoin(LkgSnap, DeviceModel.lkg_snapshot_id == LkgSnap.id)
                    .outerjoin(LatSnap, DeviceModel.latest_snapshot_id == LatSnap.id)
                )

                if where:
                    if "site" in where and where["site"]:
                        stmt = stmt.where(DeviceModel.site == where["site"])
                    if "credential_id" in where:
                        stmt = stmt.where(
                            DeviceModel.credential_id == where["credential_id"]
                        )

                stmt = stmt.order_by(DeviceModel.site.asc(), DeviceModel.hostname.asc())
                rows = session.execute(stmt).all()
                results: List[Dict[str, Any]] = []
                for row in rows:
                    dev_obj: DeviceModel = row[0]
                    cred_obj: Optional[CredentialModel] = row[1]
                    d = dev_obj.to_dict(omit_blobs=omit_blobs)
                    d["credential_name"] = cred_obj.name if cred_obj else None
                    d["credential_protocol"] = cred_obj.protocol if cred_obj else None
                    if include.get("credential_secrets") and cred_obj:
                        d["username"] = cred_obj.username
                        d["encrypted_password"] = cred_obj.encrypted_password
                        d["encrypted_ssh_key"] = cred_obj.encrypted_ssh_key
                    d["lkg_version"] = row.lkg_version
                    d["lkg_hash"] = row.lkg_hash
                    d["lkg_created_at"] = row.lkg_created_at
                    d["latest_version"] = row.latest_version
                    d["latest_hash"] = row.latest_hash
                    d["snapshot_count"] = row.snapshot_count or 0
                    d["neighbor_count"] = row.neighbor_count or 0
                    results.append(d)
                return results

            stmt_simple = select(DeviceModel)
            if include and include.get("credential"):
                stmt_simple = stmt_simple.options(joinedload(DeviceModel.credential))

            if where:
                if "site" in where and where["site"]:
                    stmt_simple = stmt_simple.where(DeviceModel.site == where["site"])
                if "credential_id" in where:
                    stmt_simple = stmt_simple.where(
                        DeviceModel.credential_id == where["credential_id"]
                    )

            stmt_simple = stmt_simple.order_by(
                DeviceModel.site.asc(), DeviceModel.hostname.asc()
            )
            devs = session.execute(stmt_simple).scalars().all()
            out: List[Dict[str, Any]] = []
            for dev in devs:
                item = dev.to_dict(omit_blobs=omit_blobs)
                if include and include.get("credential") and dev.credential:
                    item["credential_name"] = dev.credential.name
                    item["username"] = dev.credential.username
                    item["encrypted_password"] = dev.credential.encrypted_password
                    item["encrypted_ssh_key"] = dev.credential.encrypted_ssh_key
                out.append(item)
            return out

    def find_unique(
        self,
        where: Dict[str, Any],
        include: Optional[Dict[str, bool]] = None,
    ) -> Optional[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = select(DeviceModel)
            if include and include.get("credential"):
                stmt = stmt.options(joinedload(DeviceModel.credential))
            if "id" in where:
                stmt = stmt.where(DeviceModel.id == where["id"])
            elif "hostname" in where:
                stmt = stmt.where(DeviceModel.hostname == where["hostname"])
            else:
                return None

            dev = session.execute(stmt).scalars().first()
            if not dev:
                return None
            d = dev.to_dict(omit_blobs=False)
            if include and include.get("credential") and dev.credential:
                d["credential"] = dev.credential.to_dict()
            return d

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._client.session_scope() as session:
            obj = DeviceModel(**data)
            session.add(obj)
            session.flush()
            return obj.to_dict()

    def update(self, where: Dict[str, Any], data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = update(DeviceModel).where(DeviceModel.id == where["id"]).values(**data)
            session.execute(stmt)
            session.flush()
            updated = session.get(DeviceModel, where["id"])
            return updated.to_dict() if updated else None

    def delete(self, where: Dict[str, Any]) -> int:
        with self._client.session_scope() as session:
            stmt = delete(DeviceModel).where(DeviceModel.id == where["id"])
            res = session.execute(stmt)
            return res.rowcount or 0

    def count(self) -> int:
        with self._client.session_scope() as session:
            return session.scalar(select(func.count(DeviceModel.id))) or 0


class ConfigSnapshotDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def find_many(
        self,
        where: Optional[Dict[str, Any]] = None,
        include_text: bool = False,
    ) -> List[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = select(ConfigSnapshotModel)
            if where and "device_id" in where:
                stmt = stmt.where(ConfigSnapshotModel.device_id == where["device_id"])
            stmt = stmt.order_by(ConfigSnapshotModel.version_number.desc())
            rows = session.execute(stmt).scalars().all()
            return [r.to_dict(include_text=include_text) for r in rows]

    def find_unique(self, where: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not where or not where.get("id"):
            return None
        with self._client.session_scope() as session:
            stmt = select(ConfigSnapshotModel).where(ConfigSnapshotModel.id == where["id"])
            if "device_id" in where:
                stmt = stmt.where(ConfigSnapshotModel.device_id == where["device_id"])
            snap = session.execute(stmt).scalars().first()
            return snap.to_dict(include_text=True) if snap else None

    def next_version(self, device_id: int) -> int:
        with self._client.session_scope() as session:
            max_v = session.scalar(
                select(func.coalesce(func.max(ConfigSnapshotModel.version_number), 0)).where(
                    ConfigSnapshotModel.device_id == device_id
                )
            )
            return int(max_v or 0) + 1

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._client.session_scope() as session:
            obj = ConfigSnapshotModel(**data)
            session.add(obj)
            session.flush()
            return obj.to_dict(include_text=True)

    def update_many(self, where: Dict[str, Any], data: Dict[str, Any]) -> int:
        with self._client.session_scope() as session:
            stmt = update(ConfigSnapshotModel)
            if "device_id" in where:
                stmt = stmt.where(ConfigSnapshotModel.device_id == where["device_id"])
            if "id" in where:
                stmt = stmt.where(ConfigSnapshotModel.id == where["id"])
            res = session.execute(stmt.values(**data))
            return res.rowcount or 0


class NeighborLinkDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def find_many(self, where: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = select(NeighborLinkModel)
            if where:
                if "device_id" in where:
                    stmt = stmt.where(NeighborLinkModel.device_id == where["device_id"])
                if "device_ids" in where:
                    ids = where["device_ids"]
                    if not ids:
                        return []
                    stmt = stmt.where(NeighborLinkModel.device_id.in_(ids))
            rows = session.execute(stmt).scalars().all()
            return [r.to_dict() for r in rows]

    def create_many(self, data: Sequence[Dict[str, Any]]) -> int:
        """Bulk insert neighbor links in a single round-trip."""
        if not data:
            return 0
        with self._client.session_scope() as session:
            session.execute(insert(NeighborLinkModel), list(data))
            return len(data)

    def delete_many(self, where: Dict[str, Any]) -> int:
        with self._client.session_scope() as session:
            stmt = delete(NeighborLinkModel)
            if "device_id" in where:
                stmt = stmt.where(NeighborLinkModel.device_id == where["device_id"])
            res = session.execute(stmt)
            return res.rowcount or 0

    def count(self) -> int:
        with self._client.session_scope() as session:
            return session.scalar(select(func.count(NeighborLinkModel.id))) or 0


class MaintenanceWindowDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def find_many(self, where: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = select(MaintenanceWindowModel)
            if where and "site_in" in where:
                stmt = stmt.where(MaintenanceWindowModel.site.in_(where["site_in"]))
            stmt = stmt.order_by(MaintenanceWindowModel.id.asc())
            rows = session.execute(stmt).scalars().all()
            return [r.to_dict() for r in rows]

    def find_unique(self, where: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._client.session_scope() as session:
            obj = session.get(MaintenanceWindowModel, where["id"])
            return obj.to_dict() if obj else None

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._client.session_scope() as session:
            obj = MaintenanceWindowModel(**data)
            session.add(obj)
            session.flush()
            return obj.to_dict()

    def create_many(self, data: Sequence[Dict[str, Any]]) -> int:
        if not data:
            return 0
        with self._client.session_scope() as session:
            session.execute(insert(MaintenanceWindowModel), list(data))
            return len(data)

    def update(self, where: Dict[str, Any], data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._client.session_scope() as session:
            session.execute(
                update(MaintenanceWindowModel)
                .where(MaintenanceWindowModel.id == where["id"])
                .values(**data)
            )
            session.flush()
            obj = session.get(MaintenanceWindowModel, where["id"])
            return obj.to_dict() if obj else None

    def delete(self, where: Dict[str, Any]) -> int:
        with self._client.session_scope() as session:
            res = session.execute(
                delete(MaintenanceWindowModel).where(MaintenanceWindowModel.id == where["id"])
            )
            return res.rowcount or 0


class AlertDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def find_many(self, include_device: bool = True) -> List[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = select(AlertModel)
            if include_device:
                stmt = stmt.options(joinedload(AlertModel.device))
            stmt = stmt.order_by(AlertModel.acknowledged.asc(), AlertModel.id.desc())
            rows = session.execute(stmt).scalars().all()
            out: List[Dict[str, Any]] = []
            for r in rows:
                d = r.to_dict()
                if include_device and r.device:
                    d["hostname"] = r.device.hostname
                    d["ip_address"] = r.device.ip_address
                    d["vendor"] = r.device.vendor
                    d["site"] = r.device.site
                    d["role"] = r.device.role
                out.append(d)
            return out

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._client.session_scope() as session:
            obj = AlertModel(**data)
            session.add(obj)
            session.flush()
            return obj.to_dict()

    def update_many(self, where: Dict[str, Any], data: Dict[str, Any]) -> int:
        with self._client.session_scope() as session:
            stmt = update(AlertModel)
            if "id" in where:
                stmt = stmt.where(AlertModel.id == where["id"])
            if "device_id" in where:
                stmt = stmt.where(AlertModel.device_id == where["device_id"])
            if "alert_type" in where:
                stmt = stmt.where(AlertModel.alert_type == where["alert_type"])
            res = session.execute(stmt.values(**data))
            return res.rowcount or 0

    def count(self, where: Optional[Dict[str, Any]] = None) -> int:
        with self._client.session_scope() as session:
            stmt = select(func.count(AlertModel.id))
            if where and "acknowledged" in where:
                stmt = stmt.where(AlertModel.acknowledged == where["acknowledged"])
            return session.scalar(stmt) or 0


class CredentialDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def find_many(self, include_counts: bool = True) -> List[Dict[str, Any]]:
        with self._client.session_scope() as session:
            if include_counts:
                dev_count_subq = (
                    select(func.count(DeviceModel.id))
                    .where(DeviceModel.credential_id == CredentialModel.id)
                    .correlate(CredentialModel)
                    .scalar_subquery()
                )
                stmt = select(
                    CredentialModel,
                    dev_count_subq.label("assigned_devices_count"),
                ).order_by(CredentialModel.id.asc())
                rows = session.execute(stmt).all()
                out: List[Dict[str, Any]] = []
                for cred_obj, cnt in rows:
                    item = cred_obj.to_dict()
                    item["assigned_devices_count"] = cnt or 0
                    out.append(item)
                return out

            rows_simple = (
                session.execute(select(CredentialModel).order_by(CredentialModel.id.asc()))
                .scalars()
                .all()
            )
            return [r.to_dict() for r in rows_simple]

    def find_unique(self, where: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not where or not where.get("id"):
            return None
        with self._client.session_scope() as session:
            obj = session.get(CredentialModel, where["id"])
            return obj.to_dict() if obj else None

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._client.session_scope() as session:
            obj = CredentialModel(**data)
            session.add(obj)
            session.flush()
            return obj.to_dict()

    def create_many(self, data: Sequence[Dict[str, Any]]) -> int:
        if not data:
            return 0
        with self._client.session_scope() as session:
            session.execute(insert(CredentialModel), list(data))
            return len(data)

    def update(self, where: Dict[str, Any], data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._client.session_scope() as session:
            session.execute(
                update(CredentialModel)
                .where(CredentialModel.id == where["id"])
                .values(**data)
            )
            session.flush()
            obj = session.get(CredentialModel, where["id"])
            return obj.to_dict() if obj else None

    def delete(self, where: Dict[str, Any]) -> int:
        with self._client.session_scope() as session:
            res = session.execute(
                delete(CredentialModel).where(CredentialModel.id == where["id"])
            )
            return res.rowcount or 0


class BackupSettingsDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def find_unique(self, where: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        target_id = (where or {}).get("id", 1)
        with self._client.session_scope() as session:
            obj = session.get(BackupSettingsModel, target_id)
            return obj.to_dict() if obj else None

    def upsert(self, data: Dict[str, Any]) -> Dict[str, Any]:
        target_id = data.get("id", 1)
        with self._client.session_scope() as session:
            existing = session.get(BackupSettingsModel, target_id)
            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
                session.flush()
                return existing.to_dict()
            obj = BackupSettingsModel(**data)
            session.add(obj)
            session.flush()
            return obj.to_dict()

    def update(self, data: Dict[str, Any], target_id: int = 1) -> Optional[Dict[str, Any]]:
        with self._client.session_scope() as session:
            session.execute(
                update(BackupSettingsModel)
                .where(BackupSettingsModel.id == target_id)
                .values(**data)
            )
            session.flush()
            obj = session.get(BackupSettingsModel, target_id)
            return obj.to_dict() if obj else None


class ComplianceRuleDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def find_many(self, where: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = select(ComplianceRuleModel).order_by(ComplianceRuleModel.id)
            if where:
                if "vendor" in where and where["vendor"]:
                    stmt = stmt.where(
                        or_(
                            ComplianceRuleModel.vendor == where["vendor"],
                            ComplianceRuleModel.vendor == "ALL",
                        )
                    )
                if "enabled" in where:
                    stmt = stmt.where(ComplianceRuleModel.enabled == where["enabled"])
            rows = session.scalars(stmt).all()
            return [r.to_dict() for r in rows]

    def find_unique(self, where: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = select(ComplianceRuleModel)
            if "id" in where:
                stmt = stmt.where(ComplianceRuleModel.id == where["id"])
            elif "rule_id" in where:
                stmt = stmt.where(ComplianceRuleModel.rule_id == where["rule_id"])
            obj = session.scalars(stmt).first()
            return obj.to_dict() if obj else None

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._client.session_scope() as session:
            obj = ComplianceRuleModel(**data)
            session.add(obj)
            session.flush()
            return obj.to_dict()

    def create_many(self, data_list: Sequence[Dict[str, Any]]) -> int:
        if not data_list:
            return 0
        with self._client.session_scope() as session:
            session.execute(insert(ComplianceRuleModel), list(data_list))
            session.flush()
            return len(data_list)

    def delete(self, where: Dict[str, Any]) -> int:
        with self._client.session_scope() as session:
            stmt = delete(ComplianceRuleModel)
            if "id" in where:
                stmt = stmt.where(ComplianceRuleModel.id == where["id"])
            elif "rule_id" in where:
                stmt = stmt.where(ComplianceRuleModel.rule_id == where["rule_id"])
            res = session.execute(stmt)
            return res.rowcount or 0

    def count(self) -> int:
        with self._client.session_scope() as session:
            return session.scalar(select(func.count(ComplianceRuleModel.id))) or 0


class AuditLogDelegate:
    def __init__(self, client: "PrismaClient"):
        self._client = client

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._client.session_scope() as session:
            obj = AuditLogModel(**data)
            session.add(obj)
            session.flush()
            return obj.to_dict()

    def find_many(
        self,
        where: Optional[Dict[str, Any]] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        with self._client.session_scope() as session:
            stmt = select(AuditLogModel).order_by(
                desc(AuditLogModel.timestamp), desc(AuditLogModel.id)
            )
            if where:
                if "action" in where and where["action"]:
                    stmt = stmt.where(AuditLogModel.action == where["action"])
                if "severity" in where and where["severity"]:
                    stmt = stmt.where(AuditLogModel.severity == where["severity"])
            if limit:
                stmt = stmt.limit(limit)
            rows = session.scalars(stmt).all()
            return [r.to_dict() for r in rows]

    def count(self) -> int:
        with self._client.session_scope() as session:
            return session.scalar(select(func.count(AuditLogModel.id))) or 0


# ---------------------------------------------------------------------------
# PrismaClient Main Class
# ---------------------------------------------------------------------------


def _normalize_sqlalchemy_url(raw_url: str, sqlite_path: Optional[Path] = None) -> str:
    url = (raw_url or "").strip()
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("sqlite:///"):
        return url
    target = (sqlite_path or DEFAULT_SQLITE_PATH).resolve()
    return f"sqlite:///{target.as_posix()}"


class PrismaClient:
    """
    Fluent Prisma ORM Client supporting both PostgreSQL (`postgresql+psycopg://`)
    and local SQLite (`sqlite:///`) with connection pooling, WAL concurrency, and
    atomic `with prisma.tx():` transaction blocks.
    """

    def __init__(self, database_url: Optional[str] = None, sqlite_path: Optional[Path] = None):
        self._sqlite_path = sqlite_path or DEFAULT_SQLITE_PATH
        self._raw_env_url = database_url if database_url is not None else os.environ.get("DATABASE_URL", "")
        self.engine: Engine = self._build_engine()
        self._SessionFactory = sessionmaker(bind=self.engine, expire_on_commit=False)
        self._active_tx_session: Optional[Session] = None

        # Register Model Delegates
        self.device = DeviceDelegate(self)
        self.config_snapshot = ConfigSnapshotDelegate(self)
        self.neighbor_link = NeighborLinkDelegate(self)
        self.maintenance_window = MaintenanceWindowDelegate(self)
        self.alert = AlertDelegate(self)
        self.credential = CredentialDelegate(self)
        self.backup_settings = BackupSettingsDelegate(self)
        self.compliance_rule = ComplianceRuleDelegate(self)
        self.audit_log = AuditLogDelegate(self)


    def _build_engine(self) -> Engine:
        raw_url = os.environ.get("DATABASE_URL", "") if self._raw_env_url == "" else self._raw_env_url
        sa_url = _normalize_sqlalchemy_url(raw_url, self._sqlite_path)

        if sa_url.startswith("postgresql+psycopg://"):
            return create_engine(
                sa_url,
                pool_size=10,
                max_overflow=20,
                pool_pre_ping=True,
                pool_recycle=1800,
                future=True,
            )

        engine = create_engine(
            sa_url,
            connect_args={"check_same_thread": False},
            future=True,
        )

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON;")
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
            cursor.close()

        return engine

    def refresh_engine_if_env_changed(self) -> None:
        current_env = os.environ.get("DATABASE_URL", "")
        if current_env != self._raw_env_url:
            self.engine.dispose()
            self._raw_env_url = current_env
            self.engine = self._build_engine()
            self._SessionFactory = sessionmaker(bind=self.engine, expire_on_commit=False)

    @contextmanager
    def session_scope(self) -> Iterator[Session]:
        """
        Reuse the active transaction session if inside `with prisma.tx():`,
        otherwise open a short-lived pooled session and commit automatically.
        """
        if self._active_tx_session is not None:
            yield self._active_tx_session
            return

        session = self._SessionFactory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    @contextmanager
    def tx(self) -> Iterator["PrismaClient"]:
        """
        Execute multiple Prisma delegate calls inside a single atomic ACID transaction.
        Nested `with prisma.tx():` calls join the outer transaction seamlessly.
        """
        if self._active_tx_session is not None:
            yield self
            return

        session = self._SessionFactory()
        self._active_tx_session = session
        try:
            yield self
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            self._active_tx_session = None
            session.close()

    def create_schema(self) -> None:
        Base.metadata.create_all(self.engine)

    def reset_schema(self) -> None:
        self.engine.dispose()
        if str(self.engine.url).startswith("sqlite"):
            for suffix in ("", "-wal", "-shm"):
                p = Path(str(self._sqlite_path) + suffix)
                if p.exists():
                    try:
                        p.unlink()
                    except OSError:
                        pass
            self.engine = self._build_engine()
            self._SessionFactory = sessionmaker(bind=self.engine, expire_on_commit=False)
            Base.metadata.create_all(self.engine)
        else:
            Base.metadata.drop_all(self.engine)
            Base.metadata.create_all(self.engine)


# Singleton Prisma ORM Client
prisma = PrismaClient()

"""
FastAPI Backend for NetGuardia — Network Configuration Backup & Topology Automator for Small IT Teams.
Powered by the Prisma ORM Client (`backend/prisma_client.py` & `prisma/schema.prisma`)
for zero-N+1 relational queries, bulk DML, and atomic transactions across PostgreSQL & SQLite.
"""

import io
import json
import re
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path as _Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from collectors import (
    DRIFT_SCENARIOS,
    apply_simulated_drift_to_config,
    collect_from_real_device,
    refresh_simulated_volatile_headers,
    verify_ssh_connectivity,
)
from compliance_engine import (
    BUILTIN_COMPLIANCE_RULES,
    evaluate_rule_against_config,
    scan_device_compliance,
)
from database import (
    get_database_engine_info,
    init_db,
    reset_all_tables,
    test_postgres_connection,
)
from diff_engine import compare_configs, compute_config_hashes
from prisma_client import prisma
from topology_engine import (
    analyze_blast_radius,
    build_topology_graph,
    parse_neighbor_cli_output,
)
from vault import decrypt_secret, encrypt_secret, mask_secret


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="NetGuardia — Network Configuration Backup & Topology Automator",
    description="Scheduled multi-vendor config backup, noise-filtered LKG diff engine, LLDP/CDP topology mapper with blast-radius dependency view, and out-of-window drift alerting for small IT teams.",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------


class CredentialCreate(BaseModel):
    name: str
    protocol: str = "SSH"
    username: str
    password: Optional[str] = None
    enable_secret: Optional[str] = None
    ssh_private_key: Optional[str] = None
    snmp_community: Optional[str] = None
    description: Optional[str] = ""


class DeviceCreate(BaseModel):
    hostname: str
    ip_address: str
    ssh_port: int = 22
    vendor: str = "Cisco"
    model: str = "Catalyst C9300-24T"
    os_type: str = "Cisco IOS-XE 17.9"
    role: str = "Access Switch"
    site: str = "HQ-Campus (Austin)"
    credential_id: Optional[int] = 1
    is_simulated: bool = True
    uplink_hostname: Optional[str] = "hq-dist-sw01"
    uplink_local_port: Optional[str] = "GigabitEthernet1/0/24"
    uplink_remote_port: Optional[str] = "GigabitEthernet1/0/10"


class SimulateDriftRequest(BaseModel):
    scenario: str = "rogue_acl"


class MaintenanceWindowCreate(BaseModel):
    name: str
    site: str = "ALL"
    day_of_week: str = "Sunday"
    start_time_utc: str = "02:00"
    end_time_utc: str = "04:00"
    is_active_override: bool = False
    auto_promote_lkg: bool = True


class BackupSettingsUpdate(BaseModel):
    schedule_enabled: bool = True
    interval_minutes: int = 360
    cron_expression: str = "0 */6 * * *"
    noise_filter_enabled: bool = True
    alert_on_out_of_window: bool = True
    stale_backup_threshold_days: int = 7
    webhook_url: str = ""
    notification_email: str = ""


class ParseNeighborRequest(BaseModel):
    raw_output: str
    vendor: Optional[str] = "Cisco"
    attach_to_device_id: Optional[int] = None


class PostgresTestRequest(BaseModel):
    dsn: str


class ComplianceRuleCreate(BaseModel):
    rule_id: str
    name: str
    description: str
    severity: str = "HIGH"
    vendor: str = "ALL"
    pattern_type: str = "must_contain"
    pattern: str
    remediation_cli: str
    enabled: bool = True


class AuditLogRecordRequest(BaseModel):
    action: str
    severity: str = "INFO"
    actor: str = "NetOps Admin"
    target: str
    details: str
    metadata: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Helper Functions (Powered by Prisma ORM Delegates)
# ---------------------------------------------------------------------------


def log_audit_event(
    action: str,
    severity: str,
    target: str,
    details: str,
    actor: str = "NetOps Admin",
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Record an operational audit log entry into the Prisma datastore."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        prisma.audit_log.create(
            {
                "timestamp": now_iso,
                "action": action,
                "severity": severity,
                "actor": actor,
                "target": target,
                "details": details,
                "metadata_json": json.dumps(metadata) if metadata else None,
            }
        )
    except Exception as exc:
        print(f"Warning: Failed to persist audit log: {exc}")



def _age_days(iso_ts: Optional[str]) -> float:
    if not iso_ts:
        return 999.0
    try:
        dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return max(0.0, round(delta.total_seconds() / 86400.0, 2))
    except Exception:
        return 999.0


def _is_in_maintenance_window(site: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
    windows = prisma.maintenance_window.find_many(where={"site_in": ["ALL", site]})
    now = datetime.now(timezone.utc)
    current_day = now.strftime("%A")
    current_hm = now.strftime("%H:%M")

    for w in windows:
        if w["is_active_override"]:
            return True, w
        if w["day_of_week"].lower() in ("daily", "everyday", current_day.lower()):
            if w["start_time_utc"] <= current_hm <= w["end_time_utc"]:
                return True, w
    return False, None


def _execute_device_backup(
    device_id: int,
    triggered_by: str = "Manual Verification",
) -> Dict[str, Any]:
    """
    Collect device configuration & LLDP/CDP neighbors, compute normalized SHA-256 hash,
    and persist snapshot + neighbor links + drift alerts inside an atomic `prisma.tx()` block.
    """
    device = prisma.device.find_unique(
        where={"id": device_id},
        include={"credential": True},
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    cred = None
    raw_cred = device.get("credential")
    if raw_cred:
        cred = {
            "id": raw_cred["id"],
            "username": raw_cred["username"],
            "password": decrypt_secret(raw_cred.get("encrypted_password")),
            "enable_secret": decrypt_secret(raw_cred.get("encrypted_enable_secret")),
            "ssh_private_key": decrypt_secret(raw_cred.get("encrypted_ssh_key")),
            "snmp_community": decrypt_secret(raw_cred.get("encrypted_snmp_community")),
        }

    now_iso = datetime.now(timezone.utc).isoformat()
    in_window, active_window = _is_in_maintenance_window(device["site"])

    if device["is_simulated"]:
        base_cfg = device.get("simulated_running_config") or ""
        collected_cfg = refresh_simulated_volatile_headers(base_cfg, device["vendor"])
        raw_neighbors = device.get("simulated_neighbor_raw") or ""
        parsed_neighbors = parse_neighbor_cli_output(raw_neighbors, device["vendor"])
    else:
        if not cred:
            raise HTTPException(
                status_code=400,
                detail=f"Device {device['hostname']} requires a Vault Credential for live SSH collection.",
            )
        try:
            collected_cfg, parsed_neighbors, raw_neighbors = collect_from_real_device(
                device, cred
            )
        except Exception as exc:
            prisma.device.update(where={"id": device_id}, data={"status": "unreachable"})
            raise HTTPException(
                status_code=502,
                detail=f"SSH collection failed on {device['hostname']} ({device['ip_address']}): {exc}",
            )

    raw_hash, norm_hash = compute_config_hashes(collected_cfg)

    with prisma.tx():
        lkg_row = (
            prisma.config_snapshot.find_unique(where={"id": device["lkg_snapshot_id"]})
            if device.get("lkg_snapshot_id")
            else None
        )
        next_version = prisma.config_snapshot.next_version(device_id)

        is_lkg = 0
        drift_detected = 0
        alert_created = None

        if not lkg_row:
            is_lkg = 1
            notes = f"Initial baseline LKG snapshot via {triggered_by}"
        else:
            lkg_norm_hash = lkg_row["normalized_hash"]
            if norm_hash == lkg_norm_hash:
                drift_detected = 0
                notes = f"Verified clean against LKG (volatile noise filtered) via {triggered_by}"
            else:
                if in_window and active_window and active_window.get("auto_promote_lkg"):
                    is_lkg = 1
                    drift_detected = 0
                    notes = f"Authorized change during '{active_window['name']}' — auto-promoted to LKG"
                    prisma.config_snapshot.update_many(
                        where={"device_id": device_id},
                        data={"is_lkg": 0},
                    )
                else:
                    drift_detected = 1
                    notes = f"Out-of-window configuration drift detected via {triggered_by}"

        new_snap = prisma.config_snapshot.create(
            {
                "device_id": device_id,
                "version_number": next_version,
                "config_text": collected_cfg,
                "raw_hash": raw_hash,
                "normalized_hash": norm_hash,
                "size_bytes": len(collected_cfg.encode("utf-8")),
                "collected_by": triggered_by,
                "in_maintenance_window": 1 if in_window else 0,
                "is_lkg": is_lkg,
                "notes": notes,
                "created_at": now_iso,
            }
        )
        new_snap_id = new_snap["id"]
        new_lkg_id = (
            new_snap_id if is_lkg else (device.get("lkg_snapshot_id") or new_snap_id)
        )

        prisma.device.update(
            where={"id": device_id},
            data={
                "status": "online",
                "drift_detected": drift_detected,
                "lkg_snapshot_id": new_lkg_id,
                "latest_snapshot_id": new_snap_id,
                "last_backup_at": now_iso,
                "last_verified_at": now_iso,
                "simulated_running_config": collected_cfg,
            },
        )

        # Replace LLDP/CDP neighbor links using bulk DML (`delete_many` + `create_many`)
        if parsed_neighbors:
            prisma.neighbor_link.delete_many(where={"device_id": device_id})
            prisma.neighbor_link.create_many(
                [
                    {
                        "device_id": device_id,
                        "local_port": n["local_port"],
                        "remote_hostname": n["remote_hostname"],
                        "remote_port": n["remote_port"],
                        "remote_ip": n.get("remote_ip", ""),
                        "remote_platform": n.get("remote_platform", ""),
                        "protocol": n["protocol"],
                        "updated_at": now_iso,
                    }
                    for n in parsed_neighbors
                ]
            )

        # Auto-resolve STALE_BACKUP alerts for this device
        prisma.alert.update_many(
            where={"device_id": device_id, "alert_type": "STALE_BACKUP"},
            data={"acknowledged": 1},
        )

        if drift_detected and lkg_row:
            diff_res = compare_configs(
                lkg_row["config_text"],
                collected_cfg,
                vendor=device["vendor"],
                ignore_noise=True,
            )
            categories = sorted({r["category"] for r in diff_res["risk_findings"]})
            severity = (
                diff_res["highest_severity"]
                if diff_res["highest_severity"] != "NONE"
                else "WARNING"
            )
            title = (
                f"Out-of-Window Config Drift on {device['hostname']} "
                f"(+{diff_res['added_count']} / -{diff_res['removed_count']} lines)"
            )
            msg = (
                f"Configuration change detected on {device['hostname']} ({device['ip_address']}) in {device['site']} "
                f"outside scheduled maintenance windows. "
                + (
                    f"Risk areas affected: {', '.join(categories)}."
                    if categories
                    else "Review diff against LKG."
                )
            )
            created_alert = prisma.alert.create(
                {
                    "device_id": device_id,
                    "snapshot_id": new_snap_id,
                    "severity": severity,
                    "alert_type": "OUT_OF_WINDOW_DRIFT",
                    "title": title,
                    "message": msg,
                    "outside_maintenance_window": 1,
                    "added_lines": diff_res["added_count"],
                    "removed_lines": diff_res["removed_count"],
                    "risk_categories": json.dumps(categories),
                    "acknowledged": 0,
                    "created_at": now_iso,
                }
            )
            alert_created = {
                "id": created_alert["id"],
                "severity": severity,
                "title": title,
                "message": msg,
            }

    # Record operational audit event
    if drift_detected:
        log_audit_event(
            action="DRIFT_DETECTED",
            severity="WARNING",
            target=device["hostname"],
            details=f"Drift detected on {device['hostname']}: normalized hash differs from LKG.",
            actor=triggered_by,
            metadata={"version": next_version, "in_window": in_window},
        )
    elif is_lkg:
        log_audit_event(
            action="LKG_PROMOTED",
            severity="INFO",
            target=device["hostname"],
            details=f"Snapshot v{next_version} on {device['hostname']} established as Last-Known-Good baseline ({notes}).",
            actor=triggered_by,
            metadata={"version": next_version},
        )
    else:
        log_audit_event(
            action="BACKUP_RUN",
            severity="SUCCESS",
            target=device["hostname"],
            details=f"Backup completed clean on {device['hostname']}; matched LKG baseline via {triggered_by}.",
            actor=triggered_by,
            metadata={"version": next_version},
        )

    return {
        "device_id": device_id,
        "hostname": device["hostname"],
        "snapshot_id": new_snap_id,
        "version_number": next_version,
        "raw_hash": raw_hash,
        "normalized_hash": norm_hash,
        "in_maintenance_window": in_window,
        "drift_detected": bool(drift_detected),
        "promoted_to_lkg": bool(is_lkg),
        "neighbors_discovered": len(parsed_neighbors),
        "alert_created": alert_created,
        "timestamp": now_iso,
    }


# ---------------------------------------------------------------------------
# API Endpoints (Powered by Prisma ORM)
# ---------------------------------------------------------------------------


@app.get("/api/overview")
def get_overview():
    settings = prisma.backup_settings.find_unique({"id": 1}) or {}
    stale_days_limit = settings.get("stale_backup_threshold_days", 7)

    devices = prisma.device.find_many(omit_blobs=True)
    unack_alerts = prisma.alert.count(where={"acknowledged": 0})
    total_neighbor_links = prisma.neighbor_link.count()

    sites = sorted({d["site"] for d in devices})
    total_devices = len(devices)
    online_devices = sum(1 for d in devices if d["status"] == "online")
    drifted_devices = sum(1 for d in devices if d["drift_detected"])
    stale_devices = sum(
        1 for d in devices if _age_days(d.get("last_backup_at")) > stale_days_limit
    )
    verified_clean_devices = sum(
        1
        for d in devices
        if not d["drift_detected"]
        and _age_days(d.get("last_backup_at")) <= stale_days_limit
    )

    readiness_score = (
        round((verified_clean_devices / total_devices) * 100)
        if total_devices > 0
        else 100
    )

    site_count = len(sites)
    if site_count <= 1 and total_devices <= 50:
        recommended_plan = "Single-Site Plan"
        monthly_price = 149
        price_band = "$99–$199/mo (up to 50 devices)"
    else:
        recommended_plan = "Multi-Site Plan"
        monthly_price = 349
        price_band = "$299–$499/mo (multi-site / up to 200 devices)"

    estimated_manual_hours_saved_per_month = round(total_devices * 1.4, 1)
    estimated_downtime_risk_avoided_usd = total_devices * 1250

    return {
        "total_devices": total_devices,
        "online_devices": online_devices,
        "sites": sites,
        "site_count": site_count,
        "verified_clean_devices": verified_clean_devices,
        "drifted_devices": drifted_devices,
        "stale_devices": stale_devices,
        "unacknowledged_alerts": unack_alerts,
        "total_neighbor_links": total_neighbor_links,
        "readiness_score": readiness_score,
        "last_global_run_at": settings.get("last_global_run_at"),
        "last_readiness_audit_at": settings.get("last_readiness_audit_at"),
        "stale_backup_threshold_days": stale_days_limit,
        "database": get_database_engine_info(),
        "saas_roi": {
            "recommended_plan": recommended_plan,
            "monthly_price_usd": monthly_price,
            "price_band": price_band,
            "manual_hours_saved_monthly": estimated_manual_hours_saved_per_month,
            "downtime_cost_avoided_usd": estimated_downtime_risk_avoided_usd,
        },
    }


@app.post("/api/verify-fleet-readiness")
def verify_fleet_readiness():
    """
    Answers the key validation question:
    'When did you last verify that your network config backup actually ran?'
    Uses Prisma eager-loading (`include={"credential": True}`) to avoid N+1 credential queries.
    """
    settings = prisma.backup_settings.find_unique({"id": 1}) or {}
    stale_limit = settings.get("stale_backup_threshold_days", 7)

    rows = prisma.device.find_many(include={"credential": True}, omit_blobs=True)
    now_iso = datetime.now(timezone.utc).isoformat()
    results = []

    with prisma.tx():
        for d in rows:
            conn_check = verify_ssh_connectivity(
                ip_address=d["ip_address"],
                port=d["ssh_port"],
                username=d.get("username") or "",
                password=decrypt_secret(d.get("encrypted_password")),
                ssh_private_key=decrypt_secret(d.get("encrypted_ssh_key")),
                is_simulated=bool(d["is_simulated"]),
            )
            age_d = _age_days(d.get("last_backup_at"))
            is_fresh = age_d <= stale_limit
            has_lkg = bool(d.get("lkg_snapshot_id"))
            has_drift = bool(d.get("drift_detected"))

            status_label = "READY"
            if not conn_check["authenticated"]:
                status_label = "AUTH_FAILED"
            elif not has_lkg or not is_fresh:
                status_label = "STALE_BACKUP"
            elif has_drift:
                status_label = "DRIFT_UNVERIFIED"

            prisma.device.update(
                where={"id": d["id"]},
                data={"last_verified_at": now_iso},
            )
            results.append(
                {
                    "device_id": d["id"],
                    "hostname": d["hostname"],
                    "site": d["site"],
                    "vendor": d["vendor"],
                    "credential_name": d.get("credential_name") or "Unassigned",
                    "ssh_verified": conn_check["authenticated"],
                    "latency_ms": conn_check["latency_ms"],
                    "backup_age_days": age_d,
                    "is_backup_fresh": is_fresh,
                    "has_lkg": has_lkg,
                    "drift_detected": has_drift,
                    "readiness_status": status_label,
                    "detail": conn_check["message"],
                }
            )

        prisma.backup_settings.update({"last_readiness_audit_at": now_iso})

    ready_count = sum(1 for r in results if r["readiness_status"] == "READY")
    return {
        "audited_at": now_iso,
        "total_devices": len(results),
        "ready_devices": ready_count,
        "readiness_percentage": round((ready_count / len(results)) * 100)
        if results
        else 100,
        "results": results,
    }


@app.get("/api/devices")
def list_devices():
    """
    List all devices using Prisma single-query eager-load (`include` + `_count`)
    and `omit_blobs=True` so large running-config texts are not loaded unnecessarily.
    """
    settings = prisma.backup_settings.find_unique({"id": 1}) or {}
    stale_limit = settings.get("stale_backup_threshold_days", 7)

    raw_devices = prisma.device.find_many(
        include={
            "credential": True,
            "lkg_snapshot": True,
            "latest_snapshot": True,
            "_count": True,
        },
        omit_blobs=True,
    )

    devices = []
    for item in raw_devices:
        age_d = _age_days(item.get("last_backup_at"))
        item["backup_age_days"] = age_d
        item["is_stale"] = age_d > stale_limit
        item["is_simulated"] = bool(item["is_simulated"])
        item["drift_detected"] = bool(item["drift_detected"])
        devices.append(item)

    return devices


@app.post("/api/devices")
def create_device(payload: DeviceCreate):
    now_iso = datetime.now(timezone.utc).isoformat()
    v = payload.vendor.lower()
    uplink_host = payload.uplink_hostname or "hq-core-sw01"
    local_p = payload.uplink_local_port or "GigabitEthernet1/0/24"
    remote_p = payload.uplink_remote_port or "GigabitEthernet1/0/15"

    if "juniper" in v:
        sim_cfg = f"""## Last commit: {now_iso} by netops
set version 22.4R3
set system host-name {payload.hostname}
set system services ssh root-login deny
set interfaces {local_p} description "UPLINK-TO-{uplink_host.upper()}"
set protocols lldp interface all
set vlans CORP_WORKSTATIONS vlan-id 10"""
        sim_neigh = f"""Local Interface    Parent Interface    Chassis Id          Port info          System Name
{local_p:<18} -                   00:1c:73:aa:bb:cc   {remote_p:<18} {uplink_host}"""
    elif "ubiquiti" in v:
        sim_cfg = f"""# generated by EdgeOS v2.0.9 at {now_iso}
set system host-name {payload.hostname}
set interfaces switch switch0 description '{payload.site} {payload.role}'
set service lldp interface all
set service ssh port {payload.ssh_port}"""
        sim_neigh = f"""-------------------------------------------------------------------------------
Interface:    {local_p}, via: LLDP, RID: 1, Time: 1 day, 00:10:00
  Chassis:
    SysName:      {uplink_host}
    SysDescr:     Managed Switch
  Port:
    PortID:       ifname {remote_p}"""
    else:
        sim_cfg = f"""! Last configuration change at {now_iso} by netops
version 17.9
service password-encryption
hostname {payload.hostname}
!
interface {local_p}
 description UPLINK-TO-{uplink_host.upper()}
 switchport mode trunk
!
snmp-server community NetGuard_RO_v2c RO
line vty 0 4
 transport input ssh
end"""
        sim_neigh = f"""-------------------------
Device ID: {uplink_host}.corp.local
Entry address(es):
  IP address: 10.10.1.1
Platform: Cisco Switch,  Capabilities: Switch
Interface: {local_p},  Port ID (outgoing port): {remote_p}"""

    try:
        created = prisma.device.create(
            {
                "hostname": payload.hostname.strip(),
                "ip_address": payload.ip_address.strip(),
                "ssh_port": payload.ssh_port,
                "vendor": payload.vendor,
                "model": payload.model,
                "os_type": payload.os_type,
                "role": payload.role,
                "site": payload.site,
                "credential_id": payload.credential_id,
                "is_simulated": 1 if payload.is_simulated else 0,
                "status": "online",
                "drift_detected": 0,
                "simulated_running_config": sim_cfg,
                "simulated_neighbor_raw": sim_neigh,
                "created_at": now_iso,
            }
        )
        new_id = created["id"]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not create device: {exc}")

    if payload.is_simulated:
        _execute_device_backup(new_id, triggered_by="Initial Onboarding Collector")

    return {"id": new_id, "hostname": payload.hostname, "status": "created"}


@app.delete("/api/devices/{device_id}")
def delete_device(device_id: int):
    prisma.device.delete(where={"id": device_id})
    return {"deleted": device_id}


@app.post("/api/devices/{device_id}/backup")
def backup_single_device(device_id: int):
    return _execute_device_backup(device_id, triggered_by="On-Demand Collector")


@app.post("/api/backups/run-all")
def run_all_backups():
    devices = prisma.device.find_many(omit_blobs=True)
    results = []
    for d in devices:
        try:
            res = _execute_device_backup(
                d["id"], triggered_by="Scheduled Fleet Collector"
            )
            results.append(res)
        except Exception as exc:
            results.append({"device_id": d["id"], "error": str(exc)})

    now_iso = datetime.now(timezone.utc).isoformat()
    prisma.backup_settings.update({"last_global_run_at": now_iso})

    return {
        "ran_at": now_iso,
        "total_processed": len(results),
        "drifted_count": sum(1 for r in results if r.get("drift_detected")),
        "results": results,
    }


@app.get("/api/drift-scenarios")
def get_drift_scenarios():
    return DRIFT_SCENARIOS


@app.post("/api/devices/{device_id}/simulate-drift")
def simulate_device_drift(device_id: int, payload: SimulateDriftRequest):
    dev = prisma.device.find_unique(where={"id": device_id})
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    base_cfg = dev.get("simulated_running_config") or ""
    mutated_cfg, summary = apply_simulated_drift_to_config(
        base_cfg, dev["vendor"], payload.scenario
    )
    prisma.device.update(
        where={"id": device_id},
        data={"simulated_running_config": mutated_cfg, "is_simulated": 1},
    )

    backup_result = _execute_device_backup(
        device_id, triggered_by=f"Drift Detector ({payload.scenario})"
    )
    return {
        "scenario": payload.scenario,
        "summary": summary,
        "backup_result": backup_result,
    }


@app.get("/api/devices/{device_id}/snapshots")
def get_device_snapshots(device_id: int):
    return prisma.config_snapshot.find_many(
        where={"device_id": device_id},
        include_text=False,
    )


@app.get("/api/devices/{device_id}/diff")
def get_device_diff(
    device_id: int,
    base_snapshot_id: Optional[int] = Query(None),
    target_snapshot_id: Optional[int] = Query(None),
    ignore_noise: bool = Query(True),
):
    device = prisma.device.find_unique(where={"id": device_id})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    base_id = base_snapshot_id or device.get("lkg_snapshot_id")
    target_id = target_snapshot_id or device.get("latest_snapshot_id")

    base_snap = prisma.config_snapshot.find_unique(where={"id": base_id})
    target_snap = prisma.config_snapshot.find_unique(where={"id": target_id})

    if not base_snap or not target_snap:
        raise HTTPException(status_code=404, detail="Configuration snapshots not found")

    base_label = f"v{base_snap['version_number']} ({'Last-Known-Good' if base_snap['is_lkg'] else 'Baseline'})"
    target_label = f"v{target_snap['version_number']} ({'Current' if target_snap['id'] == device.get('latest_snapshot_id') else 'Snapshot'})"

    diff_data = compare_configs(
        lkg_config=base_snap["config_text"],
        current_config=target_snap["config_text"],
        vendor=device["vendor"],
        ignore_noise=ignore_noise,
        lkg_label=base_label,
        current_label=target_label,
    )

    return {
        "device": {
            "id": device["id"],
            "hostname": device["hostname"],
            "ip_address": device["ip_address"],
            "vendor": device["vendor"],
            "model": device["model"],
            "site": device["site"],
            "drift_detected": bool(device["drift_detected"]),
        },
        "base_snapshot": {
            "id": base_snap["id"],
            "version_number": base_snap["version_number"],
            "is_lkg": bool(base_snap["is_lkg"]),
            "normalized_hash": base_snap["normalized_hash"],
            "created_at": base_snap["created_at"],
            "config_text": base_snap["config_text"],
        },
        "target_snapshot": {
            "id": target_snap["id"],
            "version_number": target_snap["version_number"],
            "is_lkg": bool(target_snap["is_lkg"]),
            "normalized_hash": target_snap["normalized_hash"],
            "created_at": target_snap["created_at"],
            "config_text": target_snap["config_text"],
        },
        "ignore_noise": ignore_noise,
        "diff": diff_data,
    }


@app.post("/api/devices/{device_id}/promote-lkg/{snapshot_id}")
def promote_snapshot_to_lkg(device_id: int, snapshot_id: int):
    """
    Pin a snapshot as the new Last-Known-Good (LKG) baseline atomically using `prisma.tx()`.
    """
    with prisma.tx():
        target_snap = prisma.config_snapshot.find_unique(
            where={"id": snapshot_id, "device_id": device_id}
        )
        if not target_snap:
            raise HTTPException(status_code=404, detail="Snapshot not found for device")

        device = prisma.device.find_unique(where={"id": device_id})
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")

        latest_snap = prisma.config_snapshot.find_unique(
            where={"id": device["latest_snapshot_id"]}
        )

        prisma.config_snapshot.update_many(
            where={"device_id": device_id},
            data={"is_lkg": 0},
        )
        prisma.config_snapshot.update_many(
            where={"id": snapshot_id},
            data={"is_lkg": 1},
        )

        still_drifted = (
            1
            if (
                latest_snap
                and latest_snap["normalized_hash"] != target_snap["normalized_hash"]
            )
            else 0
        )
        prisma.device.update(
            where={"id": device_id},
            data={"lkg_snapshot_id": snapshot_id, "drift_detected": still_drifted},
        )
        if not still_drifted:
            prisma.alert.update_many(
                where={"device_id": device_id, "alert_type": "OUT_OF_WINDOW_DRIFT"},
                data={"acknowledged": 1},
            )

    return {
        "device_id": device_id,
        "new_lkg_snapshot_id": snapshot_id,
        "drift_detected": bool(still_drifted),
    }


@app.post("/api/devices/{device_id}/rollback-to-lkg")
def rollback_device_to_lkg(device_id: int):
    device = prisma.device.find_unique(where={"id": device_id})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    lkg_snap = prisma.config_snapshot.find_unique(
        where={"id": device["lkg_snapshot_id"]}
    )
    if not lkg_snap:
        raise HTTPException(status_code=400, detail="No Last-Known-Good snapshot found")

    prisma.device.update(
        where={"id": device_id},
        data={"simulated_running_config": lkg_snap["config_text"]},
    )

    res = _execute_device_backup(
        device_id, triggered_by="Automated LKG Rollback Engine"
    )
    prisma.alert.update_many(
        where={"device_id": device_id, "alert_type": "OUT_OF_WINDOW_DRIFT"},
        data={"acknowledged": 1},
    )
    log_audit_event(
        action="ROLLBACK_EXECUTED",
        severity="WARNING",
        target=device["hostname"],
        details=f"Device {device['hostname']} rolled back to Last-Known-Good baseline snapshot #{lkg_snap['id']}.",
        actor="NetOps Admin",
        metadata={"lkg_snapshot_id": lkg_snap["id"]},
    )
    return {
        "status": "rolled_back_to_lkg",
        "device_id": device_id,
        "lkg_snapshot_id": lkg_snap["id"],
        "backup_result": res,
    }


# ---------------------------------------------------------------------------
# Topology & Blast-Radius Endpoints (Powered by Prisma ORM)
# ---------------------------------------------------------------------------


@app.get("/api/topology")
def get_topology(site: Optional[str] = Query(None)):
    where_clause = {"site": site} if (site and site != "ALL") else None
    devices = prisma.device.find_many(where=where_clause, omit_blobs=True)
    device_ids = [d["id"] for d in devices]
    neighbors = (
        prisma.neighbor_link.find_many(where={"device_ids": device_ids})
        if device_ids
        else []
    )
    return build_topology_graph(devices, neighbors)


@app.get("/api/topology/blast-radius/{node_id}")
def get_blast_radius(node_id: str, site: Optional[str] = Query(None)):
    graph = get_topology(site=site)
    return analyze_blast_radius(graph, node_id)


@app.post("/api/topology/parse-cli")
def parse_neighbor_cli_endpoint(payload: ParseNeighborRequest):
    parsed = parse_neighbor_cli_output(payload.raw_output, payload.vendor)
    if payload.attach_to_device_id and parsed:
        now_iso = datetime.now(timezone.utc).isoformat()
        prisma.neighbor_link.create_many(
            [
                {
                    "device_id": payload.attach_to_device_id,
                    "local_port": n["local_port"],
                    "remote_hostname": n["remote_hostname"],
                    "remote_port": n["remote_port"],
                    "remote_ip": n.get("remote_ip", ""),
                    "remote_platform": n.get("remote_platform", ""),
                    "protocol": n["protocol"],
                    "updated_at": now_iso,
                }
                for n in parsed
            ]
        )
    return {
        "parsed_count": len(parsed),
        "neighbors": parsed,
        "attached_to_device_id": payload.attach_to_device_id,
    }


# ---------------------------------------------------------------------------
# Maintenance Windows, Alerts & Settings Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/maintenance-windows")
def list_maintenance_windows():
    return prisma.maintenance_window.find_many()


@app.post("/api/maintenance-windows")
def create_maintenance_window(payload: MaintenanceWindowCreate):
    now_iso = datetime.now(timezone.utc).isoformat()
    created = prisma.maintenance_window.create(
        {
            "name": payload.name,
            "site": payload.site,
            "day_of_week": payload.day_of_week,
            "start_time_utc": payload.start_time_utc,
            "end_time_utc": payload.end_time_utc,
            "is_active_override": 1 if payload.is_active_override else 0,
            "auto_promote_lkg": 1 if payload.auto_promote_lkg else 0,
            "created_at": now_iso,
        }
    )
    return {"id": created["id"], "name": payload.name}


@app.patch("/api/maintenance-windows/{window_id}/toggle")
def toggle_maintenance_window_override(window_id: int):
    row = prisma.maintenance_window.find_unique(where={"id": window_id})
    if not row:
        raise HTTPException(status_code=404, detail="Maintenance window not found")
    new_val = 0 if row["is_active_override"] else 1
    prisma.maintenance_window.update(
        where={"id": window_id},
        data={"is_active_override": new_val},
    )
    return {"id": window_id, "is_active_override": bool(new_val)}


@app.delete("/api/maintenance-windows/{window_id}")
def delete_maintenance_window(window_id: int):
    prisma.maintenance_window.delete(where={"id": window_id})
    return {"deleted": window_id}


@app.get("/api/alerts")
def list_alerts():
    raw_alerts = prisma.alert.find_many(include_device=True)
    alerts = []
    for item in raw_alerts:
        try:
            item["risk_categories"] = json.loads(item.get("risk_categories") or "[]")
        except Exception:
            item["risk_categories"] = []
        item["acknowledged"] = bool(item["acknowledged"])
        item["outside_maintenance_window"] = bool(item["outside_maintenance_window"])
        alerts.append(item)
    return alerts


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int):
    prisma.alert.update_many(where={"id": alert_id}, data={"acknowledged": 1})
    return {"acknowledged": alert_id}


@app.post("/api/alerts/acknowledge-all")
def acknowledge_all_alerts():
    prisma.alert.update_many(where={}, data={"acknowledged": 1})
    return {"status": "all_acknowledged"}


@app.get("/api/settings")
def get_settings():
    row = prisma.backup_settings.find_unique({"id": 1}) or {}
    row["schedule_enabled"] = bool(row.get("schedule_enabled", 1))
    row["noise_filter_enabled"] = bool(row.get("noise_filter_enabled", 1))
    row["alert_on_out_of_window"] = bool(row.get("alert_on_out_of_window", 1))
    return row


@app.put("/api/settings")
def update_settings(payload: BackupSettingsUpdate):
    prisma.backup_settings.update(
        {
            "schedule_enabled": 1 if payload.schedule_enabled else 0,
            "interval_minutes": payload.interval_minutes,
            "cron_expression": payload.cron_expression,
            "noise_filter_enabled": 1 if payload.noise_filter_enabled else 0,
            "alert_on_out_of_window": 1 if payload.alert_on_out_of_window else 0,
            "stale_backup_threshold_days": payload.stale_backup_threshold_days,
            "webhook_url": payload.webhook_url,
            "notification_email": payload.notification_email,
        }
    )
    return get_settings()


# ---------------------------------------------------------------------------
# Encrypted Credential Vault Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/credentials")
def list_credentials():
    rows = prisma.credential.find_many(include_counts=True)
    creds = []
    for row in rows:
        creds.append(
            {
                "id": row["id"],
                "name": row["name"],
                "protocol": row["protocol"],
                "username": row["username"],
                "password_masked": mask_secret(row.get("encrypted_password")),
                "enable_secret_masked": mask_secret(
                    row.get("encrypted_enable_secret")
                ),
                "ssh_key_masked": "RSA/OpenSSH Key (AES-Fernet Encrypted)"
                if row.get("encrypted_ssh_key")
                else "Not configured",
                "snmp_community_masked": mask_secret(
                    row.get("encrypted_snmp_community")
                ),
                "description": row.get("description") or "",
                "assigned_devices_count": row.get("assigned_devices_count", 0),
                "last_verified_at": row.get("last_verified_at"),
                "created_at": row["created_at"],
            }
        )
    return creds


@app.post("/api/credentials")
def create_credential(payload: CredentialCreate):
    now_iso = datetime.now(timezone.utc).isoformat()
    created = prisma.credential.create(
        {
            "name": payload.name,
            "protocol": payload.protocol,
            "username": payload.username,
            "encrypted_password": encrypt_secret(payload.password),
            "encrypted_enable_secret": encrypt_secret(payload.enable_secret),
            "encrypted_ssh_key": encrypt_secret(payload.ssh_private_key),
            "encrypted_snmp_community": encrypt_secret(payload.snmp_community),
            "description": payload.description,
            "last_verified_at": now_iso,
            "created_at": now_iso,
        }
    )
    return {"id": created["id"], "name": payload.name}


@app.post("/api/credentials/{cred_id}/verify")
def verify_credential_profile(cred_id: int):
    c_row = prisma.credential.find_unique(where={"id": cred_id})
    if not c_row:
        raise HTTPException(status_code=404, detail="Credential profile not found")

    devices = prisma.device.find_many(
        where={"credential_id": cred_id}, omit_blobs=True
    )
    now_iso = datetime.now(timezone.utc).isoformat()

    device_checks = []
    for d in devices:
        chk = verify_ssh_connectivity(
            ip_address=d["ip_address"],
            port=d["ssh_port"],
            username=c_row["username"],
            password=decrypt_secret(c_row.get("encrypted_password")),
            ssh_private_key=decrypt_secret(c_row.get("encrypted_ssh_key")),
            is_simulated=bool(d["is_simulated"]),
        )
        device_checks.append(
            {
                "hostname": d["hostname"],
                "ip_address": d["ip_address"],
                "authenticated": chk["authenticated"],
                "latency_ms": chk["latency_ms"],
                "message": chk["message"],
            }
        )

    prisma.credential.update(where={"id": cred_id}, data={"last_verified_at": now_iso})

    return {
        "credential_id": cred_id,
        "name": c_row["name"],
        "verified_at": now_iso,
        "devices_tested": len(device_checks),
        "all_passed": all(dc["authenticated"] for dc in device_checks),
        "results": device_checks,
    }


@app.delete("/api/credentials/{cred_id}")
def delete_credential(cred_id: int):
    prisma.credential.delete(where={"id": cred_id})
    return {"deleted": cred_id}


@app.get("/api/database-info")
def api_get_database_info():
    return get_database_engine_info()


@app.post("/api/database-info/test-postgres")
def api_test_postgres(payload: PostgresTestRequest):
    return test_postgres_connection(payload.dsn)


@app.post("/api/demo/reset")
def reset_demo_environment():
    reset_all_tables()
    return {"status": "demo_environment_reset"}


# ---------------------------------------------------------------------------
# Fleet Configuration Search Engine ("Config Grep & Asset Finder")
# ---------------------------------------------------------------------------


@app.get("/api/fleet/search")
def search_fleet_configs(
    query: str = Query(..., min_length=1),
    is_regex: bool = Query(False),
    case_sensitive: bool = Query(False),
    site: Optional[str] = Query(None),
    vendor: Optional[str] = Query(None),
    scope: str = Query("latest"),  # "latest" or "lkg"
):
    """
    Fast multi-vendor configuration grep across all fleet devices.
    Returns matched lines with synchronized line numbers and surrounding context.
    """
    where_clause = {}
    if site and site != "ALL":
        where_clause["site"] = site
    if vendor and vendor != "ALL":
        where_clause["vendor"] = vendor

    devices = prisma.device.find_many(where=where_clause if where_clause else None)
    results = []
    total_matches = 0

    try:
        if is_regex:
            pattern = re.compile(query, 0 if case_sensitive else re.IGNORECASE)
        else:
            search_str = query if case_sensitive else query.lower()
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid regular expression: {exc}"
        )

    for dev in devices:
        snap_id = (
            dev.get("latest_snapshot_id")
            if scope == "latest"
            else dev.get("lkg_snapshot_id")
        )
        if not snap_id:
            continue
        snap = prisma.config_snapshot.find_unique(where={"id": snap_id})
        if not snap or not snap.get("config_text"):
            continue

        raw_lines = snap["config_text"].splitlines()
        matched_items = []

        for idx, line in enumerate(raw_lines):
            line_matched = False
            if is_regex:
                line_matched = bool(pattern.search(line))
            else:
                line_matched = (
                    search_str in line if case_sensitive else search_str in line.lower()
                )

            if line_matched:
                start_ctx = max(0, idx - 2)
                end_ctx = min(len(raw_lines), idx + 3)
                context_lines = [
                    {
                        "line_number": c_idx + 1,
                        "text": raw_lines[c_idx],
                        "is_target": (c_idx == idx),
                    }
                    for c_idx in range(start_ctx, end_ctx)
                ]
                matched_items.append(
                    {
                        "line_number": idx + 1,
                        "matched_line": line.strip(),
                        "context": context_lines,
                    }
                )

        if matched_items:
            total_matches += len(matched_items)
            results.append(
                {
                    "device_id": dev["id"],
                    "hostname": dev["hostname"],
                    "ip_address": dev["ip_address"],
                    "site": dev["site"],
                    "vendor": dev["vendor"],
                    "model": dev["model"],
                    "role": dev["role"],
                    "snapshot_id": snap["id"],
                    "snapshot_version": snap["version_number"],
                    "is_lkg": bool(snap["is_lkg"]),
                    "match_count": len(matched_items),
                    "matches": matched_items,
                }
            )

    return {
        "query": query,
        "is_regex": is_regex,
        "case_sensitive": case_sensitive,
        "scope": scope,
        "total_devices_searched": len(devices),
        "devices_with_matches": len(results),
        "total_matched_lines": total_matches,
        "results": results,
    }


# ---------------------------------------------------------------------------
# Golden Baseline & Security Policy Compliance Engine
# ---------------------------------------------------------------------------


@app.get("/api/compliance/rules")
def list_compliance_rules(vendor: Optional[str] = Query(None)):
    where = {"vendor": vendor} if (vendor and vendor != "ALL") else None
    return prisma.compliance_rule.find_many(where=where)


@app.post("/api/compliance/rules")
def create_compliance_rule(payload: ComplianceRuleCreate):
    now_iso = datetime.now(timezone.utc).isoformat()
    existing = prisma.compliance_rule.find_unique(where={"rule_id": payload.rule_id})
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Rule ID '{payload.rule_id}' already exists.",
        )

    created = prisma.compliance_rule.create(
        {
            "rule_id": payload.rule_id.strip().upper(),
            "name": payload.name.strip(),
            "description": payload.description.strip(),
            "severity": payload.severity,
            "vendor": payload.vendor,
            "pattern_type": payload.pattern_type,
            "pattern": payload.pattern,
            "remediation_cli": payload.remediation_cli,
            "enabled": 1 if payload.enabled else 0,
            "created_at": now_iso,
        }
    )
    log_audit_event(
        action="COMPLIANCE_RULE_CREATED",
        severity="INFO",
        target=created["rule_id"],
        details=f"Created compliance rule '{created['name']}' ({created['severity']})",
    )
    return created


@app.delete("/api/compliance/rules/{rule_id}")
def delete_compliance_rule(rule_id: str):
    cnt = prisma.compliance_rule.delete(where={"rule_id": rule_id})
    if not cnt:
        raise HTTPException(status_code=404, detail="Rule not found")
    log_audit_event(
        action="COMPLIANCE_RULE_DELETED",
        severity="INFO",
        target=rule_id,
        details=f"Deleted compliance rule {rule_id}",
    )
    return {"deleted": rule_id}


@app.post("/api/compliance/scan")
def scan_fleet_compliance(device_id: Optional[int] = Query(None)):
    rules = prisma.compliance_rule.find_many(where={"enabled": 1})
    if device_id:
        target_dev = prisma.device.find_unique(where={"id": device_id})
        if not target_dev:
            raise HTTPException(status_code=404, detail="Device not found")
        devices = [target_dev]
    else:
        devices = prisma.device.find_many()

    device_results = []
    for dev in devices:
        snap_id = dev.get("latest_snapshot_id") or dev.get("lkg_snapshot_id")
        cfg_text = ""
        if snap_id:
            snap = prisma.config_snapshot.find_unique(where={"id": snap_id})
            if snap:
                cfg_text = snap.get("config_text", "")

        res = scan_device_compliance(dev, rules, cfg_text)
        device_results.append(res)

    total_devices = len(device_results)
    compliant_devices = sum(1 for d in device_results if d["passed"])
    fleet_score = (
        round(sum(d["score"] for d in device_results) / total_devices)
        if total_devices > 0
        else 100
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    log_audit_event(
        action="COMPLIANCE_SCAN",
        severity="INFO" if fleet_score >= 80 else "WARNING",
        target=f"Fleet ({total_devices} devices)"
        if not device_id
        else devices[0]["hostname"],
        details=f"Compliance scan completed: Fleet Score {fleet_score}% ({compliant_devices}/{total_devices} devices compliant)",
        metadata={"fleet_score": fleet_score, "compliant_devices": compliant_devices},
    )

    return {
        "scanned_at": now_iso,
        "total_rules": len(rules),
        "total_devices_scanned": total_devices,
        "compliant_devices": compliant_devices,
        "non_compliant_devices": total_devices - compliant_devices,
        "fleet_compliance_score": fleet_score,
        "devices": device_results,
    }


@app.get("/api/compliance/report")
def get_compliance_report():
    return scan_fleet_compliance()


# ---------------------------------------------------------------------------
# Fleet Disaster Recovery (DR) Export & Config Download
# ---------------------------------------------------------------------------


@app.get("/api/fleet/export/zip")
def export_fleet_dr_zip():
    """
    Generate an offline Disaster Recovery (DR) archive containing:
    1. README.txt with restore guide
    2. manifest.json with hashes and metadata
    3. All device configs categorized into folders: <Site>/<Vendor>/<Hostname>_latest.cfg
    """
    devices = prisma.device.find_many()
    now_iso = datetime.now(timezone.utc).isoformat()
    now_slug = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    zip_buffer = io.BytesIO()
    manifest_entries = []

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for dev in devices:
            site_slug = (
                dev["site"]
                .replace(" ", "_")
                .replace("(", "")
                .replace(")", "")
                .replace("/", "-")
            )
            vendor_slug = dev["vendor"].replace(" ", "_")
            hostname = dev["hostname"]

            # Latest snapshot
            latest_id = dev.get("latest_snapshot_id")
            latest_cfg = ""
            latest_norm_hash = ""
            latest_version = 0
            if latest_id:
                snap = prisma.config_snapshot.find_unique(where={"id": latest_id})
                if snap:
                    latest_cfg = snap.get("config_text", "")
                    latest_norm_hash = snap.get("normalized_hash", "")
                    latest_version = snap.get("version_number", 0)

            # LKG snapshot
            lkg_id = dev.get("lkg_snapshot_id")
            lkg_cfg = ""
            lkg_norm_hash = ""
            lkg_version = 0
            if lkg_id:
                snap_lkg = prisma.config_snapshot.find_unique(where={"id": lkg_id})
                if snap_lkg:
                    lkg_cfg = snap_lkg.get("config_text", "")
                    lkg_norm_hash = snap_lkg.get("normalized_hash", "")
                    lkg_version = snap_lkg.get("version_number", 0)

            if latest_cfg:
                path = f"{site_slug}/{vendor_slug}/{hostname}_v{latest_version}_latest.cfg"
                zf.writestr(path, latest_cfg)

            if lkg_cfg and lkg_id != latest_id:
                lkg_path = f"{site_slug}/{vendor_slug}/{hostname}_v{lkg_version}_lkg.cfg"
                zf.writestr(lkg_path, lkg_cfg)

            manifest_entries.append(
                {
                    "hostname": hostname,
                    "ip_address": dev["ip_address"],
                    "vendor": dev["vendor"],
                    "model": dev["model"],
                    "site": dev["site"],
                    "latest_version": latest_version,
                    "latest_normalized_hash": latest_norm_hash,
                    "lkg_version": lkg_version,
                    "lkg_normalized_hash": lkg_norm_hash,
                    "drift_detected": bool(dev.get("drift_detected")),
                }
            )

        manifest_data = {
            "title": "NetGuardia Fleet Disaster Recovery Bundle",
            "exported_at": now_iso,
            "total_devices": len(manifest_entries),
            "manifest": manifest_entries,
        }
        zf.writestr("manifest.json", json.dumps(manifest_data, indent=2))

        readme_text = f"""NetGuardia Disaster Recovery Config Archive
Generated: {now_iso}
Total Devices: {len(manifest_entries)}

================================================================================
RESTORATION INSTRUCTIONS:
================================================================================
1. To restore a Cisco IOS/IOS-XE device:
   - Connect via Console or OOB SSH.
   - Enter privileged EXEC mode ('enable').
   - In terminal: 'configure terminal'
   - Paste corresponding '<hostname>_lkg.cfg' content or upload via SCP/TFTP:
     copy tftp://<tftp_server>/<hostname>.cfg running-config
   - Verify with: 'show running-config' and 'write memory'

2. To restore a Juniper Junos device:
   - Connect via SSH or Console.
   - Enter CLI configuration mode: 'configure'
   - Load configuration: 'load override <hostname>.cfg'
   - Check syntax: 'commit check'
   - Commit changes: 'commit comment "Disaster Recovery Restoration"'

3. To restore a Ubiquiti EdgeOS device:
   - SCP config file to /config/config.boot
   - In CLI: 'reboot' or 'load <filename>' and 'commit; save'
================================================================================
"""
        zf.writestr("README.txt", readme_text)

    zip_buffer.seek(0)
    filename = f"netguardia_fleet_dr_{now_slug}.zip"

    log_audit_event(
        action="DR_EXPORT",
        severity="INFO",
        target="Fleet DR Bundle",
        details=f"Exported Disaster Recovery bundle containing {len(devices)} device configurations.",
    )

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/api/devices/{device_id}/export")
def export_single_device_config(
    device_id: int,
    version: Optional[str] = Query("latest"),  # "latest" or "lkg"
):
    dev = prisma.device.find_unique(where={"id": device_id})
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    snap_id = (
        dev.get("lkg_snapshot_id")
        if version == "lkg"
        else dev.get("latest_snapshot_id")
    )
    if not snap_id:
        raise HTTPException(status_code=404, detail="No snapshot found for device")

    snap = prisma.config_snapshot.find_unique(where={"id": snap_id})
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot text not found")

    filename = f"{dev['hostname']}_v{snap['version_number']}_{version}.cfg"
    return Response(
        content=snap["config_text"],
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# Operational Activity & Audit Trail Log
# ---------------------------------------------------------------------------


@app.get("/api/audit-logs")
def list_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    action: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
):
    where = {}
    if action and action != "ALL":
        where["action"] = action
    if severity and severity != "ALL":
        where["severity"] = severity
    logs = prisma.audit_log.find_many(where=where if where else None, limit=limit)
    for l in logs:
        try:
            l["metadata"] = json.loads(l.get("metadata_json") or "{}")
        except Exception:
            l["metadata"] = {}
    return logs


@app.post("/api/audit-logs/record")
def record_audit_log_endpoint(payload: AuditLogRecordRequest):
    log_audit_event(
        action=payload.action,
        severity=payload.severity,
        target=payload.target,
        details=payload.details,
        actor=payload.actor,
        metadata=payload.metadata,
    )
    return {"status": "recorded"}



# Serve built React SPA if frontend/dist exists
_FRONTEND_DIST = _Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(_FRONTEND_DIST / "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        index_file = _FRONTEND_DIST / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        raise HTTPException(status_code=404, detail="Not found")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

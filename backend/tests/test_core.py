"""
Automated Test Suite for NetGuardia Backend:
- Encrypted Credential Vault (AES-128-CBC + HMAC-SHA256)
- Multi-Vendor Config Normalization & Noise Filtering
- Side-by-Side Diff Engine & Rollback CLI Generation
- LLDP & CDP Multi-Vendor CLI Output Parsers (Cisco, Juniper, Ubiquiti)
- Automated Topology Graph & Downstream Blast-Radius Dependency Engine
- FastAPI REST Endpoints
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from diff_engine import compare_configs, compute_config_hashes, normalize_config
from main import app
from topology_engine import (
    analyze_blast_radius,
    build_topology_graph,
    parse_neighbor_cli_output,
)
from vault import decrypt_secret, encrypt_secret, mask_secret


def test_vault_encryption_roundtrip():
    secret = "C1sco$SuperSecret!2026"
    token = encrypt_secret(secret)
    assert token is not None
    assert token != secret
    assert decrypt_secret(token) == secret
    masked = mask_secret(token)
    assert "••••••••" in masked
    assert secret not in masked


def test_config_noise_filtering_and_diff():
    lkg_cfg = """! Last configuration change at 01:00:00 UTC Mon Oct 10 2026 by admin
ntp clock-period 36028000
hostname hq-core-sw01
interface GigabitEthernet1/0/1
 switchport mode trunk
end"""

    # Only volatile noise changed -> normalized hash must be identical!
    noisy_same_cfg = """! Last configuration change at 14:22:11 UTC Sat Oct 17 2026 by admin
ntp clock-period 36029999
hostname hq-core-sw01
interface GigabitEthernet1/0/1
 switchport mode trunk
end"""

    raw1, norm1 = compute_config_hashes(lkg_cfg)
    raw2, norm2 = compute_config_hashes(noisy_same_cfg)
    assert raw1 != raw2
    assert norm1 == norm2

    diff_clean = compare_configs(lkg_cfg, noisy_same_cfg, vendor="Cisco", ignore_noise=True)
    assert diff_clean["has_changes"] is False
    assert diff_clean["suppressed_noise_lines"] >= 2

    # Now introduce a real risky ACL change
    drifted_cfg = noisy_same_cfg.replace(
        "end",
        "ip access-list extended WAN-IN\n permit tcp any any eq 22\nend",
    )
    diff_drift = compare_configs(lkg_cfg, drifted_cfg, vendor="Cisco", ignore_noise=True)
    assert diff_drift["has_changes"] is True
    assert diff_drift["added_count"] == 2
    assert diff_drift["highest_severity"] == "CRITICAL"
    assert "no permit tcp any any eq 22" in diff_drift["rollback_cli"]


def test_multi_vendor_lldp_cdp_parsers():
    cisco_cdp = """-------------------------
Device ID: hq-core-sw01.corp.local
Entry address(es):
  IP address: 10.10.1.1
Platform: cisco C9300-48P,  Capabilities: Router Switch
Interface: GigabitEthernet0/0/1,  Port ID (outgoing port): TenGigabitEthernet1/1/1"""
    parsed_cdp = parse_neighbor_cli_output(cisco_cdp, "Cisco")
    assert len(parsed_cdp) == 1
    assert parsed_cdp[0]["remote_hostname"] == "hq-core-sw01"
    assert parsed_cdp[0]["protocol"] == "CDP"

    juniper_lldp = """Local Interface    Parent Interface    Chassis Id          Port info          System Name
xe-0/0/0           -                   00:1c:73:11:22:01   Gi0/0/2            hq-edge-fw01"""
    parsed_junos = parse_neighbor_cli_output(juniper_lldp, "Juniper")
    assert len(parsed_junos) == 1
    assert parsed_junos[0]["remote_hostname"] == "hq-edge-fw01"
    assert parsed_junos[0]["local_port"] == "xe-0/0/0"

    ubnt_lldp = """-------------------------------------------------------------------------------
Interface:    eth49, via: LLDP, RID: 1, Time: 14 days, 06:11:22
  Chassis:
    SysName:      hq-dist-sw01.corp.local
    SysDescr:     Cisco IOS Software
    MgmtIP:       10.10.2.1
  Port:
    PortID:       ifname GigabitEthernet1/0/1"""
    parsed_ubnt = parse_neighbor_cli_output(ubnt_lldp, "Ubiquiti")
    assert len(parsed_ubnt) == 1
    assert parsed_ubnt[0]["remote_hostname"] == "hq-dist-sw01"
    assert parsed_ubnt[0]["local_port"] == "eth49"


def test_fastapi_endpoints_and_blast_radius():
    with TestClient(app) as client:
        # Reset demo state to ensure deterministic test run
        r_reset = client.post("/api/demo/reset")
        assert r_reset.status_code == 200

        # 1. Overview
        ov = client.get("/api/overview").json()
        assert ov["total_devices"] >= 10
        assert ov["drifted_devices"] == 2
        assert ov["stale_devices"] == 1

        # 2. Fleet Readiness Verification ("When did you last verify your backup ran?")
        ver = client.post("/api/verify-fleet-readiness").json()
        assert ver["total_devices"] == ov["total_devices"]
        assert len(ver["results"]) == ov["total_devices"]

        # 3. Topology & Blast-Radius analysis
        topo = client.get("/api/topology").json()
        assert topo["stats"]["total_nodes"] >= 11
        assert topo["stats"]["unmanaged_discovered_nodes"] >= 1

        # Find hq-dist-sw01 and simulate its failure -> hq-access-sw01 and hq-access-sw02 should be isolated!
        dist_node = next(n for n in topo["nodes"] if n["hostname"] == "hq-dist-sw01")
        blast = client.get(f"/api/topology/blast-radius/{dist_node['id']}").json()
        assert "hq-access-sw01" in blast["isolated_hostnames"]
        assert "hq-access-sw02" in blast["isolated_hostnames"]

        # 4. Diff endpoint & Rollback to LKG
        devices = client.get("/api/devices").json()
        fw_dev = next(d for d in devices if d["hostname"] == "hq-edge-fw01")
        assert fw_dev["drift_detected"] is True

        diff_resp = client.get(f"/api/devices/{fw_dev['id']}/diff").json()
        assert diff_resp["diff"]["has_changes"] is True
        assert diff_resp["diff"]["highest_severity"] == "CRITICAL"

        # Rollback hq-edge-fw01 to LKG and verify drift is resolved
        rb_resp = client.post(f"/api/devices/{fw_dev['id']}/rollback-to-lkg").json()
        assert rb_resp["status"] == "rolled_back_to_lkg"
        assert rb_resp["backup_result"]["drift_detected"] is False

        # 5. Database Engine Info endpoint
        db_info = client.get("/api/database-info").json()
        assert db_info["connected"] is True
        assert "schema.postgres.sql" in db_info["schema_file"]

        # Restore initial seeded state for live application usage
        client.post("/api/demo/reset")


def test_postgres_sql_translator_and_schema():
    from database import POSTGRES_SCHEMA_FILE, translate_sql_for_postgres

    assert POSTGRES_SCHEMA_FILE.exists()
    ddl = POSTGRES_SCHEMA_FILE.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS devices" in ddl
    assert "SERIAL PRIMARY KEY" in ddl

    pg_sql, ret = translate_sql_for_postgres(
        "INSERT INTO devices (hostname, ip_address) VALUES (?, ?)",
        is_executemany=False,
    )
    assert pg_sql == "INSERT INTO devices (hostname, ip_address) VALUES (%s, %s) RETURNING id"
    assert ret is True

    pg_ignore, ret_ignore = translate_sql_for_postgres(
        "INSERT OR IGNORE INTO backup_settings (id, schedule_enabled) VALUES (1, ?)",
        is_executemany=False,
    )
    assert "ON CONFLICT DO NOTHING" in pg_ignore
    assert "%s" in pg_ignore
    assert ret_ignore is False


def test_prisma_orm_optimizations_and_schema():
    import pytest
    from prisma_client import PRISMA_SCHEMA_PATH, prisma

    # 1. Verify declarative prisma/schema.prisma
    assert PRISMA_SCHEMA_PATH.exists()
    schema_text = PRISMA_SCHEMA_PATH.read_text(encoding="utf-8")
    for model_name in (
        "model Credential",
        "model Device",
        "model ConfigSnapshot",
        "model NeighborLink",
        "model MaintenanceWindow",
        "model Alert",
        "model BackupSettings",
    ):
        assert model_name in schema_text

    # 2. Verify single-query eager-load & blob omission
    devices = prisma.device.find_many(
        include={
            "credential": True,
            "lkg_snapshot": True,
            "latest_snapshot": True,
            "_count": True,
        },
        omit_blobs=True,
    )
    assert len(devices) >= 10
    first = devices[0]
    assert "simulated_running_config" not in first
    assert first["lkg_version"] is not None
    assert first["snapshot_count"] >= 1
    assert first["credential_name"] is not None

    # 3. Verify atomic transaction rollback (`prisma.tx()`)
    initial_count = prisma.maintenance_window.find_many()
    with pytest.raises(RuntimeError):
        with prisma.tx():
            prisma.maintenance_window.create(
                {
                    "name": "Rollback Test Window",
                    "site": "ALL",
                    "day_of_week": "Monday",
                    "start_time_utc": "01:00",
                    "end_time_utc": "02:00",
                    "is_active_override": 0,
                    "auto_promote_lkg": 1,
                    "created_at": "2026-10-17T00:00:00Z",
                }
            )
            raise RuntimeError("Simulated failure inside prisma.tx()")

    after_count = prisma.maintenance_window.find_many()
    assert len(after_count) == len(initial_count)


def test_compliance_engine_and_fleet_scan():
    """Verify security rule evaluation, fleet compliance scanning, and remediation CLI."""
    with TestClient(app) as client:
        # 1. Verify compliance rules endpoint returns seeded rules
        rules = client.get("/api/compliance/rules").json()
        assert len(rules) >= 8
        rule_ids = {r["rule_id"] for r in rules}
        assert "CIS-NET-01" in rule_ids  # Disable Telnet
        assert "CIS-NET-04" in rule_ids  # Password Encryption

        # 2. Run fleet-wide compliance scan
        scan = client.post("/api/compliance/scan").json()
        assert scan["total_devices_scanned"] >= 10
        assert 0 <= scan["fleet_compliance_score"] <= 100
        assert len(scan["devices"]) == scan["total_devices_scanned"]

        # 3. Check hq-edge-fw01 (which has drifted to enable telnet)
        fw = next(d for d in scan["devices"] if d["hostname"] == "hq-edge-fw01")
        telnet_eval = next(
            e for e in fw["evaluations"] if e["rule_id"] == "CIS-NET-01"
        )
        assert telnet_eval["passed"] is False
        assert telnet_eval["remediation_cli"] != ""
        assert "transport input ssh" in telnet_eval["remediation_cli"]


def test_fleet_config_search_and_dr_export():
    """Verify fleet config grep with regex/context lines and disaster recovery ZIP export."""
    import zipfile
    import io

    with TestClient(app) as client:
        # 1. Search for hostname or specific interface command
        res = client.get("/api/fleet/search?query=switchport%20mode%20trunk").json()
        assert res["total_matched_lines"] >= 1
        assert res["devices_with_matches"] >= 1
        match = res["results"][0]["matches"][0]
        assert "context" in match
        assert len(match["context"]) >= 1

        # 2. Regex search
        reg_res = client.get(
            "/api/fleet/search?query=GigabitEthernet\\d&is_regex=true"
        ).json()
        assert reg_res["devices_with_matches"] >= 1

        # 3. Disaster Recovery ZIP Export
        dr_resp = client.get("/api/fleet/export/zip")
        assert dr_resp.status_code == 200
        assert dr_resp.headers["content-type"] == "application/zip"

        # Read in-memory zip
        zf = zipfile.ZipFile(io.BytesIO(dr_resp.content))
        names = zf.namelist()
        assert "manifest.json" in names
        assert "README.txt" in names
        assert any(n.endswith(".cfg") for n in names)

        # 4. Single device config download
        devices = client.get("/api/devices").json()
        dev_id = devices[0]["id"]
        dev_export = client.get(f"/api/devices/{dev_id}/export")
        assert dev_export.status_code == 200
        assert len(dev_export.text) > 50

        # 5. Operational audit logs
        logs = client.get("/api/audit-logs?limit=10").json()
        assert len(logs) >= 1
        actions = {l["action"] for l in logs}
        assert "DR_EXPORT" in actions or "BACKUP_RUN" in actions





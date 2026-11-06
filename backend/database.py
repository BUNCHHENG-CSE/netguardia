"""
Prisma ORM Database Initializer, Seed Engine & Dual-Engine Metadata for NetGuardia.
Uses `prisma` (`PrismaClient` in `backend/prisma_client.py` backed by `prisma/schema.prisma`)
for atomic seeding, bulk inserts (`create_many`), and connection pooling across PostgreSQL & SQLite.
"""

import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from diff_engine import compute_config_hashes
from prisma_client import PRISMA_SCHEMA_PATH, prisma
from vault import encrypt_secret

DB_PATH = Path(__file__).parent / "netguardia.db"
POSTGRES_SCHEMA_FILE = Path(__file__).parent / "schema.postgres.sql"


def translate_sql_for_postgres(sql: str, is_executemany: bool = False) -> Tuple[str, bool]:
    """
    Translate SQLite-style parameterized SQL (`?` placeholders, `INSERT OR IGNORE`)
    into PostgreSQL-native SQL (`%s` placeholders, `ON CONFLICT DO NOTHING`, `RETURNING id`).
    """
    pg_sql = sql.strip().rstrip(";")
    has_insert_ignore = False

    if re.match(r"^INSERT\s+OR\s+IGNORE\s+INTO\b", pg_sql, flags=re.IGNORECASE):
        pg_sql = re.sub(
            r"^INSERT\s+OR\s+IGNORE\s+INTO\b",
            "INSERT INTO",
            pg_sql,
            flags=re.IGNORECASE,
        )
        has_insert_ignore = True

    pg_sql = pg_sql.replace("?", "%s")

    if has_insert_ignore:
        pg_sql += " ON CONFLICT DO NOTHING"
        return pg_sql, False

    is_insert = bool(re.match(r"^INSERT\s+INTO\b", pg_sql, flags=re.IGNORECASE))
    if (
        is_insert
        and not is_executemany
        and "RETURNING " not in pg_sql.upper()
        and "ON CONFLICT" not in pg_sql.upper()
    ):
        pg_sql += " RETURNING id"
        return pg_sql, True

    return pg_sql, False


def get_configured_database_url() -> str:
    return os.environ.get("DATABASE_URL", "").strip()


def is_postgres_url(url: str) -> bool:
    return url.startswith("postgresql://") or url.startswith("postgres://")


def get_database_engine_info() -> Dict[str, Any]:
    """Return metadata about the active Prisma ORM database engine (PostgreSQL vs SQLite WAL)."""
    db_url = get_configured_database_url()
    if is_postgres_url(db_url):
        try:
            import psycopg

            with psycopg.connect(db_url, connect_timeout=4) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT version();")
                    ver = cur.fetchone()[0]
            return {
                "engine": "Prisma ORM • PostgreSQL",
                "mode": "Production Cloud / Multi-Site DB (QueuePool)",
                "connected": True,
                "version": ver,
                "dsn_configured": True,
                "schema_file": "prisma/schema.prisma (backend/schema.postgres.sql)",
            }
        except Exception as exc:
            return {
                "engine": "Prisma ORM • PostgreSQL (Unreachable)",
                "mode": f"Connection Error: {exc}",
                "connected": False,
                "version": "Unavailable",
                "dsn_configured": True,
                "schema_file": "prisma/schema.prisma (backend/schema.postgres.sql)",
            }

    return {
        "engine": "Prisma ORM • SQLite WAL (Postgres-Ready)",
        "mode": "Local Appliance Mode (Set DATABASE_URL=postgresql://... for Postgres)",
        "connected": True,
        "version": f"SQLite {sqlite3.sqlite_version} + Prisma Schema + psycopg 3.3",
        "dsn_configured": False,
        "schema_file": "prisma/schema.prisma (backend/schema.postgres.sql)",
    }


def test_postgres_connection(dsn: str) -> Dict[str, Any]:
    """Test a user-supplied PostgreSQL connection string (`postgresql://...`) via `psycopg`."""
    if not is_postgres_url(dsn):
        return {
            "ok": False,
            "message": "DSN must start with postgresql:// or postgres://",
        }
    try:
        import psycopg

        with psycopg.connect(dsn, connect_timeout=4) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version();")
                ver = cur.fetchone()[0]
        return {
            "ok": True,
            "message": f"Connected to PostgreSQL successfully: {ver}",
        }
    except Exception as exc:
        return {
            "ok": False,
            "message": f"PostgreSQL connection test failed: {exc}",
        }


def init_db() -> None:
    """Create schema via Prisma ORM models and seed initial multi-vendor fleet if empty."""
    prisma.refresh_engine_if_env_changed()
    prisma.create_schema()
    if prisma.device.count() == 0:
        _seed_initial_data_with_prisma()


def reset_all_tables() -> None:
    """Drop, recreate, and re-seed all tables atomically via Prisma ORM."""
    prisma.refresh_engine_if_env_changed()
    prisma.reset_schema()
    _seed_initial_data_with_prisma()


def _seed_initial_data_with_prisma() -> None:
    """Seed the initial multi-site fleet using atomic Prisma transaction & bulk `create_many`."""
    now = datetime.now(timezone.utc)
    iso_now = now.isoformat()
    iso_2h_ago = (now - timedelta(hours=2)).isoformat()
    iso_6h_ago = (now - timedelta(hours=6)).isoformat()
    iso_2d_ago = (now - timedelta(days=2)).isoformat()
    iso_94d_ago = (now - timedelta(days=94)).isoformat()

    from topology_engine import parse_neighbor_cli_output

    with prisma.tx():
        # 1. Seed Backup Settings via Prisma upsert
        prisma.backup_settings.upsert(
            {
                "id": 1,
                "schedule_enabled": 1,
                "interval_minutes": 360,
                "cron_expression": "0 */6 * * *",
                "noise_filter_enabled": 1,
                "alert_on_out_of_window": 1,
                "stale_backup_threshold_days": 7,
                "webhook_url": "https://hooks.slack.com/services/T000/B000/NETGUARDIA-OPS",
                "notification_email": "netops-alerts@smallteam.io",
                "last_global_run_at": iso_2h_ago,
                "last_readiness_audit_at": iso_6h_ago,
            }
        )

        # 2. Bulk seed Encrypted Credential Vault via Prisma `create_many`
        prisma.credential.create_many(
            [
                {
                    "name": "Cisco TACACS+ NetOps",
                    "protocol": "SSH",
                    "username": "netops_admin",
                    "encrypted_password": encrypt_secret("C1sco!Tacacs#2026"),
                    "encrypted_enable_secret": encrypt_secret("En4ble$Secret99"),
                    "encrypted_ssh_key": None,
                    "encrypted_snmp_community": encrypt_secret("NetGuard_RO_v2c"),
                    "description": "Primary SSH + Enable secret for Cisco IOS-XE / ASA fleet",
                    "last_verified_at": iso_2h_ago,
                    "created_at": iso_2d_ago,
                },
                {
                    "name": "Juniper Junos Automation Key",
                    "protocol": "SSH / NETCONF",
                    "username": "junos_auto",
                    "encrypted_password": encrypt_secret("Jun0s#Netconf2026"),
                    "encrypted_enable_secret": None,
                    "encrypted_ssh_key": encrypt_secret(
                        "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----"
                    ),
                    "encrypted_snmp_community": encrypt_secret("Junos_SNMP_RO"),
                    "description": "SSH RSA key + NETCONF credentials for Juniper EX/SRX switches & firewalls",
                    "last_verified_at": iso_2h_ago,
                    "created_at": iso_2d_ago,
                },
                {
                    "name": "Ubiquiti EdgeOS / UniFi Admin",
                    "protocol": "SSH / SNMP",
                    "username": "ubnt_ops",
                    "encrypted_password": encrypt_secret("Ubnt$EdgePro!88"),
                    "encrypted_enable_secret": None,
                    "encrypted_ssh_key": None,
                    "encrypted_snmp_community": encrypt_secret("Ubnt_RO_Community"),
                    "description": "Site credentials for Ubiquiti EdgeRouter and UniFi Pro PoE switches",
                    "last_verified_at": iso_2h_ago,
                    "created_at": iso_2d_ago,
                },
            ]
        )

        # 3. Bulk seed Maintenance Windows via Prisma `create_many`
        prisma.maintenance_window.create_many(
            [
                {
                    "name": "Weekly Core Maintenance Window",
                    "site": "HQ-Campus (Austin)",
                    "day_of_week": "Sunday",
                    "start_time_utc": "02:00",
                    "end_time_utc": "04:00",
                    "is_active_override": 0,
                    "auto_promote_lkg": 1,
                    "created_at": iso_2d_ago,
                },
                {
                    "name": "Branch EU Overnight Patch Window",
                    "site": "Branch-DC (Frankfurt)",
                    "day_of_week": "Wednesday",
                    "start_time_utc": "01:00",
                    "end_time_utc": "03:00",
                    "is_active_override": 0,
                    "auto_promote_lkg": 1,
                    "created_at": iso_2d_ago,
                },
            ]
        )

        # 4. Seed Multi-Vendor Network Devices + Configs + Bulk Neighbor Links
        devices_seed = [
            {
                "hostname": "hq-edge-fw01",
                "ip_address": "10.10.0.1",
                "vendor": "Cisco",
                "model": "Secure Firewall 3110 / ISR4451",
                "os_type": "Cisco IOS-XE 17.9",
                "role": "Firewall / WAN Gateway",
                "site": "HQ-Campus (Austin)",
                "credential_id": 1,
                "lkg_config": """! Last configuration change at 02:15:00 UTC Sun Oct 11 2026 by netops_admin
! NVRAM config last updated at 02:15:04 UTC Sun Oct 11 2026 by netops_admin
version 17.9
service timestamps debug datetime msec
service timestamps log datetime msec
service password-encryption
!
hostname hq-edge-fw01
!
aaa new-model
username netops_admin privilege 15 secret 9 $9$encryptedHash01
!
interface GigabitEthernet0/0/0
 description WAN-PRIMARY-FIBER-ISP1
 ip address 203.0.113.2 255.255.255.252
 ip access-group WAN-INBOUND-ACL in
 no shutdown
!
interface GigabitEthernet0/0/1
 description DOWNLINK-TO-HQ-CORE-SW01
 ip address 10.10.0.1 255.255.255.252
 no shutdown
!
interface GigabitEthernet0/0/2
 description DOWNLINK-TO-HQ-CORE-SW02
 ip address 10.10.0.5 255.255.255.252
 no shutdown
!
router ospf 10
 router-id 10.10.0.1
 network 10.10.0.0 0.0.255.255 area 0
 default-information originate always
!
ip access-list extended WAN-INBOUND-ACL
 remark Allow IPSec & HTTPS VPN Portal only
 permit udp any any eq isakmp
 permit esp any any
 permit tcp any host 203.0.113.2 eq 443
 deny ip any any log
!
snmp-server community NetGuard_RO_v2c RO
ntp server 10.10.0.250
ntp clock-period 36028797
line vty 0 4
 transport input ssh
end""",
                "current_config": """! Last configuration change at 10:42:11 UTC Sat Oct 17 2026 by unknown_vty
! NVRAM config last updated at 10:42:15 UTC Sat Oct 17 2026 by unknown_vty
version 17.9
service timestamps debug datetime msec
service timestamps log datetime msec
service password-encryption
!
hostname hq-edge-fw01
!
aaa new-model
username netops_admin privilege 15 secret 9 $9$encryptedHash01
!
interface GigabitEthernet0/0/0
 description WAN-PRIMARY-FIBER-ISP1
 ip address 203.0.113.2 255.255.255.252
 ip access-group WAN-INBOUND-ACL in
 no shutdown
!
interface GigabitEthernet0/0/1
 description DOWNLINK-TO-HQ-CORE-SW01
 ip address 10.10.0.1 255.255.255.252
 no shutdown
!
interface GigabitEthernet0/0/2
 description DOWNLINK-TO-HQ-CORE-SW02
 ip address 10.10.0.5 255.255.255.252
 no shutdown
!
router ospf 10
 router-id 10.10.0.1
 network 10.10.0.0 0.0.255.255 area 0
 default-information originate always
!
ip access-list extended WAN-INBOUND-ACL
 remark Allow IPSec & HTTPS VPN Portal only
 permit udp any any eq isakmp
 permit esp any any
 permit tcp any host 203.0.113.2 eq 443
 permit tcp any any eq 22 log
 permit tcp any any eq 23
 deny ip any any log
!
snmp-server community NetGuard_RO_v2c RO
ntp server 10.10.0.250
ntp clock-period 36029112
line vty 0 4
 transport input telnet ssh
end""",
                "neighbor_raw": """-------------------------
Device ID: hq-core-sw01.corp.local
Entry address(es):
  IP address: 10.10.1.1
Platform: cisco C9300-48P,  Capabilities: Router Switch IGMP
Interface: GigabitEthernet0/0/1,  Port ID (outgoing port): TenGigabitEthernet1/1/1
-------------------------
Device ID: hq-core-sw02.corp.local
Entry address(es):
  IP address: 10.10.1.2
Platform: Juniper EX4300-48P,  Capabilities: Router Switch
Interface: GigabitEthernet0/0/2,  Port ID (outgoing port): xe-0/0/0
-------------------------
Device ID: br-edge-srx01.corp.local
Entry address(es):
  IP address: 10.20.0.1
Platform: Juniper SRX345,  Capabilities: Router
Interface: Tunnel10,  Port ID (outgoing port): st0.0""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "hq-core-sw01",
                "ip_address": "10.10.1.1",
                "vendor": "Cisco",
                "model": "Catalyst C9300-48P",
                "os_type": "Cisco IOS-XE 17.6",
                "role": "Core Switch",
                "site": "HQ-Campus (Austin)",
                "credential_id": 1,
                "lkg_config": """! Last configuration change at 02:20:00 UTC Sun Oct 11 2026 by netops_admin
version 17.6
service password-encryption
hostname hq-core-sw01
!
spanning-tree mode rapid-pvst
spanning-tree vlan 1-100 priority 4096
!
vlan 10
 name CORP_WORKSTATIONS
vlan 20
 name VOICE_VOIP
vlan 30
 name PROD_SERVERS
!
interface TenGigabitEthernet1/1/1
 description UPLINK-TO-HQ-EDGE-FW01
 ip address 10.10.0.2 255.255.255.252
!
interface TenGigabitEthernet1/1/2
 description PEER-LINK-HQ-CORE-SW02
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
interface GigabitEthernet1/0/1
 description DOWNLINK-HQ-DIST-SW01
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
interface GigabitEthernet1/0/2
 description DOWNLINK-HQ-DIST-SW02
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
router ospf 10
 router-id 10.10.1.1
 network 10.10.0.0 0.0.255.255 area 0
!
snmp-server community NetGuard_RO_v2c RO
ntp clock-period 36028100
line vty 0 15
 transport input ssh
end""",
                "current_config": None,
                "neighbor_raw": """-------------------------
Device ID: hq-edge-fw01.corp.local
Entry address(es):
  IP address: 10.10.0.1
Platform: cisco ISR4451,  Capabilities: Router
Interface: TenGigabitEthernet1/1/1,  Port ID (outgoing port): GigabitEthernet0/0/1
-------------------------
Device ID: hq-core-sw02.corp.local
Entry address(es):
  IP address: 10.10.1.2
Platform: Juniper EX4300-48P,  Capabilities: Router Switch
Interface: TenGigabitEthernet1/1/2,  Port ID (outgoing port): xe-0/0/1
-------------------------
Device ID: hq-dist-sw01.corp.local
Entry address(es):
  IP address: 10.10.2.1
Platform: cisco C9200L-24P,  Capabilities: Switch IGMP
Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): GigabitEthernet1/0/24
-------------------------
Device ID: hq-dist-sw02.corp.local
Entry address(es):
  IP address: 10.10.2.2
Platform: Juniper EX2300-24P,  Capabilities: Switch
Interface: GigabitEthernet1/0/2,  Port ID (outgoing port): ge-0/1/0""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "hq-core-sw02",
                "ip_address": "10.10.1.2",
                "vendor": "Juniper",
                "model": "EX4300-48P",
                "os_type": "Junos 22.4R3",
                "role": "Core Switch",
                "site": "HQ-Campus (Austin)",
                "credential_id": 2,
                "lkg_config": """## Last commit: 2026-10-11 02:25:12 UTC by junos_auto
set version 22.4R3
set system host-name hq-core-sw02
set system services ssh root-login deny
set system services netconf ssh
set system login user junos_auto class super-user
set interfaces xe-0/0/0 description "UPLINK-TO-HQ-EDGE-FW01"
set interfaces xe-0/0/0 unit 0 family inet address 10.10.0.6/30
set interfaces xe-0/0/1 description "PEER-LINK-HQ-CORE-SW01"
set interfaces xe-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces xe-0/0/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set interfaces ge-0/0/1 description "DOWNLINK-HQ-DIST-SW02"
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set protocols lldp interface all
set protocols ospf area 0.0.0.0 interface xe-0/0/0.0
set vlans CORP_WORKSTATIONS vlan-id 10
set vlans VOICE_VOIP vlan-id 20
set vlans PROD_SERVERS vlan-id 30""",
                "current_config": None,
                "neighbor_raw": """Local Interface    Parent Interface    Chassis Id          Port info          System Name
xe-0/0/0           -                   00:1c:73:11:22:01   GigabitEthernet0/0/2 hq-edge-fw01
xe-0/0/1           -                   00:1c:73:11:22:02   TenGigabitEthernet1/1/2 hq-core-sw01
ge-0/0/1           -                   00:1c:73:11:22:04   ge-0/1/1           hq-dist-sw02""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "hq-dist-sw01",
                "ip_address": "10.10.2.1",
                "vendor": "Cisco",
                "model": "Catalyst C9200L-24P",
                "os_type": "Cisco IOS-XE 17.6",
                "role": "Distribution Switch",
                "site": "HQ-Campus (Austin)",
                "credential_id": 1,
                "lkg_config": """! Last configuration change at 02:30:00 UTC Sun Oct 11 2026 by netops_admin
version 17.6
service password-encryption
hostname hq-dist-sw01
!
vlan 10
 name CORP_WORKSTATIONS
vlan 20
 name VOICE_VOIP
!
interface GigabitEthernet1/0/24
 description UPLINK-HQ-CORE-SW01
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
interface GigabitEthernet1/0/1
 description DOWNLINK-HQ-ACCESS-SW01
 switchport mode trunk
 switchport trunk allowed vlan 10,20
!
interface GigabitEthernet1/0/2
 description DOWNLINK-HQ-ACCESS-SW02
 switchport mode trunk
 switchport trunk allowed vlan 10,20
!
snmp-server community NetGuard_RO_v2c RO
line vty 0 15
 transport input ssh
end""",
                "current_config": None,
                "neighbor_raw": """-------------------------
Device ID: hq-core-sw01.corp.local
Entry address(es):
  IP address: 10.10.1.1
Platform: cisco C9300-48P,  Capabilities: Router Switch
Interface: GigabitEthernet1/0/24,  Port ID (outgoing port): GigabitEthernet1/0/1
-------------------------
Device ID: hq-access-sw01.corp.local
Entry address(es):
  IP address: 10.10.3.1
Platform: Ubiquiti USW-Pro-48-PoE,  Capabilities: Switch
Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): eth49
-------------------------
Device ID: hq-access-sw02.corp.local
Entry address(es):
  IP address: 10.10.3.2
Platform: Ubiquiti USW-Pro-24-PoE,  Capabilities: Switch
Interface: GigabitEthernet1/0/2,  Port ID (outgoing port): eth25""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "hq-dist-sw02",
                "ip_address": "10.10.2.2",
                "vendor": "Juniper",
                "model": "EX2300-24P",
                "os_type": "Junos 21.4R3",
                "role": "Distribution Switch",
                "site": "HQ-Campus (Austin)",
                "credential_id": 2,
                "lkg_config": """## Last commit: 2026-10-11 02:35:00 UTC by junos_auto
set version 21.4R3
set system host-name hq-dist-sw02
set system services ssh root-login deny
set interfaces ge-0/1/0 description "UPLINK-HQ-CORE-SW01"
set interfaces ge-0/1/0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/1/0 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set interfaces ge-0/1/1 description "UPLINK-HQ-CORE-SW02"
set interfaces ge-0/1/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/1/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set interfaces ge-0/0/1 description "DOWNLINK-HQ-WLC01"
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP ]
set protocols lldp interface all
set vlans CORP_WORKSTATIONS vlan-id 10
set vlans VOICE_VOIP vlan-id 20
set vlans PROD_SERVERS vlan-id 30""",
                "current_config": """## Last commit: 2026-10-17 09:14:22 UTC by contractor_temp
set version 21.4R3
set system host-name hq-dist-sw02
set system services ssh root-login deny
set interfaces ge-0/1/0 description "UPLINK-HQ-CORE-SW01"
set interfaces ge-0/1/0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/1/0 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS UNMANAGED_IOT_BYPASS ]
set interfaces ge-0/1/1 description "UPLINK-HQ-CORE-SW02"
set interfaces ge-0/1/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/1/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set interfaces ge-0/0/1 description "DOWNLINK-HQ-WLC01"
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP UNMANAGED_IOT_BYPASS ]
set protocols lldp interface all
set vlans CORP_WORKSTATIONS vlan-id 10
set vlans VOICE_VOIP vlan-id 20
set vlans PROD_SERVERS vlan-id 30
set vlans UNMANAGED_IOT_BYPASS vlan-id 999""",
                "neighbor_raw": """Local Interface    Parent Interface    Chassis Id          Port info          System Name
ge-0/1/0           -                   00:1c:73:11:22:02   GigabitEthernet1/0/2 hq-core-sw01
ge-0/1/1           -                   00:1c:73:11:22:03   ge-0/0/1           hq-core-sw02
ge-0/0/1           -                   00:1c:73:11:22:09   eth0               hq-wlc-unifi01
ge-0/0/12          -                   00:1c:73:99:99:99   eth0               hq-shadow-ap99""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "hq-access-sw01",
                "ip_address": "10.10.3.1",
                "vendor": "Ubiquiti",
                "model": "UniFi USW-Pro-48-PoE",
                "os_type": "Ubiquiti UniFi OS 7.0",
                "role": "Access Switch",
                "site": "HQ-Campus (Austin)",
                "credential_id": 3,
                "lkg_config": """# generated by EdgeOS v2.0.9-hotfix.7 at 2026-10-11 02:40:00 UTC
set system host-name hq-access-sw01
set system login user ubnt_ops level admin
set interfaces switch switch0 description 'Floor-1 PoE Access Switch'
set interfaces switch switch0 switch-port interface eth49 vlan pvid 1
set interfaces switch switch0 switch-port interface eth49 vlan vid 10,20
set service lldp interface all
set service snmp community Ubnt_RO_Community authorization ro
set service ssh port 22""",
                "current_config": None,
                "neighbor_raw": """-------------------------------------------------------------------------------
Interface:    eth49, via: LLDP, RID: 1, Time: 14 days, 06:11:22
  Chassis:
    ChassisID:    mac 00:1c:73:11:22:05
    SysName:      hq-dist-sw01.corp.local
    SysDescr:     Cisco IOS Software, C9200L
    MgmtIP:       10.10.2.1
  Port:
    PortID:       ifname GigabitEthernet1/0/1""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "hq-access-sw02",
                "ip_address": "10.10.3.2",
                "vendor": "Ubiquiti",
                "model": "UniFi USW-Pro-24-PoE",
                "os_type": "Ubiquiti UniFi OS 7.0",
                "role": "Access Switch",
                "site": "HQ-Campus (Austin)",
                "credential_id": 3,
                "lkg_config": """# generated by EdgeOS v2.0.9-hotfix.7 at 2026-10-11 02:42:00 UTC
set system host-name hq-access-sw02
set system login user ubnt_ops level admin
set interfaces switch switch0 description 'Floor-2 Engineering PoE Switch'
set interfaces switch switch0 switch-port interface eth25 vlan pvid 1
set interfaces switch switch0 switch-port interface eth25 vlan vid 10,20
set service lldp interface all
set service snmp community Ubnt_RO_Community authorization ro
set service ssh port 22""",
                "current_config": None,
                "neighbor_raw": """-------------------------------------------------------------------------------
Interface:    eth25, via: LLDP, RID: 1, Time: 14 days, 06:11:22
  Chassis:
    ChassisID:    mac 00:1c:73:11:22:05
    SysName:      hq-dist-sw01.corp.local
    SysDescr:     Cisco IOS Software, C9200L
    MgmtIP:       10.10.2.1
  Port:
    PortID:       ifname GigabitEthernet1/0/2""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "hq-wlc-unifi01",
                "ip_address": "10.10.3.10",
                "vendor": "Ubiquiti",
                "model": "UniFi CloudKey Enterprise / UDM-Pro",
                "os_type": "Ubiquiti EdgeOS/UniFi 4.0",
                "role": "Wireless Controller",
                "site": "HQ-Campus (Austin)",
                "credential_id": 3,
                "lkg_config": """# generated by EdgeOS v2.0.9-hotfix.7 at 2026-10-11 02:45:00 UTC
set system host-name hq-wlc-unifi01
set system login user ubnt_ops level admin
set interfaces ethernet eth0 address 10.10.3.10/24
set interfaces ethernet eth0 description 'UPLINK-HQ-DIST-SW02'
set service lldp interface all
set service snmp community Ubnt_RO_Community authorization ro
set service ssh port 22""",
                "current_config": None,
                "neighbor_raw": """-------------------------------------------------------------------------------
Interface:    eth0, via: LLDP, RID: 1, Time: 21 days, 02:18:10
  Chassis:
    ChassisID:    mac 00:1c:73:11:22:04
    SysName:      hq-dist-sw02.corp.local
    SysDescr:     Juniper Networks, Inc. ex2300-24p
    MgmtIP:       10.10.2.2
  Port:
    PortID:       ifname ge-0/0/1""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "br-edge-srx01",
                "ip_address": "10.20.0.1",
                "vendor": "Juniper",
                "model": "SRX345 Services Gateway",
                "os_type": "Junos 22.4R3",
                "role": "Firewall / WAN Gateway",
                "site": "Branch-DC (Frankfurt)",
                "credential_id": 2,
                "lkg_config": """## Last commit: 2026-10-11 03:00:00 UTC by junos_auto
set version 22.4R3
set system host-name br-edge-srx01
set system services ssh root-login deny
set system services netconf ssh
set interfaces ge-0/0/0 description "WAN-EU-DECIX-UPLINK"
set interfaces ge-0/0/0 unit 0 family inet address 198.51.100.10/30
set interfaces ge-0/0/1 description "DOWNLINK-BR-CORE-SW01"
set interfaces ge-0/0/1 unit 0 family inet address 10.20.0.1/30
set interfaces st0 unit 0 description "IPSEC-VPN-TO-HQ-EDGE-FW01"
set interfaces st0 unit 0 family inet address 172.16.254.2/30
set protocols lldp interface all
set protocols ospf area 0.0.0.0 interface ge-0/0/1.0
set protocols ospf area 0.0.0.0 interface st0.0""",
                "current_config": None,
                "neighbor_raw": """Local Interface    Parent Interface    Chassis Id          Port info          System Name
st0.0              -                   00:1c:73:11:22:01   Tunnel10           hq-edge-fw01
ge-0/0/1           -                   00:1c:73:22:33:01   GigabitEthernet1/0/24 br-core-sw01""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "br-core-sw01",
                "ip_address": "10.20.1.1",
                "vendor": "Cisco",
                "model": "Catalyst C9300L-24T",
                "os_type": "Cisco IOS-XE 17.6",
                "role": "Core Switch",
                "site": "Branch-DC (Frankfurt)",
                "credential_id": 1,
                "lkg_config": """! Last configuration change at 03:05:00 UTC Sun Oct 11 2026 by netops_admin
version 17.6
service password-encryption
hostname br-core-sw01
!
vlan 100
 name EU_BRANCH_STAFF
vlan 200
 name EU_BRANCH_VOICE
!
interface GigabitEthernet1/0/24
 description UPLINK-BR-EDGE-SRX01
 ip address 10.20.0.2 255.255.255.252
!
interface GigabitEthernet1/0/1
 description DOWNLINK-BR-ACCESS-SW01
 switchport mode trunk
 switchport trunk allowed vlan 100,200
!
router ospf 10
 router-id 10.20.1.1
 network 10.20.0.0 0.0.255.255 area 0
!
snmp-server community NetGuard_RO_v2c RO
line vty 0 15
 transport input ssh
end""",
                "current_config": None,
                "neighbor_raw": """-------------------------
Device ID: br-edge-srx01.corp.local
Entry address(es):
  IP address: 10.20.0.1
Platform: Juniper SRX345,  Capabilities: Router
Interface: GigabitEthernet1/0/24,  Port ID (outgoing port): ge-0/0/1
-------------------------
Device ID: br-access-sw01.corp.local
Entry address(es):
  IP address: 10.20.2.1
Platform: Ubiquiti ES-24-250W,  Capabilities: Switch
Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): 0/25""",
                "backup_time": iso_2h_ago,
            },
            {
                "hostname": "br-access-sw01",
                "ip_address": "10.20.2.1",
                "vendor": "Ubiquiti",
                "model": "EdgeSwitch ES-24-250W",
                "os_type": "Ubiquiti EdgeOS 1.9.3",
                "role": "Access Switch",
                "site": "Branch-DC (Frankfurt)",
                "credential_id": 3,
                "lkg_config": """# generated by EdgeOS v1.9.3 at 2026-07-15 01:10:00 UTC
set system host-name br-access-sw01
set system login user ubnt_ops level admin
set interfaces switch switch0 description 'Frankfurt Branch Floor Access'
set interfaces switch switch0 switch-port interface 0/25 vlan pvid 1
set interfaces switch switch0 switch-port interface 0/25 vlan vid 100,200
set service lldp interface all
set service snmp community Ubnt_RO_Community authorization ro
set service ssh port 22""",
                "current_config": None,
                "neighbor_raw": """-------------------------------------------------------------------------------
Interface:    0/25, via: LLDP, RID: 1, Time: 94 days, 04:12:00
  Chassis:
    ChassisID:    mac 00:1c:73:22:33:01
    SysName:      br-core-sw01.corp.local
    SysDescr:     Cisco IOS Software, C9300L
    MgmtIP:       10.20.1.1
  Port:
    PortID:       ifname GigabitEthernet1/0/1""",
                "backup_time": iso_94d_ago,
            },
        ]

        all_neighbor_rows: List[Dict[str, Any]] = []

        for d in devices_seed:
            lkg_text = d["lkg_config"]
            curr_text = d["current_config"] if d["current_config"] else d["lkg_config"]
            lkg_raw_h, lkg_norm_h = compute_config_hashes(lkg_text)
            curr_raw_h, curr_norm_h = compute_config_hashes(curr_text)
            has_drift = 1 if (lkg_norm_h != curr_norm_h) else 0

            created_dev = prisma.device.create(
                {
                    "hostname": d["hostname"],
                    "ip_address": d["ip_address"],
                    "ssh_port": 22,
                    "vendor": d["vendor"],
                    "model": d["model"],
                    "os_type": d["os_type"],
                    "role": d["role"],
                    "site": d["site"],
                    "credential_id": d["credential_id"],
                    "is_simulated": 1,
                    "status": "online",
                    "drift_detected": has_drift,
                    "last_backup_at": d["backup_time"],
                    "last_verified_at": iso_2h_ago,
                    "simulated_running_config": curr_text,
                    "simulated_neighbor_raw": d["neighbor_raw"],
                    "created_at": iso_94d_ago,
                }
            )
            device_id = created_dev["id"]

            lkg_snap = prisma.config_snapshot.create(
                {
                    "device_id": device_id,
                    "version_number": 1,
                    "config_text": lkg_text,
                    "raw_hash": lkg_raw_h,
                    "normalized_hash": lkg_norm_h,
                    "size_bytes": len(lkg_text.encode("utf-8")),
                    "collected_by": "Scheduled Collector (Maintenance Window)",
                    "in_maintenance_window": 1,
                    "is_lkg": 1,
                    "notes": "Baseline Last-Known-Good (LKG) config",
                    "created_at": d["backup_time"] if not has_drift else iso_2d_ago,
                }
            )
            lkg_snap_id = lkg_snap["id"]
            latest_snap_id = lkg_snap_id

            if has_drift:
                cur_snap = prisma.config_snapshot.create(
                    {
                        "device_id": device_id,
                        "version_number": 2,
                        "config_text": curr_text,
                        "raw_hash": curr_raw_h,
                        "normalized_hash": curr_norm_h,
                        "size_bytes": len(curr_text.encode("utf-8")),
                        "collected_by": "Scheduled Collector",
                        "in_maintenance_window": 0,
                        "is_lkg": 0,
                        "notes": "Unapproved change detected outside maintenance window",
                        "created_at": d["backup_time"],
                    }
                )
                latest_snap_id = cur_snap["id"]

            prisma.device.update(
                where={"id": device_id},
                data={
                    "lkg_snapshot_id": lkg_snap_id,
                    "latest_snapshot_id": latest_snap_id,
                },
            )

            neighbors = parse_neighbor_cli_output(d["neighbor_raw"], d["vendor"])
            for n in neighbors:
                all_neighbor_rows.append(
                    {
                        "device_id": device_id,
                        "local_port": n["local_port"],
                        "remote_hostname": n["remote_hostname"],
                        "remote_port": n["remote_port"],
                        "remote_ip": n.get("remote_ip", ""),
                        "remote_platform": n.get("remote_platform", ""),
                        "protocol": n["protocol"],
                        "updated_at": iso_now,
                    }
                )

            if d["hostname"] == "hq-edge-fw01":
                prisma.alert.create(
                    {
                        "device_id": device_id,
                        "snapshot_id": latest_snap_id,
                        "severity": "CRITICAL",
                        "alert_type": "OUT_OF_WINDOW_DRIFT",
                        "title": "Unauthorized WAN ACL & Telnet Change Outside Maintenance Window",
                        "message": "hq-edge-fw01 (10.10.0.1) configuration changed outside Sunday 02:00–04:00 UTC maintenance window: permit tcp any any eq 22/23 added to WAN-INBOUND-ACL and VTY telnet enabled.",
                        "outside_maintenance_window": 1,
                        "added_lines": 3,
                        "removed_lines": 1,
                        "risk_categories": json.dumps(
                            ["Firewall / ACL Exposure", "Management / Insecure Protocol"]
                        ),
                        "acknowledged": 0,
                        "created_at": iso_2h_ago,
                    }
                )
            elif d["hostname"] == "hq-dist-sw02":
                prisma.alert.create(
                    {
                        "device_id": device_id,
                        "snapshot_id": latest_snap_id,
                        "severity": "HIGH",
                        "alert_type": "OUT_OF_WINDOW_DRIFT",
                        "title": "Unapproved VLAN 999 Trunked on Distribution Uplink Outside Window",
                        "message": "hq-dist-sw02 (10.10.2.2) modified outside maintenance window: VLAN 999 (UNMANAGED_IOT_BYPASS) added to trunk interfaces ge-0/1/0 and ge-0/0/1.",
                        "outside_maintenance_window": 1,
                        "added_lines": 3,
                        "removed_lines": 2,
                        "risk_categories": json.dumps(["VLAN / Switching / Trunking"]),
                        "acknowledged": 0,
                        "created_at": iso_2h_ago,
                    }
                )
            elif d["hostname"] == "br-access-sw01":
                prisma.alert.create(
                    {
                        "device_id": device_id,
                        "snapshot_id": latest_snap_id,
                        "severity": "WARNING",
                        "alert_type": "STALE_BACKUP",
                        "title": "Stale Backup Risk: Last Known-Good Config is 94 Days Old",
                        "message": "br-access-sw01 (10.20.2.1) in Branch-DC (Frankfurt) has not completed a scheduled config backup in 94 days. Run a live backup verification immediately.",
                        "outside_maintenance_window": 0,
                        "added_lines": 0,
                        "removed_lines": 0,
                        "risk_categories": json.dumps(["Backup Freshness / Recovery Readiness"]),
                        "acknowledged": 0,
                        "created_at": iso_6h_ago,
                    }
                )

        # Single bulk insert for all discovered LLDP/CDP neighbor links!
        prisma.neighbor_link.create_many(all_neighbor_rows)

        # 5. Bulk seed Compliance Policy Rules
        from compliance_engine import BUILTIN_COMPLIANCE_RULES

        compliance_seed = [
            {
                "rule_id": r["rule_id"],
                "name": r["name"],
                "description": r["description"],
                "severity": r["severity"],
                "vendor": r["vendor"],
                "pattern_type": r["pattern_type"],
                "pattern": r["pattern"],
                "remediation_cli": r["remediation_cli"],
                "enabled": r["enabled"],
                "created_at": iso_2d_ago,
            }
            for r in BUILTIN_COMPLIANCE_RULES
        ]
        prisma.compliance_rule.create_many(compliance_seed)

        # 6. Seed Initial Operational Audit Trail
        initial_audit_logs = [
            {
                "timestamp": iso_now,
                "action": "SYSTEM_STARTUP",
                "severity": "INFO",
                "actor": "NetGuardia Daemon",
                "target": "Fleet Core",
                "details": "NetGuardia platform online: 10 multi-vendor devices monitored across 2 sites.",
                "metadata_json": json.dumps({"devices_count": 10, "sites": 2}),
            },
            {
                "timestamp": iso_2h_ago,
                "action": "DRIFT_DETECTED",
                "severity": "CRITICAL",
                "actor": "Automated Drift Engine",
                "target": "hq-edge-fw01",
                "details": "Out-of-window drift: unauthorized Telnet enable and WAN ACL bypass detected on hq-edge-fw01.",
                "metadata_json": json.dumps({"risk": "CRITICAL", "added_lines": 3}),
            },
            {
                "timestamp": iso_6h_ago,
                "action": "BACKUP_RUN",
                "severity": "SUCCESS",
                "actor": "Scheduled Collector",
                "target": "Fleet (10 devices)",
                "details": "Scheduled fleet backup cycle completed; 9 devices verified, 1 device flagged stale.",
                "metadata_json": json.dumps({"clean": 9, "stale": 1}),
            },
        ]
        for log_entry in initial_audit_logs:
            prisma.audit_log.create(log_entry)


"""
Multi-Vendor Device Collector Engine (Real SSH via Paramiko + Built-in Multi-Vendor Lab Simulator).
Supports Cisco IOS/IOS-XE, Juniper Junos, and Ubiquiti EdgeOS/UniFi.
"""

import io
import socket
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
import paramiko

from topology_engine import parse_neighbor_cli_output


VENDOR_COMMANDS = {
    "cisco": {
        "disable_paging": "terminal length 0",
        "config": "show running-config",
        "neighbors": ["show cdp neighbors detail", "show lldp neighbors detail"],
    },
    "juniper": {
        "disable_paging": "set cli screen-length 0",
        "config": "show configuration | display set",
        "neighbors": ["show lldp neighbors"],
    },
    "ubiquiti": {
        "disable_paging": "terminal length 0",
        "config": "show configuration commands",
        "neighbors": ["lldpctl", "show lldp neighbors"],
    },
}


def _resolve_vendor_key(vendor: str) -> str:
    v = (vendor or "").lower()
    if "juniper" in v or "junos" in v:
        return "juniper"
    if "ubiquiti" in v or "unifi" in v or "edge" in v:
        return "ubiquiti"
    return "cisco"


def verify_ssh_connectivity(
    ip_address: str,
    port: int,
    username: str,
    password: Optional[str] = None,
    ssh_private_key: Optional[str] = None,
    is_simulated: bool = True,
    timeout: int = 6,
) -> Dict[str, Any]:
    """
    Verify device reachability and credential validity ("When did you last verify your backup ran?").
    Works for both simulated lab devices and real SSH hardware.
    """
    start = time.perf_counter()
    if is_simulated:
        time.sleep(0.08)
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        if not username:
            return {
                "reachable": False,
                "authenticated": False,
                "latency_ms": latency_ms,
                "message": "Verification failed: No vault credential assigned to device.",
            }
        return {
            "reachable": True,
            "authenticated": True,
            "latency_ms": latency_ms,
            "message": f"Authenticated via Simulated SSH ({username}@{ip_address}:{port}) in {latency_ms}ms.",
        }

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        pkey = None
        if ssh_private_key:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(ssh_private_key))
        client.connect(
            hostname=ip_address,
            port=port or 22,
            username=username,
            password=password,
            pkey=pkey,
            timeout=timeout,
            look_for_keys=False,
            allow_agent=False,
        )
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        client.close()
        return {
            "reachable": True,
            "authenticated": True,
            "latency_ms": latency_ms,
            "message": f"SSH handshake & authentication succeeded ({username}@{ip_address}:{port}) in {latency_ms}ms.",
        }
    except paramiko.AuthenticationException as exc:
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        return {
            "reachable": True,
            "authenticated": False,
            "latency_ms": latency_ms,
            "message": f"TCP reachable, but SSH authentication failed: {exc}",
        }
    except (socket.timeout, socket.error, Exception) as exc:
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        return {
            "reachable": False,
            "authenticated": False,
            "latency_ms": latency_ms,
            "message": f"Connection failed to {ip_address}:{port} — {exc}",
        }
    finally:
        try:
            client.close()
        except Exception:
            pass


def collect_from_real_device(
    device: Dict[str, Any],
    credential: Dict[str, Any],
    timeout: int = 12,
) -> Tuple[str, List[Dict[str, str]], str]:
    """
    Connect to a real network device over SSH using Paramiko, pull its running config
    and LLDP/CDP neighbor tables, and return (running_config, parsed_neighbors, raw_neighbor_output).
    """
    vendor_key = _resolve_vendor_key(device.get("vendor", "Cisco"))
    cmds = VENDOR_COMMANDS[vendor_key]

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    pkey = None
    if credential.get("ssh_private_key"):
        pkey = paramiko.RSAKey.from_private_key(io.StringIO(credential["ssh_private_key"]))

    try:
        client.connect(
            hostname=device["ip_address"],
            port=device.get("ssh_port") or 22,
            username=credential["username"],
            password=credential.get("password"),
            pkey=pkey,
            timeout=timeout,
            look_for_keys=False,
            allow_agent=False,
        )

        def run_cmd(command: str) -> str:
            _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            return out if out.strip() else err

        # Run config collection
        config_text = run_cmd(cmds["config"])
        neighbor_outputs: List[str] = []
        for n_cmd in cmds["neighbors"]:
            try:
                n_out = run_cmd(n_cmd)
                if n_out.strip():
                    neighbor_outputs.append(n_out)
            except Exception:
                pass

        combined_neighbor_raw = "\n".join(neighbor_outputs)
        parsed_neighbors = parse_neighbor_cli_output(combined_neighbor_raw, device.get("vendor"))
        return config_text, parsed_neighbors, combined_neighbor_raw
    finally:
        try:
            client.close()
        except Exception:
            pass


def refresh_simulated_volatile_headers(config_text: str, vendor: str) -> str:
    """
    Simulate how real network gear updates volatile headers (clock period, NVRAM timestamp)
    every time `show running-config` is polled, testing our Noise Filter!
    """
    now_str = datetime.now(timezone.utc).strftime("%H:%M:%S UTC %a %b %d %Y")
    v = _resolve_vendor_key(vendor)
    lines = config_text.splitlines()
    updated: List[str] = []
    replaced_ts = False
    for line in lines:
        if v == "cisco" and line.startswith("! Last configuration change at"):
            updated.append(f"! Last configuration change at {now_str} by netops")
            replaced_ts = True
        elif v == "juniper" and line.startswith("## Last commit:"):
            updated.append(f"## Last commit: {now_str} by netops")
            replaced_ts = True
        elif v == "ubiquiti" and line.startswith("# generated by"):
            updated.append(f"# generated by EdgeOS v2.0.9-hotfix.7 at {now_str}")
            replaced_ts = True
        else:
            updated.append(line)

    if not replaced_ts:
        if v == "cisco":
            updated.insert(0, f"! Last configuration change at {now_str} by netops")
        elif v == "juniper":
            updated.insert(0, f"## Last commit: {now_str} by netops")
        else:
            updated.insert(0, f"# generated by EdgeOS v2.0.9-hotfix.7 at {now_str}")

    return "\n".join(updated)


DRIFT_SCENARIOS = {
    "rogue_acl": {
        "title": "Unauthorized WAN SSH/Telnet ACL Exposure",
        "description": "Simulates an ad-hoc firewall/ACL change opening TCP port 22/23 from 0.0.0.0/0 outside a maintenance window.",
    },
    "ospf_route_leak": {
        "title": "Unapproved Routing / OSPF Metric & Static Route Change",
        "description": "Simulates an engineer modifying OSPF interface cost and inserting a static default route override.",
    },
    "backdoor_user": {
        "title": "Privilege 15 Local Account & RW SNMP Community Added",
        "description": "Simulates creation of an undocumented admin user and read-write SNMP community string.",
    },
    "vlan_trunk_drift": {
        "title": "Core Trunk Allowed VLAN Modification",
        "description": "Simulates adding guest VLAN 999 onto an uplink trunk port without change approval.",
    },
}


def apply_simulated_drift_to_config(
    base_config: str,
    vendor: str,
    scenario: str = "rogue_acl",
) -> Tuple[str, str]:
    """
    Mutate a device's configuration according to a realistic drift scenario.
    Returns (mutated_config, human_summary).
    """
    v = _resolve_vendor_key(vendor)
    lines = base_config.rstrip().splitlines()

    if scenario == "rogue_acl":
        if v == "cisco":
            lines.extend(
                [
                    "!",
                    "ip access-list extended WAN-INBOUND-ACL",
                    " permit tcp any any eq 22 log",
                    " permit tcp any any eq 23",
                    " permit ip 198.51.100.0 0.0.0.255 any",
                ]
            )
        elif v == "juniper":
            lines.extend(
                [
                    "set security policies from-zone untrust to-zone trust policy TEMP-DEBUG match source-address any",
                    "set security policies from-zone untrust to-zone trust policy TEMP-DEBUG match destination-address any",
                    "set security policies from-zone untrust to-zone trust policy TEMP-DEBUG match application junos-ssh",
                    "set security policies from-zone untrust to-zone trust policy TEMP-DEBUG then permit",
                ]
            )
        else:
            lines.extend(
                [
                    "set firewall name WAN_IN rule 99 action accept",
                    "set firewall name WAN_IN rule 99 description 'TEMP HOTFIX OPEN SSH'",
                    "set firewall name WAN_IN rule 99 destination port 22,23",
                    "set firewall name WAN_IN rule 99 protocol tcp",
                ]
            )
        return "\n".join(lines), "Opened inbound TCP/22 & TCP/23 from any source (0.0.0.0/0)"

    if scenario == "ospf_route_leak":
        if v == "cisco":
            lines.extend(
                [
                    "!",
                    "router ospf 10",
                    " network 172.31.250.0 0.0.0.255 area 0",
                    "ip route 0.0.0.0 0.0.0.0 10.254.254.1 name ADHOC-FAILOVER",
                ]
            )
        elif v == "juniper":
            lines.extend(
                [
                    "set protocols ospf area 0.0.0.0 interface ge-0/0/1.0 metric 500",
                    "set routing-options static route 172.31.250.0/24 next-hop 10.254.254.1",
                ]
            )
        else:
            lines.extend(
                [
                    "set protocols ospf area 0.0.0.0 network 172.31.250.0/24",
                    "set protocols static route 0.0.0.0/0 next-hop 10.254.254.1 distance 5",
                ]
            )
        return "\n".join(lines), "Injected unapproved OSPF network & static route override"

    if scenario == "backdoor_user":
        if v == "cisco":
            lines.extend(
                [
                    "!",
                    "username contractor_temp privilege 15 secret 9 $9$tempContractorHash",
                    "snmp-server community public_rw RW",
                    "line vty 0 4",
                    " transport input telnet ssh",
                ]
            )
        elif v == "juniper":
            lines.extend(
                [
                    "set system login user contractor_temp class super-user",
                    "set snmp community public_rw authorization read-write",
                ]
            )
        else:
            lines.extend(
                [
                    "set system login user contractor_temp level admin",
                    "set service snmp community public_rw authorization rw",
                ]
            )
        return "\n".join(lines), "Added privilege-15 user 'contractor_temp' and RW SNMP community"

    # Default: vlan_trunk_drift
    if v == "cisco":
        lines.extend(
            [
                "!",
                "vlan 999",
                " name UNMANAGED_IOT_BYPASS",
                "interface GigabitEthernet1/0/1",
                " switchport trunk allowed vlan add 999",
            ]
        )
    elif v == "juniper":
        lines.extend(
            [
                "set vlans UNMANAGED_IOT_BYPASS vlan-id 999",
                "set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members 999",
            ]
        )
    else:
        lines.extend(
            [
                "set interfaces switch switch0 switch-port interface eth2 vlan vid 999",
            ]
        )
    return "\n".join(lines), "Added VLAN 999 (UNMANAGED_IOT_BYPASS) to core trunk interface"

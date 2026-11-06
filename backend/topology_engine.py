"""
LLDP / CDP Multi-Vendor Neighbor Parser & Automated Dependency / Blast-Radius Graph Engine.
Parses raw CLI output from Cisco IOS/XE (CDP & LLDP), Juniper Junos (LLDP), and Ubiquiti EdgeOS/UniFi (LLDP)
to construct a full layer-2/layer-3 network topology and calculate downstream blast radius on device failure.
"""

import re
from collections import deque
from typing import Any, Dict, List, Optional, Set, Tuple


def parse_cisco_cdp_detail(raw_output: str) -> List[Dict[str, str]]:
    """
    Parse Cisco `show cdp neighbors detail` output into structured neighbor records.
    """
    neighbors: List[Dict[str, str]] = []
    if not raw_output:
        return neighbors

    blocks = re.split(r"-{10,}", raw_output)
    for block in blocks:
        dev_match = re.search(r"Device ID:\s*([^\r\n(]+)", block, re.IGNORECASE)
        if not dev_match:
            continue
        remote_host = dev_match.group(1).strip().split(".")[0]
        ip_match = re.search(r"IP(?:v4)? address:\s*(\d+\.\d+\.\d+\.\d+)", block, re.IGNORECASE)
        platform_match = re.search(
            r"Platform:\s*([^,\r\n]+)(?:,\s*Capabilities:\s*([^\r\n]+))?",
            block,
            re.IGNORECASE,
        )
        intf_match = re.search(
            r"Interface:\s*([^,\r\n]+),\s*Port ID \(outgoing port\):\s*([^\r\n]+)",
            block,
            re.IGNORECASE,
        )
        neighbors.append(
            {
                "remote_hostname": remote_host,
                "remote_ip": ip_match.group(1).strip() if ip_match else "",
                "remote_platform": platform_match.group(1).strip() if platform_match else "Cisco Device",
                "capabilities": platform_match.group(2).strip() if (platform_match and platform_match.group(2)) else "Switch",
                "local_port": intf_match.group(1).strip() if intf_match else "Gi0/0",
                "remote_port": intf_match.group(2).strip() if intf_match else "Gi0/0",
                "protocol": "CDP",
            }
        )
    return neighbors


def parse_cisco_lldp_detail(raw_output: str) -> List[Dict[str, str]]:
    """
    Parse Cisco `show lldp neighbors detail` output into structured neighbor records.
    """
    neighbors: List[Dict[str, str]] = []
    if not raw_output:
        return neighbors

    blocks = re.split(r"-{10,}", raw_output)
    for block in blocks:
        sys_match = re.search(r"System Name:\s*([^\r\n]+)", block, re.IGNORECASE)
        if not sys_match:
            continue
        remote_host = sys_match.group(1).strip().split(".")[0]
        local_match = re.search(r"Local Intf:\s*([^\r\n]+)", block, re.IGNORECASE)
        port_match = re.search(r"Port id:\s*([^\r\n]+)", block, re.IGNORECASE)
        desc_match = re.search(r"System Description:\s*\r?\n?\s*([^\r\n]+)", block, re.IGNORECASE)
        ip_match = re.search(r"IP:\s*(\d+\.\d+\.\d+\.\d+)", block, re.IGNORECASE)

        neighbors.append(
            {
                "remote_hostname": remote_host,
                "remote_ip": ip_match.group(1).strip() if ip_match else "",
                "remote_platform": desc_match.group(1).strip()[:50] if desc_match else "LLDP Peer",
                "capabilities": "Bridge, Router",
                "local_port": local_match.group(1).strip() if local_match else "Gi0/1",
                "remote_port": port_match.group(1).strip() if port_match else "eth0",
                "protocol": "LLDP",
            }
        )
    return neighbors


def parse_juniper_lldp_table(raw_output: str) -> List[Dict[str, str]]:
    """
    Parse Juniper Junos `show lldp neighbors` tabular output:
    Local Interface    Parent Interface    Chassis Id          Port info          System Name
    ge-0/0/0           ae0                 00:1c:73:aa:bb:01   Gi1/0/24           hq-core-sw01
    """
    neighbors: List[Dict[str, str]] = []
    if not raw_output:
        return neighbors

    for line in raw_output.splitlines():
        stripped = line.strip()
        if not stripped or stripped.lower().startswith("local interface") or stripped.startswith("-"):
            continue
        parts = re.split(r"\s{2,}|\t+", stripped)
        if len(parts) >= 5:
            local_intf, _parent, _chassis, remote_port, sys_name = (
                parts[0],
                parts[1],
                parts[2],
                parts[3],
                parts[4],
            )
            neighbors.append(
                {
                    "remote_hostname": sys_name.strip().split(".")[0],
                    "remote_ip": "",
                    "remote_platform": "Junos / LLDP Peer",
                    "capabilities": "Bridge, Router",
                    "local_port": local_intf.strip(),
                    "remote_port": remote_port.strip(),
                    "protocol": "LLDP",
                }
            )
    return neighbors


def parse_ubiquiti_lldp(raw_output: str) -> List[Dict[str, str]]:
    """
    Parse Ubiquiti EdgeOS / UniFi `lldpctl` or `show lldp neighbors` output.
    Supports both block-style lldpctl and tabular `show lldp neighbors`.
    """
    neighbors: List[Dict[str, str]] = []
    if not raw_output:
        return neighbors

    # Check if block-style lldpctl output ("Interface: eth0, via: LLDP...")
    if "Interface:" in raw_output and "SysName:" in raw_output:
        blocks = re.split(r"-{10,}", raw_output)
        for block in blocks:
            intf_match = re.search(r"Interface:\s*([^,\r\n]+)", block, re.IGNORECASE)
            sys_match = re.search(r"SysName:\s*([^\r\n]+)", block, re.IGNORECASE)
            port_match = re.search(r"PortID:\s*(?:ifname\s+)?([^\r\n]+)", block, re.IGNORECASE)
            descr_match = re.search(r"SysDescr:\s*([^\r\n]+)", block, re.IGNORECASE)
            ip_match = re.search(r"MgmtIP:\s*(\d+\.\d+\.\d+\.\d+)", block, re.IGNORECASE)
            if intf_match and sys_match:
                neighbors.append(
                    {
                        "remote_hostname": sys_match.group(1).strip().split(".")[0],
                        "remote_ip": ip_match.group(1).strip() if ip_match else "",
                        "remote_platform": descr_match.group(1).strip()[:50] if descr_match else "Ubiquiti / LLDP",
                        "capabilities": "Bridge, Router, WLAN",
                        "local_port": intf_match.group(1).strip(),
                        "remote_port": port_match.group(1).strip() if port_match else "eth0",
                        "protocol": "LLDP",
                    }
                )
        return neighbors

    # Fallback to tabular parser
    return parse_juniper_lldp_table(raw_output)


def parse_neighbor_cli_output(raw_output: str, vendor: Optional[str] = None) -> List[Dict[str, str]]:
    """
    Auto-detect and parse raw CLI output from CDP or LLDP across Cisco, Juniper, and Ubiquiti.
    """
    if not raw_output or not raw_output.strip():
        return []

    results: List[Dict[str, str]] = []
    if "Device ID:" in raw_output and "Port ID (outgoing port):" in raw_output:
        results.extend(parse_cisco_cdp_detail(raw_output))
    if "System Name:" in raw_output and "Local Intf:" in raw_output:
        results.extend(parse_cisco_lldp_detail(raw_output))
    if "Interface:" in raw_output and "SysName:" in raw_output:
        results.extend(parse_ubiquiti_lldp(raw_output))
    if not results:
        results.extend(parse_juniper_lldp_table(raw_output))
    return results


def _role_to_tier(role: str) -> int:
    role_lower = (role or "").lower()
    if "firewall" in role_lower or "gateway" in role_lower or "router" in role_lower or "wan" in role_lower:
        return 0
    if "core" in role_lower:
        return 1
    if "dist" in role_lower or "agg" in role_lower:
        return 2
    return 3


def build_topology_graph(
    devices: List[Dict[str, Any]],
    neighbor_records: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Build a complete deduplicated topology graph from managed devices and their LLDP/CDP neighbor tables.
    Also surfaces unmanaged/shadow neighbors discovered via LLDP/CDP.
    """
    nodes_by_hostname: Dict[str, Dict[str, Any]] = {}
    nodes_by_id: Dict[int, Dict[str, Any]] = {}

    for dev in devices:
        hostname_key = dev["hostname"].lower()
        node = {
            "id": f"dev-{dev['id']}",
            "device_id": dev["id"],
            "hostname": dev["hostname"],
            "ip_address": dev["ip_address"],
            "vendor": dev["vendor"],
            "model": dev["model"],
            "os_type": dev["os_type"],
            "role": dev["role"],
            "site": dev["site"],
            "tier": _role_to_tier(dev["role"]),
            "status": dev["status"],
            "drift_detected": bool(dev.get("drift_detected", False)),
            "has_lkg": bool(dev.get("lkg_snapshot_id")),
            "last_backup_at": dev.get("last_backup_at"),
            "is_managed": True,
        }
        nodes_by_hostname[hostname_key] = node
        nodes_by_id[dev["id"]] = node

    edges: List[Dict[str, Any]] = []
    seen_edge_keys: Set[Tuple[str, str, str, str]] = set()

    for rec in neighbor_records:
        local_dev_id = rec["device_id"]
        if local_dev_id not in nodes_by_id:
            continue
        source_node = nodes_by_id[local_dev_id]
        remote_hostname = (rec.get("remote_hostname") or "").strip()
        if not remote_hostname:
            continue

        remote_key = remote_hostname.lower()
        if remote_key not in nodes_by_hostname:
            # Create an unmanaged discovered node (e.g., shadow AP or unmonitored switch)
            shadow_id = f"unmanaged-{remote_key}"
            nodes_by_hostname[remote_key] = {
                "id": shadow_id,
                "device_id": None,
                "hostname": remote_hostname,
                "ip_address": rec.get("remote_ip") or "Discovered via " + rec.get("protocol", "LLDP"),
                "vendor": rec.get("remote_platform") or "Discovered Peer",
                "model": rec.get("remote_platform") or "Unmanaged Device",
                "os_type": "Unmanaged",
                "role": "discovered",
                "site": source_node["site"],
                "tier": min(3, source_node["tier"] + 1),
                "status": "unmanaged",
                "drift_detected": False,
                "has_lkg": False,
                "last_backup_at": None,
                "is_managed": False,
            }

        target_node = nodes_by_hostname[remote_key]
        src_id = source_node["id"]
        dst_id = target_node["id"]
        local_port = rec.get("local_port") or "eth0"
        remote_port = rec.get("remote_port") or "eth0"
        protocol = rec.get("protocol") or "LLDP"

        # Canonical edge key so A:Gi0/1 <-> B:Gi0/2 isn't duplicated
        if (src_id, local_port) <= (dst_id, remote_port):
            edge_key = (src_id, local_port, dst_id, remote_port)
        else:
            edge_key = (dst_id, remote_port, src_id, local_port)

        if edge_key in seen_edge_keys:
            continue
        seen_edge_keys.add(edge_key)

        edges.append(
            {
                "id": f"link-{len(edges) + 1}",
                "source": src_id,
                "target": dst_id,
                "source_hostname": source_node["hostname"],
                "target_hostname": target_node["hostname"],
                "source_port": local_port,
                "target_port": remote_port,
                "protocol": protocol,
                "site": source_node["site"],
            }
        )

    node_list = list(nodes_by_hostname.values())
    return {
        "nodes": node_list,
        "edges": edges,
        "stats": {
            "total_nodes": len(node_list),
            "managed_nodes": sum(1 for n in node_list if n["is_managed"]),
            "unmanaged_discovered_nodes": sum(1 for n in node_list if not n["is_managed"]),
            "total_links": len(edges),
            "cdp_links": sum(1 for e in edges if e["protocol"] == "CDP"),
            "lldp_links": sum(1 for e in edges if e["protocol"] == "LLDP"),
        },
    }


def analyze_blast_radius(
    graph: Dict[str, Any],
    failed_node_id: str,
) -> Dict[str, Any]:
    """
    Simulate failure of `failed_node_id` and compute its downstream blast radius:
    1. Finds all root gateway/WAN nodes (tier 0) per site.
    2. Computes which nodes were reachable from any root gateway BEFORE the failure.
    3. Removes `failed_node_id` and recomputes reachability from remaining root gateways.
    4. Any node that loses connectivity to all root gateways is marked as `isolated_downstream`.
    5. Direct neighbors of `failed_node_id` that retain redundant paths are marked as `degraded_redundant`.
    """
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    if failed_node_id not in nodes:
        return {
            "failed_node_id": failed_node_id,
            "isolated_nodes": [],
            "degraded_nodes": [],
            "affected_edges": [],
            "impact_summary": "Node not found in topology.",
        }

    failed_node = nodes[failed_node_id]
    adj: Dict[str, Set[str]] = {nid: set() for nid in nodes}
    affected_edges: List[str] = []

    for edge in graph.get("edges", []):
        u, v = edge["source"], edge["target"]
        if u in adj and v in adj:
            adj[u].add(v)
            adj[v].add(u)
        if u == failed_node_id or v == failed_node_id:
            affected_edges.append(edge["id"])

    # Identify root gateway nodes (tier 0: Firewall / WAN Router)
    root_ids = [nid for nid, n in nodes.items() if n.get("tier") == 0]
    if not root_ids:
        # Fallback to lowest tier available
        min_tier = min((n.get("tier", 3) for n in nodes.values()), default=0)
        root_ids = [nid for nid, n in nodes.items() if n.get("tier") == min_tier]

    def get_reachable(roots: List[str], blocked: Optional[str] = None) -> Set[str]:
        visited: Set[str] = set()
        queue: deque[str] = deque()
        for r in roots:
            if r != blocked and r in nodes:
                visited.add(r)
                queue.append(r)
        while queue:
            curr = queue.popleft()
            for nxt in adj.get(curr, set()):
                if nxt != blocked and nxt not in visited:
                    visited.add(nxt)
                    queue.append(nxt)
        return visited

    reachable_before = get_reachable(root_ids, blocked=None)
    reachable_after = get_reachable(root_ids, blocked=failed_node_id)

    isolated_ids = sorted(
        [nid for nid in reachable_before if nid != failed_node_id and nid not in reachable_after]
    )
    direct_neighbors = adj.get(failed_node_id, set())
    degraded_ids = sorted([nid for nid in direct_neighbors if nid in reachable_after])

    isolated_hostnames = [nodes[nid]["hostname"] for nid in isolated_ids]
    degraded_hostnames = [nodes[nid]["hostname"] for nid in degraded_ids]

    recovery_readiness = (
        "READY (Verified Last-Known-Good config available for rapid restore)"
        if failed_node.get("has_lkg") and not failed_node.get("drift_detected")
        else (
            "WARNING (Config has unverified drift from Last-Known-Good)"
            if failed_node.get("has_lkg")
            else "CRITICAL RISK (No Last-Known-Good backup pinned!)"
        )
    )

    return {
        "failed_node_id": failed_node_id,
        "failed_hostname": failed_node["hostname"],
        "failed_role": failed_node["role"],
        "failed_site": failed_node["site"],
        "isolated_nodes": isolated_ids,
        "isolated_hostnames": isolated_hostnames,
        "degraded_nodes": degraded_ids,
        "degraded_hostnames": degraded_hostnames,
        "affected_edges": affected_edges,
        "recovery_readiness": recovery_readiness,
        "total_impacted_devices": len(isolated_ids) + len(degraded_ids),
    }

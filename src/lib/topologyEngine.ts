export interface NeighborRecord {
  remote_hostname: string;
  remote_ip: string;
  remote_platform: string;
  capabilities?: string;
  local_port: string;
  remote_port: string;
  protocol: string;
}

export function parseCiscoCdpDetail(rawOutput: string): NeighborRecord[] {
  const neighbors: NeighborRecord[] = [];
  if (!rawOutput) return neighbors;

  const blocks = rawOutput.split(/-{10,}/);
  for (const block of blocks) {
    const devMatch = block.match(/Device ID:\s*([^\r\n(]+)/i);
    if (!devMatch) continue;

    const remoteHost = devMatch[1].trim().split('.')[0];
    const ipMatch = block.match(/IP(?:v4)? address:\s*(\d+\.\d+\.\d+\.\d+)/i);
    const platformMatch = block.match(/Platform:\s*([^,\r\n]+)(?:,\s*Capabilities:\s*([^\r\n]+))?/i);
    const intfMatch = block.match(/Interface:\s*([^,\r\n]+),\s*Port ID \(outgoing port\):\s*([^\r\n]+)/i);

    neighbors.push({
      remote_hostname: remoteHost,
      remote_ip: ipMatch ? ipMatch[1].trim() : '',
      remote_platform: platformMatch ? platformMatch[1].trim() : 'Cisco Device',
      capabilities: platformMatch && platformMatch[2] ? platformMatch[2].trim() : 'Switch',
      local_port: intfMatch ? intfMatch[1].trim() : 'Gi0/0',
      remote_port: intfMatch ? intfMatch[2].trim() : 'Gi0/0',
      protocol: 'CDP',
    });
  }
  return neighbors;
}

export function parseCiscoLldpDetail(rawOutput: string): NeighborRecord[] {
  const neighbors: NeighborRecord[] = [];
  if (!rawOutput) return neighbors;

  const blocks = rawOutput.split(/-{10,}/);
  for (const block of blocks) {
    const sysMatch = block.match(/System Name:\s*([^\r\n]+)/i);
    if (!sysMatch) continue;

    const remoteHost = sysMatch[1].trim().split('.')[0];
    const localMatch = block.match(/Local Intf:\s*([^\r\n]+)/i);
    const portMatch = block.match(/Port id:\s*([^\r\n]+)/i);
    const descMatch = block.match(/System Description:\s*\r?\n?\s*([^\r\n]+)/i);
    const ipMatch = block.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/i);

    neighbors.push({
      remote_hostname: remoteHost,
      remote_ip: ipMatch ? ipMatch[1].trim() : '',
      remote_platform: descMatch ? descMatch[1].trim().slice(0, 50) : 'LLDP Peer',
      capabilities: 'Bridge, Router',
      local_port: localMatch ? localMatch[1].trim() : 'Gi0/1',
      remote_port: portMatch ? portMatch[1].trim() : 'eth0',
      protocol: 'LLDP',
    });
  }
  return neighbors;
}

export function parseJuniperLldpTable(rawOutput: string): NeighborRecord[] {
  const neighbors: NeighborRecord[] = [];
  if (!rawOutput) return neighbors;

  const lines = rawOutput.split(/\r?\n/);
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || stripped.toLowerCase().startsWith('local interface') || stripped.startsWith('-')) {
      continue;
    }
    const parts = stripped.split(/\s{2,}|\t+/);
    if (parts.length >= 5) {
      const localIntf = parts[0];
      const remotePort = parts[3];
      const sysName = parts[4];

      neighbors.push({
        remote_hostname: sysName.trim().split('.')[0],
        remote_ip: '',
        remote_platform: 'Junos / LLDP Peer',
        capabilities: 'Bridge, Router',
        local_port: localIntf.trim(),
        remote_port: remotePort.trim(),
        protocol: 'LLDP',
      });
    }
  }
  return neighbors;
}

export function parseUbiquitiLldp(rawOutput: string): NeighborRecord[] {
  const neighbors: NeighborRecord[] = [];
  if (!rawOutput) return neighbors;

  if (rawOutput.includes('Interface:') && rawOutput.includes('SysName:')) {
    const blocks = rawOutput.split(/-{10,}/);
    for (const block of blocks) {
      const intfMatch = block.match(/Interface:\s*([^,\r\n]+)/i);
      const sysMatch = block.match(/SysName:\s*([^\r\n]+)/i);
      const portMatch = block.match(/PortID:\s*(?:ifname\s+)?([^\r\n]+)/i);
      const descrMatch = block.match(/SysDescr:\s*([^\r\n]+)/i);
      const ipMatch = block.match(/MgmtIP:\s*(\d+\.\d+\.\d+\.\d+)/i);

      if (intfMatch && sysMatch) {
        neighbors.push({
          remote_hostname: sysMatch[1].trim().split('.')[0],
          remote_ip: ipMatch ? ipMatch[1].trim() : '',
          remote_platform: descrMatch ? descrMatch[1].trim().slice(0, 50) : 'Ubiquiti / LLDP',
          capabilities: 'Bridge, Router, WLAN',
          local_port: intfMatch[1].trim(),
          remote_port: portMatch ? portMatch[1].trim() : 'eth0',
          protocol: 'LLDP',
        });
      }
    }
    return neighbors;
  }

  return parseJuniperLldpTable(rawOutput);
}

export function parseNeighborCliOutput(rawOutput: string, _vendor?: string): NeighborRecord[] {
  if (!rawOutput || !rawOutput.trim()) {
    return [];
  }

  const results: NeighborRecord[] = [];
  if (rawOutput.includes('Device ID:') && rawOutput.includes('Port ID (outgoing port):')) {
    results.push(...parseCiscoCdpDetail(rawOutput));
  }
  if (rawOutput.includes('System Name:') && rawOutput.includes('Local Intf:')) {
    results.push(...parseCiscoLldpDetail(rawOutput));
  }
  if (rawOutput.includes('Interface:') && rawOutput.includes('SysName:')) {
    results.push(...parseUbiquitiLldp(rawOutput));
  }
  if (results.length === 0) {
    results.push(...parseJuniperLldpTable(rawOutput));
  }
  return results;
}

export function roleToTier(role: string): number {
  const r = (role || '').toLowerCase();
  if (r.includes('firewall') || r.includes('gateway') || r.includes('router') || r.includes('wan')) {
    return 0;
  }
  if (r.includes('core')) {
    return 1;
  }
  if (r.includes('dist') || r.includes('agg')) {
    return 2;
  }
  return 3;
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
  protocol: string;
  site: string;
}

export interface TopologyGraphResult {
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

export function buildTopologyGraph(
  devices: Array<{
    id: number;
    hostname: string;
    ip_address: string;
    vendor: string;
    model: string;
    os_type: string;
    role: string;
    site: string;
    status: string;
    drift_detected?: number | boolean;
    lkg_snapshot_id?: number | null;
    last_backup_at?: string | null;
  }>,
  neighborRecords: Array<{
    device_id: number;
    local_port: string;
    remote_hostname: string;
    remote_port: string;
    remote_ip?: string | null;
    remote_platform?: string | null;
    protocol: string;
  }>
): TopologyGraphResult {
  const nodesByHostname: Record<string, TopologyNode> = {};
  const nodesById: Record<number, TopologyNode> = {};

  for (const dev of devices) {
    const hostnameKey = dev.hostname.toLowerCase();
    const node: TopologyNode = {
      id: `dev-${dev.id}`,
      device_id: dev.id,
      hostname: dev.hostname,
      ip_address: dev.ip_address,
      vendor: dev.vendor,
      model: dev.model,
      os_type: dev.os_type,
      role: dev.role,
      site: dev.site,
      tier: roleToTier(dev.role),
      status: dev.status,
      drift_detected: Boolean(dev.drift_detected),
      has_lkg: Boolean(dev.lkg_snapshot_id),
      last_backup_at: dev.last_backup_at || null,
      is_managed: true,
    };
    nodesByHostname[hostnameKey] = node;
    nodesById[dev.id] = node;
  }

  const edges: TopologyEdge[] = [];
  const seenEdgeKeys = new Set<string>();

  for (const rec of neighborRecords) {
    const sourceNode = nodesById[rec.device_id];
    if (!sourceNode) continue;

    const remoteHostname = (rec.remote_hostname || '').trim();
    if (!remoteHostname) continue;

    const remoteKey = remoteHostname.toLowerCase();
    if (!nodesByHostname[remoteKey]) {
      // Unmanaged discovered shadow node
      const shadowId = `unmanaged-${remoteKey}`;
      nodesByHostname[remoteKey] = {
        id: shadowId,
        device_id: null,
        hostname: remoteHostname,
        ip_address: rec.remote_ip || `Discovered via ${rec.protocol || 'LLDP'}`,
        vendor: rec.remote_platform || 'Discovered Peer',
        model: rec.remote_platform || 'Unmanaged Device',
        os_type: 'Unmanaged',
        role: 'discovered',
        site: sourceNode.site,
        tier: Math.min(3, sourceNode.tier + 1),
        status: 'unmanaged',
        drift_detected: false,
        has_lkg: false,
        last_backup_at: null,
        is_managed: false,
      };
    }

    const targetNode = nodesByHostname[remoteKey];
    const srcId = sourceNode.id;
    const dstId = targetNode.id;
    const localPort = rec.local_port || 'eth0';
    const remotePort = rec.remote_port || 'eth0';
    const protocol = rec.protocol || 'LLDP';

    const edgeKey =
      srcId < dstId
        ? `${srcId}|${localPort}|${dstId}|${remotePort}`
        : `${dstId}|${remotePort}|${srcId}|${localPort}`;

    if (seenEdgeKeys.has(edgeKey)) continue;
    seenEdgeKeys.add(edgeKey);

    edges.push({
      id: `link-${edges.length + 1}`,
      source: srcId,
      target: dstId,
      source_hostname: sourceNode.hostname,
      target_hostname: targetNode.hostname,
      source_port: localPort,
      target_port: remotePort,
      protocol,
      site: sourceNode.site,
    });
  }

  const nodeList = Object.values(nodesByHostname);
  return {
    nodes: nodeList,
    edges,
    stats: {
      total_nodes: nodeList.length,
      managed_nodes: nodeList.filter((n) => n.is_managed).length,
      unmanaged_discovered_nodes: nodeList.filter((n) => !n.is_managed).length,
      total_links: edges.length,
      cdp_links: edges.filter((e) => e.protocol === 'CDP').length,
      lldp_links: edges.filter((e) => e.protocol === 'LLDP').length,
    },
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
  impact_summary?: string;
}

export function analyzeBlastRadius(
  graph: TopologyGraphResult,
  failedNodeId: string
): BlastRadiusResult {
  const nodes = new Map<string, TopologyNode>(graph.nodes.map((n) => [n.id, n]));
  const failedNode = nodes.get(failedNodeId);

  if (!failedNode) {
    return {
      failed_node_id: failedNodeId,
      failed_hostname: failedNodeId,
      failed_role: 'Unknown',
      failed_site: 'Unknown',
      isolated_nodes: [],
      isolated_hostnames: [],
      degraded_nodes: [],
      degraded_hostnames: [],
      affected_edges: [],
      recovery_readiness: 'Node not found in topology.',
      total_impacted_devices: 0,
      impact_summary: 'Node not found in topology.',
    };
  }

  const adj = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    adj.set(n.id, new Set<string>());
  }

  const affectedEdges: string[] = [];
  for (const edge of graph.edges) {
    const { source, target } = edge;
    if (adj.has(source) && adj.has(target)) {
      adj.get(source)!.add(target);
      adj.get(target)!.add(source);
    }
    if (source === failedNodeId || target === failedNodeId) {
      affectedEdges.push(edge.id);
    }
  }

  // Identify root gateway nodes (tier 0)
  let rootIds = graph.nodes.filter((n) => n.tier === 0).map((n) => n.id);
  if (rootIds.length === 0) {
    const minTier = Math.min(...graph.nodes.map((n) => n.tier));
    rootIds = graph.nodes.filter((n) => n.tier === minTier).map((n) => n.id);
  }

  function getReachable(roots: string[], blocked: string | null = null): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = [];

    for (const r of roots) {
      if (r !== blocked && nodes.has(r)) {
        visited.add(r);
        queue.push(r);
      }
    }

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = adj.get(curr) || new Set<string>();
      for (const nxt of neighbors) {
        if (nxt !== blocked && !visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return visited;
  }

  const reachableBefore = getReachable(rootIds, null);
  const reachableAfter = getReachable(rootIds, failedNodeId);

  const isolatedIds = Array.from(reachableBefore)
    .filter((nid) => nid !== failedNodeId && !reachableAfter.has(nid))
    .sort();

  const directNeighbors = adj.get(failedNodeId) || new Set<string>();
  const degradedIds = Array.from(directNeighbors)
    .filter((nid) => reachableAfter.has(nid))
    .sort();

  const isolatedHostnames = isolatedIds.map((nid) => nodes.get(nid)?.hostname || nid);
  const degradedHostnames = degradedIds.map((nid) => nodes.get(nid)?.hostname || nid);

  const recoveryReadiness =
    failedNode.has_lkg && !failedNode.drift_detected
      ? 'READY (Verified Last-Known-Good config available for rapid restore)'
      : failedNode.has_lkg
      ? 'WARNING (Config has unverified drift from Last-Known-Good)'
      : 'CRITICAL RISK (No Last-Known-Good backup pinned!)';

  return {
    failed_node_id: failedNodeId,
    failed_hostname: failedNode.hostname,
    failed_role: failedNode.role,
    failed_site: failedNode.site,
    isolated_nodes: isolatedIds,
    isolated_hostnames: isolatedHostnames,
    degraded_nodes: degradedIds,
    degraded_hostnames: degradedHostnames,
    affected_edges: affectedEdges,
    recovery_readiness: recoveryReadiness,
    total_impacted_devices: isolatedIds.length + degradedIds.length,
  };
}

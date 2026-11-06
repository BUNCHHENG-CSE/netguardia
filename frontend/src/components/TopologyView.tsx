import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  Cpu,
  Download,
  Eye,
  FileDown,
  Flame,
  GitCompare,
  HardDrive,
  Layers,
  Network,
  RefreshCw,
  Router,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wifi,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Select } from './ui/select';
import { useTheme } from '../lib/theme';
import type { BlastRadiusResult, TopologyEdge, TopologyGraph, TopologyNode } from '../types';

interface TopologyViewProps {
  onOpenDiff: (deviceId: number) => void;
}

const SAMPLE_CLI_SNIPPETS: Record<string, { vendor: string; raw: string }> = {
  cisco_cdp: {
    vendor: 'Cisco',
    raw: `-------------------------
Device ID: hq-lab-sw09.corp.local
Entry address(es):
  IP address: 10.10.99.9
Platform: cisco C9200L-24P,  Capabilities: Switch IGMP
Interface: GigabitEthernet1/0/15,  Port ID (outgoing port): GigabitEthernet1/0/24`,
  },
  juniper_lldp: {
    vendor: 'Juniper',
    raw: `Local Interface    Parent Interface    Chassis Id          Port info          System Name
ge-0/0/22          -                   00:1c:73:aa:bb:88   eth0               hq-rogue-nas01`,
  },
  ubiquiti_lldp: {
    vendor: 'Ubiquiti',
    raw: `-------------------------------------------------------------------------------
Interface:    eth12, via: LLDP, RID: 4, Time: 0 days, 02:15:00
  Chassis:
    ChassisID:    mac 00:1c:73:55:66:77
    SysName:      ubnt-u6-enterprise-ap04
    SysDescr:     UniFi U6-Enterprise AP
    MgmtIP:       10.10.3.84
  Port:
    PortID:       ifname eth0`,
  },
};

export const TopologyView: React.FC<TopologyViewProps> = ({ onOpenDiff }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [siteFilter, setSiteFilter] = useState<string>('ALL');
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [blastMode, setBlastMode] = useState<boolean>(true);
  const [blastResult, setBlastResult] = useState<BlastRadiusResult | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);

  // CLI Parser Sandbox Modal
  const [showParserModal, setShowParserModal] = useState<boolean>(false);
  const [cliText, setCliText] = useState<string>(SAMPLE_CLI_SNIPPETS.cisco_cdp.raw);
  const [cliVendor, setCliVendor] = useState<string>('Cisco');
  const [attachDeviceId, setAttachDeviceId] = useState<number | undefined>(undefined);
  const [parsedPreview, setParsedPreview] = useState<
    Array<{
      remote_hostname: string;
      remote_ip: string;
      remote_platform: string;
      local_port: string;
      remote_port: string;
      protocol: string;
    }>
  >([]);

  const loadTopology = async (site = siteFilter) => {
    setLoading(true);
    try {
      const data = await api.getTopology(site);
      setGraph(data);
      if (data.nodes.length > 0 && !selectedNodeId) {
        const defaultNode =
          data.nodes.find((n) => n.hostname === 'hq-dist-sw01') || data.nodes[0];
        setSelectedNodeId(defaultNode.id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopology(siteFilter);
  }, [siteFilter]);

  useEffect(() => {
    if (!selectedNodeId || !blastMode) {
      setBlastResult(null);
      return;
    }
    api
      .getBlastRadius(selectedNodeId, siteFilter)
      .then(setBlastResult)
      .catch(() => setBlastResult(null));
  }, [selectedNodeId, blastMode, siteFilter, graph]);

  // Compute deterministic coordinates by tier
  const layout = useMemo(() => {
    if (!graph) return { nodeCoords: new Map<string, { x: number; y: number }>(), width: 1080, height: 620 };
    const tiers: Record<number, TopologyNode[]> = { 0: [], 1: [], 2: [], 3: [] };
    for (const n of graph.nodes) {
      const t = Math.min(3, Math.max(0, n.tier ?? 3));
      tiers[t].push(n);
    }
    const width = 1080;
    const height = 620;
    const tierY: Record<number, number> = {
      0: 95,
      1: 240,
      2: 390,
      3: 535,
    };

    const coords = new Map<string, { x: number; y: number }>();
    for (const t of [0, 1, 2, 3]) {
      const list = tiers[t];
      const count = list.length;
      list.forEach((node, idx) => {
        const spacing = width / (count + 1);
        coords.set(node.id, {
          x: Math.round(spacing * (idx + 1)),
          y: tierY[t],
        });
      });
    }
    return { nodeCoords: coords, width, height };
  }, [graph]);

  const selectedNode = useMemo(
    () => graph?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph, selectedNodeId]
  );

  const handleRunCliParser = async (saveToDevice: boolean) => {
    const res = await api.parseNeighborCli(
      cliText,
      cliVendor,
      saveToDevice ? attachDeviceId : undefined
    );
    setParsedPreview(res.neighbors);
    if (saveToDevice && attachDeviceId) {
      await loadTopology(siteFilter);
    }
  };

  const handleExportSvg = () => {
    const svgEl = document.getElementById('netguardia-topology-svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netguardia_topology_${siteFilter.replace(/\s+/g, '_')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (!graph) return;
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netguardia_topology_${siteFilter.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <Card>
        <CardContent className="p-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-foreground" />
              <h2 className="text-xs font-bold text-foreground tracking-tight">
                LLDP / CDP Topology & Blast-Radius Engine
              </h2>
            </div>

            <Select
              value={siteFilter}
              onChange={(e) => {
                setSiteFilter(e.target.value);
                setSelectedNodeId(null);
              }}
              className="w-auto"
            >
              <option value="ALL">All Sites (HQ-Campus + Branch-DC)</option>
              <option value="HQ-Campus (Austin)">HQ-Campus (Austin)</option>
              <option value="Branch-DC (Frankfurt)">Branch-DC (Frankfurt)</option>
            </Select>

            {graph && (
              <div className="hidden lg:flex items-center gap-2 text-xs pl-2 border-l border-border">
                <Badge variant="outline" className="text-[10px]">
                  {graph.stats.managed_nodes} Managed
                </Badge>
                {graph.stats.unmanaged_discovered_nodes > 0 && (
                  <Badge variant="purple" className="text-[10px]">
                    {graph.stats.unmanaged_discovered_nodes} Shadow LLDP
                  </Badge>
                )}
                <Badge variant="info" className="text-[10px]">
                  {graph.stats.cdp_links} CDP / {graph.stats.lldp_links} LLDP Links
                </Badge>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={blastMode ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setBlastMode((v) => !v)}
              className="gap-1.5"
            >
              <Flame className="w-3.5 h-3.5" />
              {blastMode ? 'Blast-Radius: ACTIVE' : 'Simulate Blast'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportSvg}
              className="gap-1.5"
              title="Download standalone SVG topology vector diagram"
            >
              <Download className="w-3.5 h-3.5" />
              SVG
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportJson}
              className="gap-1.5"
              title="Download topology graph data as JSON"
            >
              <FileDown className="w-3.5 h-3.5" />
              JSON
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowParserModal(true)}
              className="gap-1.5"
            >
              <Code2 className="w-3.5 h-3.5" />
              CLI Sandbox
            </Button>

            <div className="inline-flex items-center rounded-lg bg-secondary/50 border border-border p-0.5">
              <button
                onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.1).toFixed(2)))}
                className="p-1 text-muted-foreground hover:text-foreground transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-[10px] text-muted-foreground font-mono">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(1.35, +(z + 0.1).toFixed(2)))}
                className="p-1 text-muted-foreground hover:text-foreground transition"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid: SVG Canvas & Inspector Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* SVG Canvas Container */}
        <Card className="lg:col-span-8 overflow-hidden flex flex-col">
          {/* Legend Subheader */}
          <div className="px-4 py-2 bg-secondary/40 border-b border-border flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                LKG Match
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Drift Detected
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                Shadow LLDP Peer
              </span>
              {blastMode && (
                <span className="inline-flex items-center gap-1.5 text-destructive font-bold">
                  <span className="w-2 h-2 rounded-full bg-destructive animate-ping" />
                  Simulated Outage
                </span>
              )}
            </div>
            <span>Click any node to simulate blast radius</span>
          </div>

          {/* SVG Map */}
          <div className="relative flex-1 overflow-auto bg-background min-h-[540px] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-tech-dots opacity-40 pointer-events-none" />

            {loading || !graph ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin text-foreground" />
                Building multi-tier topology graph...
              </div>
            ) : (
              <svg
                id="netguardia-topology-svg"
                width={layout.width * zoom}
                height={layout.height * zoom}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="select-none transition-all duration-150 font-mono"
              >
                {/* Tier Background Guidelines */}
                {[
                  { y: 95, label: 'TIER 0 • WAN GATEWAYS & FIREWALL PERIMETER' },
                  { y: 240, label: 'TIER 1 • CORE SWITCHING BACKBONE' },
                  { y: 390, label: 'TIER 2 • DISTRIBUTION & AGGREGATION' },
                  { y: 535, label: 'TIER 3 • ACCESS SWITCHES & SHADOW PEERS' },
                ].map((tier, idx) => (
                  <g key={idx}>
                    <line
                      x1={20}
                      y1={tier.y}
                      x2={layout.width - 20}
                      y2={tier.y}
                      stroke={isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.1)"}
                      strokeDasharray="4 6"
                      strokeWidth={1}
                    />
                    <text
                      x={30}
                      y={tier.y - 42}
                      fill={isDark ? "rgba(255, 255, 255, 0.35)" : "rgba(0, 0, 0, 0.45)"}
                      fontSize={9}
                      fontWeight={700}
                      letterSpacing={1.5}
                    >
                      {tier.label}
                    </text>
                  </g>
                ))}

                {/* Edges */}
                {graph.edges.map((edge: TopologyEdge) => {
                  const p1 = layout.nodeCoords.get(edge.source);
                  const p2 = layout.nodeCoords.get(edge.target);
                  if (!p1 || !p2) return null;

                  const isAffectedEdge =
                    blastMode && blastResult?.affected_edges.includes(edge.id);
                  const isIsolatedEdge =
                    blastMode &&
                    blastResult &&
                    (blastResult.isolated_nodes.includes(edge.source) ||
                      blastResult.isolated_nodes.includes(edge.target));

                  const strokeColor = isAffectedEdge
                    ? '#f43f5e'
                    : isIsolatedEdge
                    ? '#fb7185'
                    : edge.protocol === 'CDP'
                    ? (isDark ? '#38bdf8' : '#0284c7')
                    : (isDark ? '#34d399' : '#059669');

                  const midX = (p1.x + p2.x) / 2;
                  const midY = (p1.y + p2.y) / 2;

                  return (
                    <g key={edge.id} className="transition-all duration-300">
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke={strokeColor}
                        strokeWidth={isAffectedEdge || isIsolatedEdge ? 3 : 1.5}
                        strokeDasharray={isAffectedEdge ? '5 4' : undefined}
                        opacity={
                          blastMode &&
                          blastResult &&
                          !isAffectedEdge &&
                          !isIsolatedEdge
                            ? 0.25
                            : 0.8
                        }
                      />
                      <rect
                        x={midX - 20}
                        y={midY - 8}
                        width={40}
                        height={16}
                        rx={4}
                        fill={isDark ? "#171717" : "#ffffff"}
                        stroke={strokeColor}
                        strokeWidth={1}
                      />
                      <text
                        x={midX}
                        y={midY + 3}
                        textAnchor="middle"
                        fill={isDark ? "#f5f5f5" : "#171717"}
                        fontSize={8}
                        fontWeight={700}
                      >
                        {edge.protocol}
                      </text>
                    </g>
                  );
                })}

                {/* Nodes */}
                {graph.nodes.map((node: TopologyNode) => {
                  const pos = layout.nodeCoords.get(node.id);
                  if (!pos) return null;

                  const isSelected = node.id === selectedNodeId;
                  const isFailedTarget =
                    blastMode && blastResult?.failed_node_id === node.id;
                  const isIsolated =
                    blastMode && blastResult?.isolated_nodes.includes(node.id);
                  const isDegraded =
                    blastMode && blastResult?.degraded_nodes.includes(node.id);

                  let borderStroke = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';
                  let fillBg = isDark ? '#1f1f1f' : '#ffffff';
                  let statusBadgeText = 'LKG MATCH';
                  let statusBadgeColor = isDark ? '#34d399' : '#059669';

                  if (!node.is_managed) {
                    borderStroke = isDark ? '#a855f7' : '#9333ea';
                    statusBadgeText = 'SHADOW';
                    statusBadgeColor = isDark ? '#c084fc' : '#7e22ce';
                  } else if (node.drift_detected) {
                    borderStroke = isDark ? '#f59e0b' : '#d97706';
                    statusBadgeText = 'DRIFT';
                    statusBadgeColor = isDark ? '#fbbf24' : '#b45309';
                  } else {
                    borderStroke = isDark ? '#10b981' : '#059669';
                  }

                  if (isFailedTarget) {
                    borderStroke = '#f43f5e';
                    fillBg = isDark ? '#450a0a' : '#fee2e2';
                    statusBadgeText = 'TARGET';
                    statusBadgeColor = isDark ? '#fda4af' : '#b91c1c';
                  } else if (isIsolated) {
                    borderStroke = '#fb7185';
                    fillBg = isDark ? '#38090d' : '#ffe4e6';
                    statusBadgeText = 'ISOLATED';
                    statusBadgeColor = isDark ? '#fda4af' : '#be123c';
                  } else if (isDegraded) {
                    borderStroke = '#f59e0b';
                    fillBg = isDark ? '#291b00' : '#fef3c7';
                    statusBadgeText = 'REDUNDANT';
                    statusBadgeColor = isDark ? '#fcd34d' : '#b45309';
                  }

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onClick={() => setSelectedNodeId(node.id)}
                      className="cursor-pointer group"
                    >
                      {/* Selection Outline */}
                      {(isSelected || isFailedTarget || isIsolated) && (
                        <rect
                          x={-80}
                          y={-34}
                          width={160}
                          height={68}
                          rx={10}
                          fill="none"
                          stroke={borderStroke}
                          strokeWidth={2}
                          strokeDasharray={isIsolated ? '4 3' : undefined}
                          opacity={0.8}
                        />
                      )}

                      {/* Card Box */}
                      <rect
                        x={-75}
                        y={-29}
                        width={150}
                        height={58}
                        rx={8}
                        fill={fillBg}
                        stroke={borderStroke}
                        strokeWidth={isSelected ? 2 : 1}
                      />

                      {/* Vendor Label */}
                      <text
                        x={-64}
                        y={-14}
                        fill={isDark ? '#a3a3a3' : '#71717a'}
                        fontSize={8}
                        fontWeight={700}
                      >
                        {node.vendor.split(' ')[0].toUpperCase()}
                      </text>

                      {/* Status Tag */}
                      <text
                        x={64}
                        y={-14}
                        textAnchor="end"
                        fill={statusBadgeColor}
                        fontSize={7.5}
                        fontWeight={800}
                      >
                        {statusBadgeText}
                      </text>

                      {/* Hostname */}
                      <text
                        x={-64}
                        y={6}
                        fill={isDark ? '#fafafa' : '#09090b'}
                        fontSize={11}
                        fontWeight={700}
                      >
                        {node.hostname.length > 14
                          ? `${node.hostname.slice(0, 13)}…`
                          : node.hostname}
                      </text>

                      {/* IP */}
                      <text
                        x={-64}
                        y={19}
                        fill={isDark ? '#737373' : '#71717a'}
                        fontSize={9}
                      >
                        {node.ip_address}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </Card>

        {/* Right Inspector Deck */}
        <div className="lg:col-span-4 space-y-4">
          {selectedNode ? (
            <Card className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-border pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-bold">{selectedNode.hostname}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">
                      {selectedNode.vendor}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs font-mono mt-0.5">
                    {selectedNode.ip_address} • {selectedNode.role}
                  </CardDescription>
                </div>

                {selectedNode.is_managed && selectedNode.device_id && (
                  <div className="flex items-center gap-1.5">
                    <a
                      href={api.getDeviceExportUrl(selectedNode.device_id, 'latest')}
                      download
                      className="inline-flex items-center justify-center h-8 px-2 text-xs font-semibold rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground transition-colors gap-1"
                      title="Download configuration"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      Export
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenDiff(selectedNode.device_id!)}
                      className="gap-1"
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                      Diff
                    </Button>
                  </div>
                )}
              </div>

              {/* Blast Radius Report */}
              {blastMode && blastResult && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-destructive flex items-center gap-1.5 uppercase text-[11px]">
                      <Flame className="w-3.5 h-3.5" />
                      Blast-Radius Simulation
                    </span>
                    <Badge variant="destructive">
                      {blastResult.total_impacted_devices} Impacted
                    </Badge>
                  </div>

                  <p className="text-muted-foreground leading-relaxed text-[11px]">
                    Impact if <strong className="text-foreground">{selectedNode.hostname}</strong> fails:
                  </p>

                  <div className="space-y-2">
                    <div className="p-2 rounded border border-destructive/25 bg-background/50">
                      <div className="font-semibold text-destructive mb-1 text-[11px] flex justify-between">
                        <span>Downstream Isolated ({blastResult.isolated_hostnames.length})</span>
                      </div>
                      {blastResult.isolated_hostnames.length === 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">
                          Zero isolated — redundant paths available.
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {blastResult.isolated_hostnames.map((h) => (
                            <Badge key={h} variant="destructive" className="text-[10px]">
                              {h}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="p-2 rounded border border-border bg-background/50">
                      <div className="font-semibold text-amber-700 dark:text-amber-300 mb-1 text-[11px]">
                        Degraded Peers ({blastResult.degraded_hostnames.length})
                      </div>
                      {blastResult.degraded_hostnames.length === 0 ? (
                        <span className="text-muted-foreground text-[11px]">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {blastResult.degraded_hostnames.map((h) => (
                            <Badge key={h} variant="warning" className="text-[10px]">
                              {h}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Connected Neighbor Ports */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Discovered Physical Links
                </span>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {graph?.edges
                    .filter(
                      (e) => e.source === selectedNode.id || e.target === selectedNode.id
                    )
                    .map((edge) => {
                      const isSource = edge.source === selectedNode.id;
                      const localPort = isSource ? edge.source_port : edge.target_port;
                      const peerHost = isSource ? edge.target_hostname : edge.source_hostname;
                      const peerPort = isSource ? edge.target_port : edge.source_port;

                      return (
                        <div
                          key={edge.id}
                          className="p-2 rounded border border-border bg-background/50 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-cyan-600 dark:text-cyan-400 font-semibold">{localPort}</span>
                            <span className="text-muted-foreground">↔</span>
                            <span className="text-foreground font-semibold">{peerHost}</span>
                            <span className="text-muted-foreground text-[11px]">({peerPort})</span>
                          </div>
                          <Badge variant="outline" className="text-[9px]">
                            {edge.protocol}
                          </Badge>
                        </div>
                      );
                    })}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-6 text-center text-xs text-muted-foreground space-y-2">
              <Network className="w-8 h-8 text-muted-foreground mx-auto" />
              <p>Select any node to inspect physical links & failure blast radius.</p>
            </Card>
          )}
        </div>
      </div>

      {/* CLI Sandbox Modal */}
      {showParserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-3xl p-5 space-y-4 shadow-2xl border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-foreground" />
                  LLDP / CDP CLI Parser Sandbox
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Test agentless neighbor discovery regex parsers against raw CLI output.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowParserModal(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Load sample:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCliVendor('Cisco');
                  setCliText(SAMPLE_CLI_SNIPPETS.cisco_cdp.raw);
                }}
              >
                Cisco CDP
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCliVendor('Juniper');
                  setCliText(SAMPLE_CLI_SNIPPETS.juniper_lldp.raw);
                }}
              >
                Juniper LLDP
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCliVendor('Ubiquiti');
                  setCliText(SAMPLE_CLI_SNIPPETS.ubiquiti_lldp.raw);
                }}
              >
                Ubiquiti lldpctl
              </Button>
            </div>

            <textarea
              rows={7}
              value={cliText}
              onChange={(e) => setCliText(e.target.value)}
              className="w-full rounded-md border border-input bg-background/50 p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Attach to device:</span>
                <Select
                  value={attachDeviceId ?? ''}
                  onChange={(e) =>
                    setAttachDeviceId(e.target.value ? Number(e.target.value) : undefined)
                  }
                  className="w-auto"
                >
                  <option value="">-- Preview Only --</option>
                  {graph?.nodes
                    .filter((n) => n.is_managed && n.device_id)
                    .map((n) => (
                      <option key={n.id} value={n.device_id!}>
                        {n.hostname} ({n.vendor})
                      </option>
                    ))}
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRunCliParser(false)}
                >
                  Parse CLI Output
                </Button>
                {attachDeviceId && (
                  <Button
                    size="sm"
                    onClick={() => handleRunCliParser(true)}
                  >
                    Save & Inject into Graph
                  </Button>
                )}
              </div>
            </div>

            {parsedPreview.length > 0 && (
              <div className="rounded-md border border-border bg-background/50 p-3 space-y-1.5 text-xs">
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                  Parsed {parsedPreview.length} Neighbor Link(s):
                </div>
                {parsedPreview.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-t border-border pt-1.5 font-mono"
                  >
                    <span>
                      Local <strong>{item.local_port}</strong> ↔ Remote{' '}
                      <strong className="text-cyan-600 dark:text-cyan-400">{item.remote_hostname}</strong> ({item.remote_port})
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      [{item.protocol}] {item.remote_platform}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

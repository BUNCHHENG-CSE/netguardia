import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  FileDown,
  Flame,
  GitCompare,
  HelpCircle,
  Layers,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import type {
  DriftAlert,
  NetworkDevice,
  OverviewMetrics,
  ReadinessAuditResponse,
} from '../types';

export type DashboardNavTab =
  | 'devices'
  | 'topology'
  | 'maintenance'
  | 'vault'
  | 'compliance'
  | 'search'
  | 'activity';

interface DashboardViewProps {
  overview: OverviewMetrics | null;
  devices: NetworkDevice[];
  alerts: DriftAlert[];
  onOpenDiff: (deviceId: number) => void;
  onNavigateTab: (tab: DashboardNavTab) => void;
  onRefreshAll: () => Promise<void>;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  overview,
  devices,
  alerts,
  onOpenDiff,
  onNavigateTab,
  onRefreshAll,
}) => {
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditResult, setAuditResult] = useState<ReadinessAuditResponse | null>(null);
  const [backupRunningId, setBackupRunningId] = useState<number | null>(null);
  const [fleetBackupRunning, setFleetBackupRunning] = useState(false);
  const [filterMode, setFilterMode] = useState<'ALL' | 'DRIFT' | 'STALE'>('ALL');

  const handleRunReadinessAudit = async () => {
    setAuditRunning(true);
    try {
      const res = await api.verifyFleetReadiness();
      setAuditResult(res);
      await onRefreshAll();
    } finally {
      setAuditRunning(false);
    }
  };

  const handleBackupSingle = async (deviceId: number) => {
    setBackupRunningId(deviceId);
    try {
      await api.backupDevice(deviceId);
      await onRefreshAll();
    } finally {
      setBackupRunningId(null);
    }
  };

  const handleRunFleetBackup = async () => {
    setFleetBackupRunning(true);
    try {
      await api.runAllBackups();
      await onRefreshAll();
    } finally {
      setFleetBackupRunning(false);
    }
  };

  if (!overview) {
    return (
      <div className="p-16 flex flex-col items-center justify-center gap-3 text-muted-foreground text-xs font-mono">
        <RefreshCw className="w-5 h-5 animate-spin text-foreground" />
        <span>SYNCING FLEET METRICS & TOPOLOGY STATE...</span>
      </div>
    );
  }

  const driftedDevices = devices.filter((d) => d.drift_detected);
  const staleDevices = devices.filter((d) => d.is_stale);
  const activeAlerts = alerts.filter((a) => !a.acknowledged);

  const displayIssues = [
    ...driftedDevices.map((d) => ({ ...d, issueType: 'DRIFT' as const })),
    ...staleDevices.map((d) => ({ ...d, issueType: 'STALE' as const })),
  ].filter((item) => {
    if (filterMode === 'DRIFT') return item.issueType === 'DRIFT';
    if (filterMode === 'STALE') return item.issueType === 'STALE';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Fleet Health & Integrity Hero Card */}
      <Card className="border-border bg-card/80 backdrop-blur-sm relative overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1.5 py-0.5">
                  <Sparkles className="w-3 h-3 text-foreground" />
                  Fleet Health & Recovery
                </Badge>
                <Badge variant="success" className="gap-1 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  SSH Baseline Active
                </Badge>
              </div>

              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground font-mono">
                Configuration Integrity Command
              </h1>

              <CardDescription className="text-xs">
                Real-time SHA-256 drift monitoring, noise-filtered Last-Known-Good (LKG) baseline validation,
                and agentless LLDP/CDP dependency tracking across Cisco, Juniper, and Ubiquiti infrastructure.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <a
                href={api.getFleetDrZipUrl()}
                download
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                title="Download full offline Disaster Recovery bundle (.zip) with all configs and manifest"
              >
                <FileDown className="w-3.5 h-3.5 text-primary" />
                <span>Export DR Bundle</span>
              </a>

              <Button
                onClick={handleRunReadinessAudit}
                disabled={auditRunning}
                className="gap-2"
              >
                <ShieldCheck className={`w-3.5 h-3.5 ${auditRunning ? 'animate-bounce' : ''}`} />
                {auditRunning ? 'Auditing Fleet...' : 'Verify Fleet Readiness'}
              </Button>

              <Button
                variant="outline"
                onClick={handleRunFleetBackup}
                disabled={fleetBackupRunning}
                className="gap-2"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${fleetBackupRunning ? 'animate-spin' : ''}`} />
                {fleetBackupRunning ? 'Collecting...' : 'Trigger Global Backup'}
              </Button>
            </div>
          </div>

          {/* Audit Results Drawer */}
          {auditResult && (
            <div className="mt-4 pt-4 border-t border-border space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Fleet Audit Completed at{' '}
                  <span className="text-foreground">
                    {new Date(auditResult.audited_at).toLocaleTimeString()}
                  </span>
                  <span className="text-muted-foreground font-normal">
                    — {auditResult.ready_devices} of {auditResult.total_devices} recovery-ready ({auditResult.readiness_percentage}%)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAuditResult(null)}
                >
                  Dismiss
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {auditResult.results.map((r) => (
                  <div
                    key={r.device_id}
                    className="p-2.5 rounded-md border border-border bg-background/50 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-foreground flex items-center gap-1.5">
                        <span>{r.hostname}</span>
                        <span className="text-[10px] text-muted-foreground font-normal">
                          ({r.latency_ms}ms)
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Age: {r.backup_age_days}d • {r.credential_name}
                      </div>
                    </div>
                    <Badge
                      variant={
                        r.readiness_status === 'READY'
                          ? 'success'
                          : r.readiness_status === 'DRIFT_UNVERIFIED'
                          ? 'warning'
                          : 'destructive'
                      }
                    >
                      {r.readiness_status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardHeader>
      </Card>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Readiness Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Fleet Readiness
            </span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground font-mono">
              {overview.readiness_score}%
            </div>
            <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden mt-2.5">
              <div
                className="bg-emerald-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${overview.readiness_score}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 flex justify-between">
              <span>{overview.verified_clean_devices} of {overview.total_devices} clean</span>
              <span className="text-emerald-400 font-semibold">LKG OK</span>
            </p>
          </CardContent>
        </Card>

        {/* Drift Card */}
        <Card
          onClick={() => onNavigateTab('maintenance')}
          className="cursor-pointer hover:border-amber-500/40"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Out-of-Window Drift
            </span>
            <ShieldAlert className="w-4 h-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400 font-mono">
              {overview.drifted_devices}
            </div>
            <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden mt-2.5">
              <div
                className="bg-amber-400 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(overview.drifted_devices / Math.max(1, overview.total_devices)) * 100}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 flex justify-between">
              <span>{overview.unacknowledged_alerts} unacknowledged</span>
              <span className="text-amber-400 font-medium">Triage →</span>
            </p>
          </CardContent>
        </Card>

        {/* Stale Card */}
        <Card
          onClick={() => onNavigateTab('devices')}
          className="cursor-pointer hover:border-rose-500/40"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Stale Backups (&gt;{overview.stale_backup_threshold_days}d)
            </span>
            <Clock
              className={`w-4 h-4 ${
                overview.stale_devices > 0 ? 'text-destructive' : 'text-emerald-400'
              }`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-mono ${
                overview.stale_devices > 0 ? 'text-destructive' : 'text-emerald-400'
              }`}
            >
              {overview.stale_devices}
            </div>
            <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden mt-2.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  overview.stale_devices > 0 ? 'bg-destructive' : 'bg-emerald-400'
                }`}
                style={{
                  width: `${(overview.stale_devices / Math.max(1, overview.total_devices)) * 100}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 flex justify-between">
              <span>
                {overview.stale_devices > 0 ? 'Needs sync' : 'All backups fresh'}
              </span>
              <span className={overview.stale_devices > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                View →
              </span>
            </p>
          </CardContent>
        </Card>

        {/* Topology Links Card */}
        <Card
          onClick={() => onNavigateTab('topology')}
          className="cursor-pointer hover:border-foreground/40"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Topology Links
            </span>
            <Network className="w-4 h-4 text-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground font-mono">
              {overview.total_neighbor_links}
            </div>
            <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden mt-2.5">
              <div className="bg-foreground h-full rounded-full w-full" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 flex justify-between">
              <span>{overview.site_count} Sites Active</span>
              <span className="text-foreground font-medium">Map →</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Operations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left 8 Cols: Incident Triage Feed */}
        <div className="lg:col-span-8 space-y-5">
          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Fleet Triage Queue
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Devices requiring integrity review or backup freshening.
                  </CardDescription>
                </div>

                <div className="inline-flex rounded-lg bg-secondary/60 p-0.5 border border-border text-xs">
                  <button
                    onClick={() => setFilterMode('ALL')}
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                      filterMode === 'ALL'
                        ? 'bg-background text-foreground font-bold shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All ({driftedDevices.length + staleDevices.length})
                  </button>
                  <button
                    onClick={() => setFilterMode('DRIFT')}
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                      filterMode === 'DRIFT'
                        ? 'bg-background text-amber-300 font-bold shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Drift ({driftedDevices.length})
                  </button>
                  <button
                    onClick={() => setFilterMode('STALE')}
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                      filterMode === 'STALE'
                        ? 'bg-background text-destructive font-bold shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Stale ({staleDevices.length})
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-4 space-y-2.5">
              {displayIssues.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-xs space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <div className="font-bold text-foreground">
                    100% Configuration Integrity Verified
                  </div>
                  <p>All devices match their pinned baseline snapshot with fresh backups.</p>
                </div>
              ) : (
                displayIssues.map((dev) => {
                  const isDrift = dev.issueType === 'DRIFT';

                  return (
                    <div
                      key={`${dev.issueType}-${dev.id}`}
                      className="p-3.5 rounded-lg border border-border bg-background/50 hover:bg-background/80 flex flex-wrap items-center justify-between gap-3 transition"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={isDrift ? 'warning' : 'destructive'}>
                            {isDrift ? 'DRIFT' : `STALE (${Math.round(dev.backup_age_days)}d)`}
                          </Badge>
                          <span className="font-bold text-foreground text-xs">
                            {dev.hostname}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {dev.ip_address} • {dev.vendor} {dev.model}
                          </span>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          {isDrift ? (
                            <>
                              Running configuration <span className="text-amber-300 font-semibold">v{dev.latest_version}</span> diverged from LKG baseline <span className="text-emerald-400 font-semibold">v{dev.lkg_version}</span> in <strong className="text-foreground">{dev.site}</strong>.
                            </>
                          ) : (
                            <>
                              Last good snapshot is <strong className="text-destructive">{Math.round(dev.backup_age_days)} days old</strong>.
                            </>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isDrift ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenDiff(dev.id)}
                            className="gap-1.5"
                          >
                            <GitCompare className="w-3.5 h-3.5" />
                            Diff
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleBackupSingle(dev.id)}
                            disabled={backupRunningId === dev.id}
                            className="gap-1.5"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${backupRunningId === dev.id ? 'animate-spin' : ''}`}
                            />
                            {backupRunningId === dev.id ? 'Collecting...' : 'Backup'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Active Alerts */}
          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-foreground" />
                  Live Configuration Integrity & Security Alerts
                  {activeAlerts.length > 0 && (
                    <Badge variant="destructive" className="ml-1">
                      {activeAlerts.length} Active
                    </Badge>
                  )}
                </CardTitle>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => onNavigateTab('maintenance')}
                  className="gap-1"
                >
                  Maintenance & Schedule <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="pt-4 space-y-2.5">
              {activeAlerts.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  Zero active configuration alerts. All changes within approved schedule.
                </div>
              ) : (
                activeAlerts.slice(0, 3).map((alert) => (
                  <div
                    key={alert.id}
                    className="p-3 rounded-lg border border-border bg-background/50 hover:bg-background/80 flex flex-wrap items-center justify-between gap-3 text-xs transition"
                  >
                    <div className="space-y-1 max-w-xl">
                      <div className="flex items-center gap-2">
                        <Badge variant={alert.severity === 'CRITICAL' ? 'destructive' : 'warning'}>
                          {alert.severity}
                        </Badge>
                        <span className="font-semibold text-foreground">{alert.title}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(alert.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-muted-foreground">{alert.message}</p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenDiff(alert.device_id)}
                    >
                      Compare
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right 4 Cols: Engine Telemetry & Value */}
        <div className="lg:col-span-4 space-y-5">
          <Card>
            <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-foreground" />
                Engine Telemetry
              </CardTitle>
              <Badge variant="success" className="gap-1 py-0 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ONLINE
              </Badge>
            </CardHeader>

            <CardContent className="pt-4 space-y-2 text-xs">
              <div className="p-2 rounded-md border border-border bg-background/40 flex items-center justify-between">
                <span className="text-muted-foreground">Collector Schedule</span>
                <span className="text-foreground font-semibold">03:00 UTC (Daily)</span>
              </div>

              <div className="p-2 rounded-md border border-border bg-background/40 flex items-center justify-between">
                <span className="text-muted-foreground">Baseline Hash Engine</span>
                <span className="text-emerald-400 font-semibold">SHA-256 Normalized</span>
              </div>

              <div className="p-2 rounded-md border border-border bg-background/40 flex items-center justify-between">
                <span className="text-muted-foreground">Noise Filter Engine</span>
                <span className="text-foreground">Timestamps, NTP, Volatile</span>
              </div>

              <div className="p-2 rounded-md border border-border bg-background/40 flex items-center justify-between">
                <span className="text-muted-foreground">Vault Cryptography</span>
                <span className="text-purple-300 font-semibold">AES-128-CBC + HMAC</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
              <div>
                <span className="text-[10px] uppercase text-muted-foreground font-bold">
                  Operational ROI
                </span>
                <CardTitle className="mt-0.5">{overview.saas_roi.recommended_plan}</CardTitle>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-foreground">
                  ${overview.saas_roi.monthly_price_usd}
                  <span className="text-xs text-muted-foreground font-normal">/mo</span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-4 space-y-2 text-xs">
              <div className="p-2.5 rounded-md border border-border bg-background/40 flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  Manual Labor Saved
                </span>
                <span className="font-bold text-emerald-400">
                  ~{overview.saas_roi.manual_hours_saved_monthly} hrs/mo
                </span>
              </div>

              <div className="p-2.5 rounded-md border border-border bg-background/40 flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-foreground" />
                  Outage Exposure Avoided
                </span>
                <span className="font-bold text-foreground">
                  ${overview.saas_roi.downtime_cost_avoided_usd.toLocaleString()}
                </span>
              </div>

              <div className="p-3 rounded-md border border-border bg-secondary/30 text-xs text-muted-foreground space-y-1 mt-1">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Shield className="w-3 h-3 text-foreground" />
                  Zero Monitoring Noise
                </div>
                <p className="text-[11px] leading-relaxed">
                  Strictly focused on configuration integrity preservation, noise-free diffs, and instant rollback CLI scripts.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

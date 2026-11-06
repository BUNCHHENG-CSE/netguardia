import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileCode2,
  Filter,
  GitCompare,
  History,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { api } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Select } from './ui/select';
import type { ConfigSnapshotMeta, DeviceDiffResponse } from '../types';

interface DiffViewerModalProps {
  deviceId: number;
  onClose: () => void;
  onUpdated: () => void;
}

export const DiffViewerModal: React.FC<DiffViewerModalProps> = ({
  deviceId,
  onClose,
  onUpdated,
}) => {
  const [snapshots, setSnapshots] = useState<ConfigSnapshotMeta[]>([]);
  const [baseId, setBaseId] = useState<number | undefined>(undefined);
  const [targetId, setTargetId] = useState<number | undefined>(undefined);
  const [ignoreNoise, setIgnoreNoise] = useState<boolean>(true);
  const [onlyChanges, setOnlyChanges] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified' | 'rollback'>('side-by-side');
  const [diffData, setDiffData] = useState<DeviceDiffResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadData = async (
    customBase?: number,
    customTarget?: number,
    customNoise?: boolean
  ) => {
    setLoading(true);
    try {
      const [snaps, diff] = await Promise.all([
        api.getDeviceSnapshots(deviceId),
        api.getDeviceDiff(deviceId, {
          base_snapshot_id: customBase ?? baseId,
          target_snapshot_id: customTarget ?? targetId,
          ignore_noise: customNoise ?? ignoreNoise,
        }),
      ]);
      setSnapshots(snaps);
      setDiffData(diff);
      if (customBase === undefined && !baseId) setBaseId(diff.base_snapshot.id);
      if (customTarget === undefined && !targetId) setTargetId(diff.target_snapshot.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [deviceId]);

  const handleToggleNoise = (nextVal: boolean) => {
    setIgnoreNoise(nextVal);
    loadData(baseId, targetId, nextVal);
  };

  const handleSnapshotChange = (newBase: number, newTarget: number) => {
    setBaseId(newBase);
    setTargetId(newTarget);
    loadData(newBase, newTarget, ignoreNoise);
  };

  const handlePromoteTargetToLkg = async () => {
    if (!diffData) return;
    setActionBusy('promote');
    try {
      await api.promoteToLkg(deviceId, diffData.target_snapshot.id);
      setToast(
        `Pinned Snapshot v${diffData.target_snapshot.version_number} as new Last-Known-Good baseline!`
      );
      await loadData(diffData.target_snapshot.id, diffData.target_snapshot.id, ignoreNoise);
      onUpdated();
    } finally {
      setActionBusy(null);
    }
  };

  const handleRollbackToLkg = async () => {
    if (!diffData) return;
    setActionBusy('rollback');
    try {
      await api.rollbackToLkg(deviceId);
      setToast(
        `Device ${diffData.device.hostname} rolled back to LKG (v${diffData.base_snapshot.version_number})!`
      );
      await loadData(undefined, undefined, ignoreNoise);
      onUpdated();
    } finally {
      setActionBusy(null);
    }
  };

  const handleDownloadConfig = (text: string, label: string) => {
    if (!diffData) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diffData.device.hostname}-${label}.cfg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyRollback = () => {
    if (!diffData) return;
    navigator.clipboard.writeText(diffData.diff.rollback_cli);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const visibleRows =
    diffData?.diff.side_by_side.filter((row) =>
      onlyChanges ? row.type !== 'unchanged' : true
    ) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 font-mono">
      <Card className="w-full max-w-7xl max-h-[92vh] flex flex-col shadow-2xl border-border overflow-hidden">
        
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 border-b border-border bg-background/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-secondary text-foreground">
              <GitCompare className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">
                  {diffData?.device.hostname || 'Loading...'}
                </CardTitle>
                {diffData && (
                  <Badge variant="outline" className="text-[10px]">
                    {diffData.device.vendor} • {diffData.device.model}
                  </Badge>
                )}
                {diffData?.diff.has_changes ? (
                  <Badge variant="warning" className="gap-1 text-[10px]">
                    <ShieldAlert className="w-3 h-3" />
                    Drift (+{diffData.diff.added_count} / -{diffData.diff.removed_count})
                  </Badge>
                ) : (
                  <Badge variant="success" className="gap-1 text-[10px]">
                    <ShieldCheck className="w-3 h-3" />
                    Clean Baseline
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs font-mono mt-0.5">
                {diffData?.device.site} • IP {diffData?.device.ip_address}
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {diffData && diffData.diff.has_changes && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRollbackToLkg}
                  disabled={actionBusy !== null}
                  className="gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  {actionBusy === 'rollback' ? 'Reverting...' : 'Revert LKG'}
                </Button>
                <Button
                  size="sm"
                  onClick={handlePromoteTargetToLkg}
                  disabled={actionBusy !== null}
                  className="gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  {actionBusy === 'promote'
                    ? 'Pinning...'
                    : `Approve v${diffData.target_snapshot.version_number} as LKG`}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {toast && (
          <div className="px-6 py-2 bg-emerald-500/10 border-b border-emerald-500/25 text-emerald-700 dark:text-emerald-400 text-xs flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {toast}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setToast(null)}>
              Dismiss
            </Button>
          </div>
        )}

        {/* Toolbar */}
        <div className="px-6 py-2.5 bg-secondary/30 border-b border-border flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Baseline:</span>
              <Select
                value={baseId ?? ''}
                onChange={(e) =>
                  handleSnapshotChange(Number(e.target.value), targetId ?? Number(e.target.value))
                }
                className="h-7 text-xs"
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    v{s.version_number} {s.is_lkg ? '★ LKG' : ''} — {new Date(s.created_at).toLocaleString()}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Target:</span>
              <Select
                value={targetId ?? ''}
                onChange={(e) =>
                  handleSnapshotChange(baseId ?? Number(e.target.value), Number(e.target.value))
                }
                className="h-7 text-xs"
              >
                {snapshots.map((s, idx) => (
                  <option key={s.id} value={s.id}>
                    v{s.version_number} {idx === 0 ? '(Latest)' : ''} {s.is_lkg ? '★ LKG' : ''} — {new Date(s.created_at).toLocaleString()}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Filter Noise Checkbox */}
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer bg-background/50 px-2.5 py-1 rounded-md border border-border">
              <input
                type="checkbox"
                checked={ignoreNoise}
                onChange={(e) => handleToggleNoise(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <Sparkles className="w-3.5 h-3.5 text-foreground" />
              <span>Filter Noise</span>
              {diffData && ignoreNoise && (
                <Badge variant="outline" className="text-[9px] px-1 py-0">
                  {diffData.diff.suppressed_noise_lines}
                </Badge>
              )}
            </label>

            {/* Diff Only */}
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer bg-background/50 px-2.5 py-1 rounded-md border border-border">
              <input
                type="checkbox"
                checked={onlyChanges}
                onChange={(e) => setOnlyChanges(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Diff Only</span>
            </label>

            {/* View Mode */}
            <div className="inline-flex rounded-md bg-secondary/60 p-0.5 border border-border">
              <button
                onClick={() => setViewMode('side-by-side')}
                className={`px-2.5 py-0.5 rounded text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'side-by-side'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Side-by-Side
              </button>
              <button
                onClick={() => setViewMode('unified')}
                className={`px-2.5 py-0.5 rounded text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'unified'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Unified
              </button>
              <button
                onClick={() => setViewMode('rollback')}
                className={`px-2.5 py-0.5 rounded text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'rollback'
                    ? 'bg-background text-amber-600 dark:text-amber-400 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Rollback CLI
              </button>
            </div>
          </div>
        </div>

        {/* Risk Findings */}
        {diffData && diffData.diff.risk_findings.length > 0 && (
          <div className="px-6 py-2 bg-destructive/10 border-b border-destructive/25 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <span className="font-bold text-destructive">Risk Findings:</span>
              <div className="flex flex-wrap gap-1">
                {diffData.diff.risk_findings.map((rf, idx) => (
                  <Badge key={idx} variant="destructive">
                    [{rf.severity}] {rf.category} (Line {rf.line_number})
                  </Badge>
                ))}
              </div>
            </div>
            <button
              onClick={() => setViewMode('rollback')}
              className="text-amber-600 dark:text-amber-400 hover:underline text-xs"
            >
              View Rollback Script →
            </button>
          </div>
        )}

        {/* Diff Viewport */}
        <div className="flex-1 overflow-auto bg-background">
          {loading || !diffData ? (
            <div className="p-16 text-center text-muted-foreground text-xs">
              Computing normalized SHA-256 diff...
            </div>
          ) : viewMode === 'side-by-side' ? (
            <div className="min-w-[900px]">
              {/* Header Columns */}
              <div className="grid grid-cols-2 sticky top-0 z-10 bg-secondary/80 border-b border-border text-xs backdrop-blur-md">
                <div className="px-4 py-2 border-r border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="success">
                      v{diffData.base_snapshot.version_number}{' '}
                      {diffData.base_snapshot.is_lkg ? '★ LKG' : 'Base'}
                    </Badge>
                    <span className="text-muted-foreground text-[10px]">
                      SHA: {diffData.base_snapshot.normalized_hash.slice(0, 10)}…
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleDownloadConfig(
                        diffData.base_snapshot.config_text,
                        `v${diffData.base_snapshot.version_number}-LKG`
                      )
                    }
                    className="gap-1 text-[11px]"
                  >
                    <Download className="w-3 h-3" /> .cfg
                  </Button>
                </div>

                <div className="px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      v{diffData.target_snapshot.version_number} Current Running
                    </Badge>
                    <span className="text-muted-foreground text-[10px]">
                      SHA: {diffData.target_snapshot.normalized_hash.slice(0, 10)}…
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleDownloadConfig(
                        diffData.target_snapshot.config_text,
                        `v${diffData.target_snapshot.version_number}-current`
                      )
                    }
                    className="gap-1 text-[11px]"
                  >
                    <Download className="w-3 h-3" /> .cfg
                  </Button>
                </div>
              </div>

              {/* Diff Rows */}
              <div className="divide-y divide-border/40 text-xs">
                {visibleRows.length === 0 ? (
                  <div className="p-16 text-center text-muted-foreground">
                    No configuration differences found matching current filters.
                  </div>
                ) : (
                  visibleRows.map((row, idx) => {
                    const leftBg =
                      row.type === 'removed' || row.type === 'modified'
                        ? 'bg-destructive/15 text-rose-700 dark:text-rose-300'
                        : 'text-foreground';
                    const rightBg =
                      row.type === 'added' || row.type === 'modified'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'text-foreground';

                    return (
                      <div key={idx} className="grid grid-cols-2 hover:bg-muted/30 transition-colors">
                        {/* Left Baseline */}
                        <div
                          className={`flex items-start border-r border-border/80 px-3 py-1 ${leftBg}`}
                        >
                          <span className="w-8 shrink-0 select-none text-muted-foreground/60 text-right pr-2 text-[10px]">
                            {row.left_line ?? ''}
                          </span>
                          <span className="w-4 shrink-0 select-none font-bold text-destructive">
                            {row.type === 'removed' ||
                            (row.type === 'modified' && row.left_text !== null)
                              ? '-'
                              : ' '}
                          </span>
                          <span className="whitespace-pre-wrap break-all leading-relaxed">
                            {row.left_text ?? ''}
                          </span>
                        </div>

                        {/* Right Target */}
                        <div className={`flex items-start justify-between px-3 py-1 ${rightBg}`}>
                          <div className="flex items-start">
                            <span className="w-8 shrink-0 select-none text-muted-foreground/60 text-right pr-2 text-[10px]">
                              {row.right_line ?? ''}
                            </span>
                            <span className="w-4 shrink-0 select-none font-bold text-emerald-600 dark:text-emerald-400">
                              {row.type === 'added' ||
                              (row.type === 'modified' && row.right_text !== null)
                                ? '+'
                                : ' '}
                            </span>
                            <span className="whitespace-pre-wrap break-all leading-relaxed">
                              {row.right_text ?? ''}
                            </span>
                          </div>

                          {row.risk && (
                            <Badge variant="destructive" className="ml-2 shrink-0 text-[9px]">
                              {row.risk.category}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : viewMode === 'unified' ? (
            <div className="p-5">
              <pre className="p-4 rounded-md bg-secondary/30 border border-border text-xs text-foreground overflow-x-auto leading-relaxed">
                {diffData.diff.unified_diff ||
                  '# No semantic differences found between selected baseline and target snapshots.'}
              </pre>
            </div>
          ) : (
            <div className="p-6 max-w-4xl mx-auto space-y-4">
              <Card className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  <div>
                    <CardTitle className="text-xs">
                      Automated Vendor Rollback Script ({diffData.device.vendor})
                    </CardTitle>
                    <CardDescription className="text-[11px] mt-0.5">
                      Copy into SSH session or click "Revert LKG" above to execute automatically.
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyRollback}
                  className="gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? 'Copied!' : 'Copy Script'}
                </Button>
              </Card>

              <pre className="p-4 rounded-md bg-secondary/30 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 overflow-x-auto leading-relaxed font-mono">
                {diffData.diff.rollback_cli}
              </pre>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

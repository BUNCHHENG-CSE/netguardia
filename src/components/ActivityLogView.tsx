import React, { useEffect, useState } from 'react';
import {
  Activity,
  ShieldAlert,
  RotateCcw,
  RefreshCw,
  FileDown,
  Terminal,
  CheckCircle2,
  Clock,
  Filter,
  Check,
  Server,
  Layers,
} from 'lucide-react';
import { api } from '../api';
import type { AuditLogEntry } from '../types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface ActivityLogViewProps {
  onNotify?: (message: string, type?: 'success' | 'info' | 'warning') => void;
}

export function ActivityLogView({ onNotify }: ActivityLogViewProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  const loadLogs = async () => {
    try {
      setLoading(true);
      const data = await api.listAuditLogs({
        limit: 100,
        action: actionFilter,
        severity: severityFilter,
      });
      setLogs(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed loading audit logs';
      if (onNotify) onNotify(msg, 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [actionFilter, severityFilter]);

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'DRIFT_DETECTED':
        return <ShieldAlert className="w-4 h-4 text-destructive" />;
      case 'ROLLBACK_EXECUTED':
        return <RotateCcw className="w-4 h-4 text-amber-400" />;
      case 'LKG_PROMOTED':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'DR_EXPORT':
        return <FileDown className="w-4 h-4 text-primary" />;
      case 'COMPLIANCE_SCAN':
        return <Layers className="w-4 h-4 text-cyan-400" />;
      default:
        return <Activity className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 font-mono">
              <Activity className="w-5 h-5 text-primary" />
              Operational Activity & Audit Trail
            </h2>
            <Badge variant="outline" className="text-[10px]">
              Compliance Log
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Chronological audit feed of backups, baseline promotions, drift detections, and operator actions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Feed</span>
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-mono text-[11px] text-muted-foreground">Action:</span>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="bg-secondary text-foreground text-[11px] rounded px-2 py-1 border border-border cursor-pointer font-mono"
              >
                <option value="ALL">All Actions</option>
                <option value="BACKUP_RUN">Backup Executed</option>
                <option value="DRIFT_DETECTED">Drift Detected</option>
                <option value="LKG_PROMOTED">LKG Promoted</option>
                <option value="ROLLBACK_EXECUTED">Rollback Executed</option>
                <option value="COMPLIANCE_SCAN">Compliance Scanned</option>
                <option value="DR_EXPORT">DR Export</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-muted-foreground">Severity:</span>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="bg-secondary text-foreground text-[11px] rounded px-2 py-1 border border-border cursor-pointer font-mono"
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="SUCCESS">Success</option>
                <option value="INFO">Info</option>
              </select>
            </div>
          </div>

          <div className="text-muted-foreground text-[11px] font-mono">
            Showing <strong className="text-foreground">{logs.length}</strong> events
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Timeline */}
      {logs.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent className="space-y-2">
            <Activity className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-semibold text-foreground">No audit entries found</p>
            <p className="text-xs text-muted-foreground">
              Try changing the filter parameters or running a backup/scan.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 font-mono">
          {logs.map((log) => (
            <Card key={log.id} className="border-border/70 hover:border-border transition-colors">
              <CardContent className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-1.5 rounded bg-secondary/80 shrink-0">
                    {getActionIcon(log.action)}
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-xs text-foreground">{log.action}</span>
                      <Badge
                        variant={
                          log.severity === 'CRITICAL'
                            ? 'destructive'
                            : log.severity === 'WARNING'
                            ? 'warning'
                            : log.severity === 'SUCCESS'
                            ? 'success'
                            : 'secondary'
                        }
                        className="text-[9px] px-1.5 py-0"
                      >
                        {log.severity}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        Target: {log.target}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">{log.details}</p>
                  </div>
                </div>

                <div className="sm:text-right shrink-0 text-[11px] text-muted-foreground flex sm:flex-col items-center sm:items-end justify-between gap-1 pt-1 sm:pt-0 border-t sm:border-0 border-border/40">
                  <span className="flex items-center gap-1 text-[10px]">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">Actor: {log.actor}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

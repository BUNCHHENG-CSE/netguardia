import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  GitCompare,
  Mail,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import type { BackupSettings, DriftAlert, MaintenanceWindow } from '../types';

interface MaintenanceAlertsViewProps {
  alerts: DriftAlert[];
  windows: MaintenanceWindow[];
  onOpenDiff: (deviceId: number) => void;
  onRefreshAll: () => Promise<void>;
}

export const MaintenanceAlertsView: React.FC<MaintenanceAlertsViewProps> = ({
  alerts,
  windows,
  onOpenDiff,
  onRefreshAll,
}) => {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [alertFilter, setAlertFilter] = useState<'ALL' | 'UNACK' | 'CRITICAL'>('ALL');

  // New Maintenance Window Form State
  const [winName, setWinName] = useState('Monthly Core Firmware Window');
  const [winSite, setWinSite] = useState('ALL');
  const [winDay, setWinDay] = useState('Saturday');
  const [winStart, setWinStart] = useState('03:00');
  const [winEnd, setWinEnd] = useState('05:00');

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
  }, []);

  const handleAcknowledge = async (id: number) => {
    await api.acknowledgeAlert(id);
    await onRefreshAll();
  };

  const handleAcknowledgeAll = async () => {
    await api.acknowledgeAllAlerts();
    await onRefreshAll();
  };

  const handleRollbackDevice = async (deviceId: number) => {
    await api.rollbackToLkg(deviceId);
    await onRefreshAll();
  };

  const handleToggleWindowOverride = async (winId: number) => {
    await api.toggleMaintenanceWindow(winId);
    await onRefreshAll();
  };

  const handleAddWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.createMaintenanceWindow({
      name: winName,
      site: winSite,
      day_of_week: winDay,
      start_time_utc: winStart,
      end_time_utc: winEnd,
      is_active_override: false,
      auto_promote_lkg: true,
    });
    await onRefreshAll();
  };

  const handleDeleteWindow = async (id: number) => {
    await api.deleteMaintenanceWindow(id);
    await onRefreshAll();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
      await onRefreshAll();
    } finally {
      setSavingSettings(false);
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    if (alertFilter === 'UNACK') return !a.acknowledged;
    if (alertFilter === 'CRITICAL') return a.severity === 'CRITICAL';
    return true;
  });

  const unackCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left 7 Cols: Incident Feed */}
      <div className="lg:col-span-7 space-y-4">
        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-400" />
                  Configuration Integrity Incident Feed
                  {unackCount > 0 && (
                    <Badge variant="destructive" className="ml-1 animate-pulse">
                      {unackCount} Active
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Alerts fire only when changes occur outside scheduled maintenance windows.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg bg-secondary/60 p-0.5 border border-border text-xs">
                  <button
                    onClick={() => setAlertFilter('ALL')}
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                      alertFilter === 'ALL'
                        ? 'bg-background text-foreground font-bold shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All ({alerts.length})
                  </button>
                  <button
                    onClick={() => setAlertFilter('UNACK')}
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                      alertFilter === 'UNACK'
                        ? 'bg-background text-destructive font-bold shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Active ({unackCount})
                  </button>
                </div>

                {unackCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAcknowledgeAll}
                  >
                    Ack All
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-2.5">
            {filteredAlerts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                <p>Zero configuration drift alerts matching current filter.</p>
              </div>
            ) : (
              filteredAlerts.map((a) => (
                <div
                  key={a.id}
                  className={`p-3.5 rounded-lg border transition ${
                    a.acknowledged
                      ? 'border-border/60 bg-muted/20 opacity-60'
                      : a.severity === 'CRITICAL'
                      ? 'border-destructive/30 bg-destructive/10'
                      : 'border-amber-500/30 bg-amber-500/10'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 max-w-xl">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={a.severity === 'CRITICAL' ? 'destructive' : 'warning'}>
                          {a.severity}
                        </Badge>

                        {a.outside_maintenance_window && (
                          <Badge variant="outline" className="text-destructive border-destructive/30">
                            OUT-OF-WINDOW
                          </Badge>
                        )}

                        <span className="text-xs font-bold text-foreground font-mono">
                          {a.hostname}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          ({a.ip_address})
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(a.created_at).toLocaleTimeString()}
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-foreground">{a.title}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{a.message}</p>

                      {a.risk_categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {a.risk_categories.map((cat, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              {cat}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenDiff(a.device_id)}
                        className="gap-1"
                      >
                        <GitCompare className="w-3.5 h-3.5" />
                        Diff
                      </Button>

                      {a.alert_type === 'OUT_OF_WINDOW_DRIFT' && !a.acknowledged && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRollbackDevice(a.device_id)}
                          className="gap-1 text-amber-300 hover:text-amber-200"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Revert LKG
                        </Button>
                      )}

                      {!a.acknowledged && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAcknowledge(a.id)}
                        >
                          Ack
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right 5 Cols: Maintenance Windows & Collector Form */}
      <div className="lg:col-span-5 space-y-5">
        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-foreground" />
              Maintenance Windows
            </CardTitle>
            <CardDescription className="mt-0.5">
              Changes during active windows auto-promote to LKG baseline without firing false alerts.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              {windows.map((w) => (
                <div
                  key={w.id}
                  className={`p-3 rounded-md border flex items-center justify-between gap-3 text-xs transition ${
                    w.is_active_override
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-border bg-background/50'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      {w.name}
                      {Boolean(w.is_active_override) && (
                        <Badge variant="success" className="gap-1 py-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          ACTIVE
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                      {w.site} • {w.day_of_week} {w.start_time_utc}–{w.end_time_utc} UTC
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant={w.is_active_override ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={() => handleToggleWindowOverride(w.id)}
                    >
                      {w.is_active_override ? 'Close' : 'Activate'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteWindow(w.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Window Inline Form */}
            <form onSubmit={handleAddWindow} className="pt-3 border-t border-border space-y-2 text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                Add Scheduled Window
              </span>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  required
                  value={winName}
                  onChange={(e) => setWinName(e.target.value)}
                  placeholder="Window Name"
                />
                <Select
                  value={winSite}
                  onChange={(e) => setWinSite(e.target.value)}
                  className="w-full"
                >
                  <option value="ALL">All Sites</option>
                  <option value="HQ-Campus (Austin)">HQ-Campus (Austin)</option>
                  <option value="Branch-DC (Frankfurt)">Branch-DC (Frankfurt)</option>
                </Select>
                <Select
                  value={winDay}
                  onChange={(e) => setWinDay(e.target.value)}
                  className="w-full"
                >
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Daily'].map(
                    (d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    )
                  )}
                </Select>
                <div className="flex items-center gap-1">
                  <Input
                    value={winStart}
                    onChange={(e) => setWinStart(e.target.value)}
                    className="font-mono text-center"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    value={winEnd}
                    onChange={(e) => setWinEnd(e.target.value)}
                    className="font-mono text-center"
                  />
                </div>
              </div>

              <Button type="submit" variant="outline" size="sm" className="w-full gap-1.5 mt-1">
                <Plus className="w-3.5 h-3.5" />
                Create Window
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Collector Schedule & Alert Policy */}
        {settings && (
          <Card>
            <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-foreground" />
                Collector Engine Policy
              </CardTitle>
              {savedToast && (
                <Badge variant="success" className="animate-pulse">
                  Policy Saved
                </Badge>
              )}
            </CardHeader>

            <CardContent className="pt-4">
              <form onSubmit={handleSaveSettings} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-muted-foreground mb-1">Cron (UTC)</label>
                    <Input
                      value={settings.cron_expression}
                      onChange={(e) =>
                        setSettings({ ...settings, cron_expression: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-muted-foreground mb-1">Stale Days</label>
                    <Input
                      type="number"
                      value={settings.stale_backup_threshold_days}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          stale_backup_threshold_days: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">Webhook URL</label>
                  <Input
                    value={settings.webhook_url}
                    onChange={(e) => setSettings({ ...settings, webhook_url: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">NetOps Email</label>
                  <Input
                    value={settings.notification_email}
                    onChange={(e) =>
                      setSettings({ ...settings, notification_email: e.target.value })
                    }
                  />
                </div>

                <Button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full gap-1.5 mt-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingSettings ? 'Saving...' : 'Save Collector Policy'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

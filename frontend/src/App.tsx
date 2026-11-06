import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Cpu,
  Database,
  FileDown,
  GitBranch,
  KeyRound,
  Keyboard,
  LayoutDashboard,
  Monitor,
  Moon,
  Network,
  RefreshCcw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Terminal,
} from 'lucide-react';
import { api } from './api';
import { DashboardView } from './components/DashboardView';
import { DevicesView } from './components/DevicesView';
import { DiffViewerModal } from './components/DiffViewerModal';
import { MaintenanceAlertsView } from './components/MaintenanceAlertsView';
import { TopologyView } from './components/TopologyView';
import { VaultView } from './components/VaultView';
import { ComplianceView } from './components/ComplianceView';
import { FleetSearchView } from './components/FleetSearchView';
import { ActivityLogView } from './components/ActivityLogView';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { useTheme } from './lib/theme';
import type {
  CredentialProfile,
  DriftAlert,
  MaintenanceWindow,
  NetworkDevice,
  OverviewMetrics,
} from './types';

export type NavTab =
  | 'dashboard'
  | 'devices'
  | 'topology'
  | 'maintenance'
  | 'compliance'
  | 'search'
  | 'activity'
  | 'vault';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [alerts, setAlerts] = useState<DriftAlert[]>([]);
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [credentials, setCredentials] = useState<CredentialProfile[]>([]);
  const [diffDeviceId, setDiffDeviceId] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'info' | 'warning';
  } | null>(null);

  const { theme, toggleTheme, resolvedTheme } = useTheme();

  const notify = (
    message: string,
    type: 'success' | 'info' | 'warning' = 'info'
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const [ov, devs, alts, wins, creds] = await Promise.all([
        api.getOverview(),
        api.listDevices(),
        api.listAlerts(),
        api.listMaintenanceWindows(),
        api.listCredentials(),
      ]);
      setOverview(ov);
      setDevices(devs);
      setAlerts(alts);
      setWindows(wins);
      setCredentials(creds);
    } catch (err) {
      console.error('Failed loading NetGuardia state:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }
      if (e.key === '1') setActiveTab('dashboard');
      else if (e.key === '2') setActiveTab('devices');
      else if (e.key === '3') setActiveTab('topology');
      else if (e.key === '4') setActiveTab('maintenance');
      else if (e.key === '5') setActiveTab('compliance');
      else if (e.key === '6') setActiveTab('search');
      else if (e.key === '7') setActiveTab('vault');
      else if (e.key === '8') setActiveTab('activity');
      else if (e.key === '?') setShowShortcuts((prev) => !prev);
      else if (e.key === 'Escape') {
        setDiffDeviceId(null);
        setShowShortcuts(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleResetDemo = async () => {
    setResetting(true);
    try {
      await api.resetDemo();
      await loadAll();
      notify('Demo laboratory environment reset successfully.', 'success');
    } finally {
      setResetting(false);
    }
  };

  const unackCount = alerts.filter((a) => !a.acknowledged).length;
  const driftedCount = overview?.drifted_devices ?? devices.filter((d) => d.drift_detected).length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-mono selection:bg-primary/20 selection:text-primary transition-colors duration-150">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
          
          {/* Brand Logo & Telemetry Status */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-foreground text-background flex items-center justify-center font-bold shadow-sm">
              <ShieldCheck className="w-4 h-4" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-foreground">
                  TCT NetGuardia
                </span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  NOC Core
                </Badge>
                <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Fleet Shield Active
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground hidden sm:block">
                Network Config Baseline, Topology & Compliance Automator
              </p>
            </div>
          </div>

          {/* Primary Navigation Tabs */}
          <nav className="flex items-center gap-1 bg-secondary/60 p-1 rounded-lg border border-border overflow-x-auto max-w-full">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('devices')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'devices'
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Devices</span>
              {driftedCount > 0 && (
                <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                  {driftedCount}
                </Badge>
              )}
            </button>

            <button
              onClick={() => setActiveTab('topology')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'topology'
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Topology</span>
            </button>

            <button
              onClick={() => setActiveTab('compliance')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'compliance'
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Compliance</span>
            </button>

            <button
              onClick={() => setActiveTab('search')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'search'
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search</span>
            </button>

            <button
              onClick={() => setActiveTab('maintenance')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'maintenance'
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Alerts</span>
              {unackCount > 0 && (
                <Badge variant="destructive" className="px-1.5 py-0 text-[10px] animate-pulse">
                  {unackCount}
                </Badge>
              )}
            </button>

            <button
              onClick={() => setActiveTab('activity')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'activity'
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Activity</span>
            </button>

            <button
              onClick={() => setActiveTab('vault')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'vault'
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Vault</span>
            </button>
          </nav>

          {/* Right Status, Theme Toggle & Quick Action Buttons */}
          <div className="flex items-center gap-2">
            {overview?.database && (
              <Badge variant="outline" className="hidden 2xl:inline-flex items-center gap-1.5 px-2 py-1 text-[11px]">
                <Database className="w-3 h-3 text-muted-foreground" />
                <span>{overview.database.engine}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </Badge>
            )}

            {/* Keyboard Shortcuts Trigger */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowShortcuts(true)}
              title="Keyboard Shortcuts (?)"
            >
              <Keyboard className="w-3.5 h-3.5 text-foreground" />
            </Button>

            {/* Theme Toggle Button */}
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              title={`Current theme: ${theme} (Click to toggle)`}
            >
              {theme === 'system' ? (
                <Monitor className="w-3.5 h-3.5 text-foreground" />
              ) : resolvedTheme === 'dark' ? (
                <Moon className="w-3.5 h-3.5 text-foreground" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-foreground" />
              )}
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={loadAll}
              disabled={isRefreshing}
              title="Refresh telemetry"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleResetDemo}
              disabled={resetting}
              title="Reset lab to initial clean state"
              className="gap-1.5"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Reset Lab</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'dashboard' && (
          <DashboardView
            overview={overview}
            devices={devices}
            alerts={alerts}
            onOpenDiff={(id) => setDiffDeviceId(id)}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onRefreshAll={loadAll}
          />
        )}

        {activeTab === 'devices' && (
          <DevicesView
            devices={devices}
            credentials={credentials}
            onOpenDiff={(id) => setDiffDeviceId(id)}
            onRefreshAll={loadAll}
          />
        )}

        {activeTab === 'topology' && (
          <TopologyView onOpenDiff={(id) => setDiffDeviceId(id)} />
        )}

        {activeTab === 'compliance' && (
          <ComplianceView onOpenDiff={(id) => setDiffDeviceId(id)} onNotify={notify} />
        )}

        {activeTab === 'search' && (
          <FleetSearchView onOpenDiff={(id) => setDiffDeviceId(id)} onNotify={notify} />
        )}

        {activeTab === 'maintenance' && (
          <MaintenanceAlertsView
            alerts={alerts}
            windows={windows}
            onOpenDiff={(id) => setDiffDeviceId(id)}
            onRefreshAll={loadAll}
          />
        )}

        {activeTab === 'activity' && (
          <ActivityLogView onNotify={notify} />
        )}

        {activeTab === 'vault' && (
          <VaultView credentials={credentials} onRefreshAll={loadAll} />
        )}
      </main>

      {/* Footer Status Bar */}
      <footer className="border-t border-border bg-background/50 py-3 text-[11px] text-muted-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 font-mono">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              LKG Diff Engine: Active
            </span>
            <span className="text-border">•</span>
            <span>Volatile Noise Suppression: 4 Regex Parsers</span>
            <span className="text-border hidden md:inline">•</span>
            <span className="hidden md:inline">CIS Compliance Scanner: Ready</span>
          </div>
          <div className="flex items-center gap-3">
            <span>Press <kbd className="px-1.5 py-0.5 rounded bg-secondary text-foreground text-[10px] font-bold">?</kbd> for shortcuts</span>
            <span className="text-border">•</span>
            <span>Theme: <strong className="text-foreground capitalize">{theme}</strong></span>
            <span className="text-border">•</span>
            <span className="text-foreground">v2.5.0</span>
          </div>
        </div>
      </footer>

      {/* Diff Viewer Modal */}
      {diffDeviceId !== null && (
        <DiffViewerModal
          deviceId={diffDeviceId}
          onClose={() => setDiffDeviceId(null)}
          onUpdated={loadAll}
        />
      )}

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Toast Feedback Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3.5 py-2 rounded-lg bg-foreground text-background text-xs font-mono font-semibold shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-200">
          <span
            className={`w-2 h-2 rounded-full ${
              toast.type === 'success'
                ? 'bg-emerald-400'
                : toast.type === 'warning'
                ? 'bg-amber-400'
                : 'bg-cyan-400'
            }`}
          />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;


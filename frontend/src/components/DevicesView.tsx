import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  FileDown,
  Flame,
  GitCompare,
  HardDrive,
  LayoutGrid,
  List,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import type { CredentialProfile, NetworkDevice } from '../types';

interface DevicesViewProps {
  devices: NetworkDevice[];
  credentials: CredentialProfile[];
  onOpenDiff: (deviceId: number) => void;
  onRefreshAll: () => Promise<void>;
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  devices,
  credentials,
  onOpenDiff,
  onRefreshAll,
}) => {
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRIFT' | 'STALE' | 'CLEAN'>('ALL');
  const [viewLayout, setViewLayout] = useState<'table' | 'cards'>('table');
  const [busyDeviceId, setBusyDeviceId] = useState<number | null>(null);
  const [driftModalDevice, setDriftModalDevice] = useState<NetworkDevice | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string>('rogue_acl');
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [backingUpAll, setBackingUpAll] = useState(false);

  const handleBackupAll = async () => {
    setBackingUpAll(true);
    try {
      await api.runAllBackups();
      await onRefreshAll();
    } finally {
      setBackingUpAll(false);
    }
  };

  // Add Device Form State
  const [newHost, setNewHost] = useState('hq-access-sw03');
  const [newIp, setNewIp] = useState('10.10.3.3');
  const [newPort, setNewPort] = useState(22);
  const [newVendor, setNewVendor] = useState('Cisco');
  const [newModel, setNewModel] = useState('Catalyst C9200L-48P');
  const [newOs, setNewOs] = useState('Cisco IOS-XE 17.9');
  const [newRole, setNewRole] = useState('Access Switch');
  const [newSite, setNewSite] = useState('HQ-Campus (Austin)');
  const [newCredId, setNewCredId] = useState<number>(credentials[0]?.id ?? 1);
  const [newIsSim, setNewIsSim] = useState(true);
  const [newUplinkHost, setNewUplinkHost] = useState('hq-dist-sw01');

  const filteredDevices = devices.filter((d) => {
    const matchesSearch =
      d.hostname.toLowerCase().includes(search.toLowerCase()) ||
      d.ip_address.includes(search) ||
      d.model.toLowerCase().includes(search.toLowerCase()) ||
      d.site.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (vendorFilter !== 'ALL' && d.vendor.toLowerCase() !== vendorFilter.toLowerCase()) {
      return false;
    }
    if (statusFilter === 'DRIFT' && !d.drift_detected) return false;
    if (statusFilter === 'STALE' && !d.is_stale) return false;
    if (statusFilter === 'CLEAN' && (d.drift_detected || d.is_stale)) return false;
    return true;
  });

  const handleCopyIp = (ip: string) => {
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 1800);
  };

  const handleBackupNow = async (deviceId: number) => {
    setBusyDeviceId(deviceId);
    try {
      await api.backupDevice(deviceId);
      await onRefreshAll();
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleInjectDrift = async () => {
    if (!driftModalDevice) return;
    setBusyDeviceId(driftModalDevice.id);
    try {
      await api.simulateDrift(driftModalDevice.id, selectedScenario);
      setDriftModalDevice(null);
      await onRefreshAll();
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleCreateDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.createDevice({
      hostname: newHost,
      ip_address: newIp,
      ssh_port: newPort,
      vendor: newVendor,
      model: newModel,
      os_type: newOs,
      role: newRole,
      site: newSite,
      credential_id: newCredId,
      is_simulated: newIsSim,
      uplink_hostname: newUplinkHost,
    });
    setShowAddModal(false);
    await onRefreshAll();
  };

  const handleDeleteDevice = async (deviceId: number, hostname: string) => {
    if (!window.confirm(`Remove device ${hostname} and all historical snapshots?`)) return;
    await api.deleteDevice(deviceId);
    await onRefreshAll();
  };

  return (
    <div className="space-y-5">
      {/* Control Toolbar */}
      <Card>
        <CardContent className="p-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search hostname, IP, site..."
                className="pl-8 w-60"
              />
            </div>

            {/* Vendor Filter */}
            <Select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="w-auto"
            >
              <option value="ALL">All Vendors (Cisco, Juniper, Ubiquiti)</option>
              <option value="Cisco">Cisco IOS / IOS-XE</option>
              <option value="Juniper">Juniper Junos</option>
              <option value="Ubiquiti">Ubiquiti EdgeOS / UniFi</option>
            </Select>

            {/* Status Segmented Buttons */}
            <div className="inline-flex rounded-lg bg-secondary/60 p-0.5 border border-border text-xs">
              {(['ALL', 'DRIFT', 'STALE', 'CLEAN'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                    statusFilter === st
                      ? 'bg-background text-foreground font-bold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {st === 'ALL'
                    ? `All (${devices.length})`
                    : st === 'DRIFT'
                    ? `Drift (${devices.filter((d) => d.drift_detected).length})`
                    : st === 'STALE'
                    ? `Stale (${devices.filter((d) => d.is_stale).length})`
                    : `Clean (${devices.filter((d) => !d.drift_detected && !d.is_stale).length})`}
                </button>
              ))}
            </div>
          </div>

          {/* View Toggle & Add Device */}
          <div className="flex items-center gap-2.5">
            <div className="inline-flex rounded-lg bg-secondary/60 p-0.5 border border-border">
              <button
                onClick={() => setViewLayout('table')}
                className={`p-1.5 rounded-md transition ${
                  viewLayout === 'table' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Table View"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewLayout('cards')}
                className={`p-1.5 rounded-md transition ${
                  viewLayout === 'cards' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Card View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleBackupAll}
              disabled={backingUpAll}
              className="gap-1.5"
              title="Execute scheduled backup across all fleet devices"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${backingUpAll ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Backup Fleet</span>
            </Button>

            <Button
              onClick={() => setShowAddModal(true)}
              size="sm"
              className="gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Device
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main View: Table or Card Grid */}
      {viewLayout === 'table' ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 px-4">Device & IP</th>
                  <th className="py-3 px-4">Vendor & OS</th>
                  <th className="py-3 px-4">Site / Role</th>
                  <th className="py-3 px-4">LKG Baseline</th>
                  <th className="py-3 px-4">Backup Age</th>
                  <th className="py-3 px-4">Peers</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-xs">
                {filteredDevices.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/40 transition">
                    {/* Device & IP */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            d.drift_detected
                              ? 'bg-amber-400'
                              : d.is_stale
                              ? 'bg-destructive'
                              : 'bg-emerald-400'
                          }`}
                        />
                        <div>
                          <div className="font-bold text-foreground flex items-center gap-1.5">
                            {d.hostname}
                            {!d.is_simulated && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 text-cyan-400">
                                SSH
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <span
                              onClick={() => handleCopyIp(d.ip_address)}
                              className="cursor-pointer hover:text-foreground transition"
                              title="Click to copy IP"
                            >
                              {d.ip_address}:{d.ssh_port}
                            </span>
                            {copiedIp === d.ip_address && (
                              <span className="text-[10px] text-emerald-400">Copied!</span>
                            )}
                            <span>•</span>
                            <span>{d.credential_name || 'No Key'}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Vendor & Model */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={
                            d.vendor.toLowerCase() === 'cisco'
                              ? 'info'
                              : d.vendor.toLowerCase() === 'juniper'
                              ? 'success'
                              : 'purple'
                          }
                          className="px-1.5 py-0 text-[10px]"
                        >
                          {d.vendor}
                        </Badge>
                        <span className="text-foreground">{d.model}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{d.os_type}</div>
                    </td>

                    {/* Site & Role */}
                    <td className="py-3 px-4">
                      <div className="text-foreground">{d.site}</div>
                      <div className="text-[11px] text-muted-foreground">{d.role}</div>
                    </td>

                    {/* LKG Status */}
                    <td className="py-3 px-4">
                      {d.drift_detected ? (
                        <Badge variant="warning" className="gap-1">
                          <ShieldAlert className="w-3 h-3" />
                          Drift (v{d.latest_version} ≠ v{d.lkg_version})
                        </Badge>
                      ) : (
                        <Badge variant="success" className="gap-1">
                          <ShieldCheck className="w-3 h-3" />
                          Matches LKG (v{d.lkg_version})
                        </Badge>
                      )}
                    </td>

                    {/* Backup Age */}
                    <td className="py-3 px-4">
                      <div
                        className={`font-semibold flex items-center gap-1 ${
                          d.is_stale ? 'text-destructive' : 'text-foreground'
                        }`}
                      >
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        {d.backup_age_days < 1
                          ? `${Math.max(1, Math.round(d.backup_age_days * 24))}h ago`
                          : `${Math.round(d.backup_age_days)}d ago`}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {d.snapshot_count} snapshot{d.snapshot_count > 1 ? 's' : ''}
                      </div>
                    </td>

                    {/* Peers */}
                    <td className="py-3 px-4">
                      <Badge variant="outline" className="gap-1">
                        <Network className="w-3 h-3" />
                        {d.neighbor_count} peer{d.neighbor_count > 1 ? 's' : ''}
                      </Badge>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenDiff(d.id)}
                          className="gap-1"
                          title="Open Diff against LKG Baseline"
                        >
                          <GitCompare className="w-3 h-3" />
                          Diff
                        </Button>

                        <a
                          href={api.getDeviceExportUrl(d.id, 'latest')}
                          download
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border bg-background hover:bg-secondary text-foreground transition-colors"
                          title="Download running config (.cfg)"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                        </a>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleBackupNow(d.id)}
                          disabled={busyDeviceId === d.id}
                          title="Backup device now"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${busyDeviceId === d.id ? 'animate-spin' : ''}`}
                          />
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDriftModalDevice(d)}
                          title="Simulate Drift"
                          className="text-amber-400 hover:text-amber-300"
                        >
                          <Flame className="w-3 h-3" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteDevice(d.id, d.hostname)}
                          title="Delete Device"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* Card Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDevices.map((d) => (
            <Card
              key={d.id}
              className={`p-4 space-y-3 relative overflow-hidden transition-all ${
                d.drift_detected
                  ? 'border-amber-500/40'
                  : d.is_stale
                  ? 'border-destructive/40'
                  : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        d.drift_detected
                          ? 'bg-amber-400'
                          : d.is_stale
                          ? 'bg-destructive'
                          : 'bg-emerald-400'
                      }`}
                    />
                    <CardTitle className="text-xs">{d.hostname}</CardTitle>
                  </div>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {d.ip_address}:{d.ssh_port}
                  </p>
                </div>

                <Badge
                  variant={
                    d.vendor.toLowerCase() === 'cisco'
                      ? 'info'
                      : d.vendor.toLowerCase() === 'juniper'
                      ? 'success'
                      : 'purple'
                  }
                >
                  {d.vendor}
                </Badge>
              </div>

              <div className="p-2.5 rounded-md border border-border bg-background/50 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Model / OS:</span>
                  <span className="text-foreground truncate max-w-[170px]">{d.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Site & Role:</span>
                  <span className="text-foreground">{d.site} ({d.role})</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-border">
                  <span className="text-muted-foreground">Baseline:</span>
                  {d.drift_detected ? (
                    <span className="text-amber-400 font-bold text-[10px]">
                      DRIFT (v{d.latest_version} ≠ v{d.lkg_version})
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-bold text-[10px]">
                      LKG MATCH (v{d.lkg_version})
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Backup Age:</span>
                  <span
                    className={`font-semibold ${
                      d.is_stale ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {d.backup_age_days < 1
                      ? `${Math.max(1, Math.round(d.backup_age_days * 24))}h ago`
                      : `${Math.round(d.backup_age_days)}d ago`}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-1.5 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenDiff(d.id)}
                  className="flex-1 gap-1"
                >
                  <GitCompare className="w-3 h-3" />
                  Diff
                </Button>

                <a
                  href={api.getDeviceExportUrl(d.id, 'latest')}
                  download
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border bg-background hover:bg-secondary text-foreground transition-colors"
                  title="Download running config (.cfg)"
                >
                  <FileDown className="w-3.5 h-3.5" />
                </a>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBackupNow(d.id)}
                  disabled={busyDeviceId === d.id}
                >
                  <RefreshCw
                    className={`w-3 h-3 ${busyDeviceId === d.id ? 'animate-spin' : ''}`}
                  />
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDriftModalDevice(d)}
                  title="Simulate Drift"
                  className="text-amber-400 hover:text-amber-300"
                >
                  <Flame className="w-3 h-3" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteDevice(d.id, d.hostname)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Simulate Drift Modal */}
      {driftModalDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-5 space-y-4 shadow-2xl border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" />
                  Simulate Out-of-Window Drift
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Target device: <strong className="text-foreground">{driftModalDevice.hostname}</strong> ({driftModalDevice.vendor})
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDriftModalDevice(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-2 text-xs">
              {[
                {
                  id: 'rogue_acl',
                  title: 'Unauthorized WAN ACL Exposure (CRITICAL)',
                  desc: 'Permits inbound TCP 22/23 traffic outside scheduled window.',
                },
                {
                  id: 'ospf_route_leak',
                  title: 'Unapproved OSPF Static Route Override (HIGH)',
                  desc: 'Modifies OSPF area network statements and injects static route.',
                },
                {
                  id: 'backdoor_user',
                  title: 'Undocumented Privilege-15 Account (CRITICAL)',
                  desc: 'Creates contractor_temp user with read-write SNMP community.',
                },
                {
                  id: 'vlan_trunk_drift',
                  title: 'Core Uplink Trunk VLAN 999 Addition (MEDIUM)',
                  desc: 'Appends unmanaged VLAN 999 to core trunk links.',
                },
              ].map((sc) => (
                <label
                  key={sc.id}
                  className={`block p-3 rounded-md border cursor-pointer transition ${
                    selectedScenario === sc.id
                      ? 'border-amber-500/50 bg-amber-500/10 text-foreground'
                      : 'border-border bg-background/50 text-muted-foreground hover:border-foreground/40'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <input
                      type="radio"
                      name="drift_scenario"
                      checked={selectedScenario === sc.id}
                      onChange={() => setSelectedScenario(sc.id)}
                      className="text-primary focus:ring-primary"
                    />
                    <span>{sc.title}</span>
                  </div>
                  <p className="text-muted-foreground mt-1 pl-5">{sc.desc}</p>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDriftModalDevice(null)}
              >
                Cancel
              </Button>
              <Button
                variant="amber"
                size="sm"
                onClick={handleInjectDrift}
                disabled={busyDeviceId === driftModalDevice.id}
              >
                {busyDeviceId === driftModalDevice.id
                  ? 'Injecting...'
                  : 'Inject & Trigger Collector'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Add Device Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-xl p-5 space-y-4 shadow-2xl border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <CardTitle>Onboard Network Device</CardTitle>
                <CardDescription className="mt-0.5">
                  Multi-vendor collector (Live SSH or Simulated Lab)
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAddModal(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateDevice} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-muted-foreground mb-1">Hostname</label>
                  <Input
                    required
                    value={newHost}
                    onChange={(e) => setNewHost(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">Management IP</label>
                  <Input
                    required
                    value={newIp}
                    onChange={(e) => setNewIp(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">Vendor Family</label>
                  <Select
                    value={newVendor}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNewVendor(v);
                      if (v === 'Juniper') {
                        setNewModel('EX3400-24P');
                        setNewOs('Junos 22.4R3');
                      } else if (v === 'Ubiquiti') {
                        setNewModel('UniFi USW-Pro-24');
                        setNewOs('Ubiquiti EdgeOS 2.0.9');
                      } else {
                        setNewModel('Catalyst C9200L-48P');
                        setNewOs('Cisco IOS-XE 17.9');
                      }
                    }}
                    className="w-full"
                  >
                    <option value="Cisco">Cisco (IOS / IOS-XE / ASA)</option>
                    <option value="Juniper">Juniper (Junos EX / SRX)</option>
                    <option value="Ubiquiti">Ubiquiti (EdgeOS / UniFi)</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">Hardware Model</label>
                  <Input
                    required
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">Site Location</label>
                  <Select
                    value={newSite}
                    onChange={(e) => setNewSite(e.target.value)}
                    className="w-full"
                  >
                    <option value="HQ-Campus (Austin)">HQ-Campus (Austin)</option>
                    <option value="Branch-DC (Frankfurt)">Branch-DC (Frankfurt)</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">Role / Tier</label>
                  <Select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full"
                  >
                    <option value="Access Switch">Access Switch (Tier 3)</option>
                    <option value="Distribution Switch">Distribution Switch (Tier 2)</option>
                    <option value="Core Switch">Core Switch (Tier 1)</option>
                    <option value="Firewall / WAN Gateway">Firewall / WAN Gateway (Tier 0)</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">Vault Credential</label>
                  <Select
                    value={newCredId}
                    onChange={(e) => setNewCredId(Number(e.target.value))}
                    className="w-full"
                  >
                    {credentials.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.username})
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1">Uplink Neighbor</label>
                  <Select
                    value={newUplinkHost}
                    onChange={(e) => setNewUplinkHost(e.target.value)}
                    className="w-full"
                  >
                    {devices.map((d) => (
                      <option key={d.id} value={d.hostname}>
                        {d.hostname} ({d.site})
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/30 p-2.5 rounded-md border border-border cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIsSim}
                  onChange={(e) => setNewIsSim(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span>
                  Use Built-in Multi-Vendor Lab Simulator (Uncheck to connect physical SSH at {newIp}:{newPort})
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Onboard & Collect Baseline
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};

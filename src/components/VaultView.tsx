import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  Server,
  Shield,
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
import type { CredentialProfile } from '../types';

interface VaultViewProps {
  credentials: CredentialProfile[];
  onRefreshAll: () => Promise<void>;
}

export const VaultView: React.FC<VaultViewProps> = ({ credentials, onRefreshAll }) => {
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyReport, setVerifyReport] = useState<{
    credential_id: number;
    name: string;
    verified_at: string;
    devices_tested: number;
    all_passed: boolean;
    results: Array<{
      hostname: string;
      ip_address: string;
      authenticated: boolean;
      latency_ms: number;
      message: string;
    }>;
  } | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('Branch Read-Only TACACS+');
  const [protocol, setProtocol] = useState('SSH');
  const [username, setUsername] = useState('netguard_ro');
  const [password, setPassword] = useState('');
  const [enableSecret, setEnableSecret] = useState('');
  const [snmpCommunity, setSnmpCommunity] = useState('');
  const [description, setDescription] = useState('Least-privilege read-only backup account');

  const handleVerifyProfile = async (credId: number) => {
    setVerifyingId(credId);
    try {
      const res = await api.verifyCredential(credId);
      setVerifyReport(res);
      await onRefreshAll();
    } finally {
      setVerifyingId(null);
    }
  };

  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.createCredential({
      name,
      protocol,
      username,
      password: password || undefined,
      enable_secret: enableSecret || undefined,
      snmp_community: snmpCommunity || undefined,
      description,
    });
    setShowAdd(false);
    setPassword('');
    setEnableSecret('');
    setSnmpCommunity('');
    await onRefreshAll();
  };

  const handleDeleteCredential = async (id: number, credName: string) => {
    if (!window.confirm(`Permanently remove credential profile "${credName}" from Vault?`)) return;
    await api.deleteCredential(id);
    await onRefreshAll();
  };

  return (
    <div className="space-y-6">
      {/* Vault Security Banner */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3 max-w-3xl">
            <div className="p-2.5 rounded-md bg-secondary text-foreground shrink-0 border border-border">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">Zero-Cleartext Encrypted Vault</CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  AES-128-CBC + HMAC
                </Badge>
              </div>
              <CardDescription className="text-xs mt-0.5">
                All SSH keys, enable secrets, and community strings are encrypted at rest with PBKDF2 derivation and decrypted only in memory during collection sessions.
              </CardDescription>
            </div>
          </div>

          <Button
            onClick={() => setShowAdd(true)}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Profile
          </Button>
        </CardContent>
      </Card>

      {/* Live Handshake Report Banner */}
      {verifyReport && (
        <Card className="border-emerald-500/30">
          <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              Vault Verification: &quot;{verifyReport.name}&quot; — {verifyReport.devices_tested} Hardware Nodes Tested
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVerifyReport(null)}
            >
              Close
            </Button>
          </CardHeader>

          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {verifyReport.results.map((r, i) => (
              <div
                key={i}
                className="p-2.5 rounded-md border border-border bg-background/50 flex items-center justify-between font-mono"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{r.hostname}</span>
                    <span className="text-muted-foreground text-[11px]">({r.ip_address})</span>
                    <Badge variant="outline" className="text-[9px]">
                      {r.latency_ms}ms
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{r.message}</p>
                </div>
                <Badge variant={r.authenticated ? 'success' : 'destructive'}>
                  {r.authenticated ? 'VERIFIED' : 'FAILED'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Credential Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {credentials.map((c) => (
          <Card key={c.id} className="p-4 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 border-b border-border pb-3">
                <div>
                  <Badge variant="outline" className="text-[10px]">
                    {c.protocol}
                  </Badge>
                  <CardTitle className="text-xs mt-1">{c.name}</CardTitle>
                  <CardDescription className="text-[11px] mt-0.5">{c.description}</CardDescription>
                </div>
                <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
              </div>

              <div className="p-2.5 rounded-md border border-border bg-background/50 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Username:</span>
                  <span className="text-foreground font-semibold">{c.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Password:</span>
                  <span className="text-emerald-400">{c.password_masked}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Enable Secret:</span>
                  <span className="text-foreground">{c.enable_secret_masked}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SSH Key:</span>
                  <span className="text-cyan-400 text-[11px]">{c.ssh_key_masked}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SNMP String:</span>
                  <span className="text-foreground">{c.snmp_community_masked}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground font-mono">
                <strong className="text-foreground">{c.assigned_devices_count}</strong> devices
              </span>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleVerifyProfile(c.id)}
                  disabled={verifyingId === c.id}
                  className="gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {verifyingId === c.id ? 'Testing...' : 'Test'}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteCredential(c.id, c.name)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Add Credential Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-5 space-y-4 shadow-2xl border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <CardTitle>Store Encrypted Credential</CardTitle>
                <CardDescription className="mt-0.5">
                  AES-128 PBKDF2 encryption profile
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAdd(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateCredential} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted-foreground mb-1">Profile Name</label>
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">Protocol</label>
                <Select
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                  className="w-full"
                >
                  <option value="SSH">SSH v2</option>
                  <option value="TACACS">TACACS+ / RADIUS</option>
                  <option value="SNMP">SNMP v2c / v3</option>
                </Select>
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">Username / Account</label>
                <Input
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">SSH Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank if using key"
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">Cisco Enable Secret (Optional)</label>
                <Input
                  type="password"
                  value={enableSecret}
                  onChange={(e) => setEnableSecret(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">SNMP Community (Optional)</label>
                <Input
                  value={snmpCommunity}
                  onChange={(e) => setSnmpCommunity(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">Description</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Encrypt & Store
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Trash2,
  Terminal,
  FileText,
  ChevronDown,
  ChevronUp,
  Server,
  Filter,
} from 'lucide-react';
import { api } from '../api';
import type {
  ComplianceRule,
  FleetComplianceReport,
  DeviceComplianceResult,
} from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';

interface ComplianceViewProps {
  onOpenDiff: (deviceId: number) => void;
  onNotify?: (message: string, type?: 'success' | 'info' | 'warning') => void;
}

export function ComplianceView({ onOpenDiff, onNotify }: ComplianceViewProps) {
  const [report, setReport] = useState<FleetComplianceReport | null>(null);
  const [rules, setRules] = useState<ComplianceRule[]>([]);
  const [scanning, setScanning] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'devices' | 'rules'>('devices');
  const [filterSeverity, setFilterSeverity] = useState('ALL');
  const [expandedDeviceId, setExpandedDeviceId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New Rule Modal
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRule, setNewRule] = useState({
    rule_id: '',
    name: '',
    description: '',
    severity: 'HIGH',
    vendor: 'ALL',
    pattern_type: 'must_contain',
    pattern: '',
    remediation_cli: '',
  });

  const loadData = async () => {
    try {
      setScanning(true);
      const [rep, rList] = await Promise.all([
        api.scanCompliance(),
        api.listComplianceRules(),
      ]);
      setReport(rep);
      setRules(rList);
      if (rep.devices.length > 0 && expandedDeviceId === null) {
        // Expand the first non-compliant device by default
        const nonComp = rep.devices.find((d) => !d.passed);
        setExpandedDeviceId(nonComp ? nonComp.device_id : rep.devices[0].device_id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to scan compliance';
      if (onNotify) onNotify(msg, 'warning');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    if (onNotify) onNotify('Remediation CLI copied to clipboard!', 'success');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.rule_id || !newRule.name || !newRule.pattern) {
      if (onNotify) onNotify('Please fill in required rule fields', 'warning');
      return;
    }

    try {
      await api.createComplianceRule(newRule);
      if (onNotify) onNotify(`Created rule ${newRule.rule_id}`, 'success');
      setShowAddRule(false);
      setNewRule({
        rule_id: '',
        name: '',
        description: '',
        severity: 'HIGH',
        vendor: 'ALL',
        pattern_type: 'must_contain',
        pattern: '',
        remediation_cli: '',
      });
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Rule creation failed';
      if (onNotify) onNotify(msg, 'warning');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm(`Are you sure you want to delete compliance rule ${ruleId}?`)) return;
    try {
      await api.deleteComplianceRule(ruleId);
      if (onNotify) onNotify(`Deleted rule ${ruleId}`, 'info');
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      if (onNotify) onNotify(msg, 'warning');
    }
  };

  // Severity count aggregates
  const criticalViolations = report
    ? report.devices.reduce((acc, d) => acc + d.critical_violations, 0)
    : 0;
  const highViolations = report
    ? report.devices.reduce((acc, d) => acc + d.high_violations, 0)
    : 0;
  const mediumViolations = report
    ? report.devices.reduce((acc, d) => acc + d.medium_violations, 0)
    : 0;

  const filteredDevices = (report?.devices || []).filter((d) => {
    if (filterSeverity === 'CRITICAL') return d.critical_violations > 0;
    if (filterSeverity === 'HIGH') return d.high_violations > 0;
    if (filterSeverity === 'FAIL') return !d.passed;
    if (filterSeverity === 'PASS') return d.passed;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 font-mono">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Configuration Compliance & Security Baseline
            </h2>
            <Badge variant="outline" className="text-[10px]">
              CIS Hardening
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Audit fleet running configurations against CIS benchmarks, NIST guidelines, and small-team operational rulesets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddRule(true)}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Policy Rule</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={loadData}
            disabled={scanning}
            className="gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            <span>{scanning ? 'Auditing Fleet...' : 'Scan Fleet Now'}</span>
          </Button>
        </div>
      </div>

      {/* Hero Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Compliance Score Gauge */}
        <Card className="border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-muted-foreground font-mono uppercase">Fleet Compliance Score</p>
              <div className="text-2xl font-black font-mono mt-1 text-foreground">
                {report?.fleet_compliance_score ?? 0}%
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Target: &gt;90% CIS Baseline
              </p>
            </div>
            <div
              className={`w-12 h-12 rounded-full border-4 flex items-center justify-center font-bold font-mono text-sm ${
                (report?.fleet_compliance_score ?? 0) >= 90
                  ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                  : (report?.fleet_compliance_score ?? 0) >= 70
                  ? 'border-amber-500 text-amber-300 bg-amber-500/10'
                  : 'border-destructive text-destructive bg-destructive/10'
              }`}
            >
              {report?.fleet_compliance_score ?? 0}%
            </div>
          </CardContent>
        </Card>

        {/* Compliant Devices */}
        <Card className="border-border/80">
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground font-mono uppercase">Device Pass Rate</p>
            <div className="text-2xl font-black font-mono mt-1 text-foreground">
              {report?.compliant_devices ?? 0}
              <span className="text-sm font-normal text-muted-foreground">
                /{report?.total_devices_scanned ?? 0}
              </span>
            </div>
            <p className="text-[10px] text-emerald-500 mt-0.5">
              {report?.non_compliant_devices ?? 0} devices require remediation
            </p>
          </CardContent>
        </Card>

        {/* Active Rules */}
        <Card className="border-border/80">
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground font-mono uppercase">Enforced Rules</p>
            <div className="text-2xl font-black font-mono mt-1 text-foreground">
              {rules.length}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Multi-vendor CIS & NIST policies
            </p>
          </CardContent>
        </Card>

        {/* Violations Breakdown */}
        <Card className="border-border/80">
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground font-mono uppercase">Open Violations</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="destructive" className="text-[10px]">
                {criticalViolations} Crit
              </Badge>
              <Badge variant="warning" className="text-[10px]">
                {highViolations} High
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {mediumViolations} Med
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Auto-remediation CLI ready
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('devices')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              activeSubTab === 'devices'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground bg-secondary/50'
            }`}
          >
            Device Audit Results ({report?.total_devices_scanned ?? 0})
          </button>
          <button
            onClick={() => setActiveSubTab('rules')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              activeSubTab === 'rules'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground bg-secondary/50'
            }`}
          >
            Policy Rules Catalog ({rules.length})
          </button>
        </div>

        {activeSubTab === 'devices' && (
          <div className="flex items-center gap-2 text-xs">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground font-mono text-[11px]">Filter:</span>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="bg-secondary text-foreground text-[11px] rounded px-2 py-1 border border-border cursor-pointer font-mono"
            >
              <option value="ALL">All Devices</option>
              <option value="FAIL">Non-Compliant Only</option>
              <option value="CRITICAL">Has Critical Violations</option>
              <option value="HIGH">Has High Violations</option>
              <option value="PASS">100% Compliant Only</option>
            </select>
          </div>
        )}
      </div>

      {/* View 1: Device Audit Results */}
      {activeSubTab === 'devices' && (
        <div className="space-y-3">
          {filteredDevices.map((dev) => {
            const isExpanded = expandedDeviceId === dev.device_id;
            return (
              <Card key={dev.device_id} className="overflow-hidden border-border/70">
                <div
                  onClick={() => setExpandedDeviceId(isExpanded ? null : dev.device_id)}
                  className="p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer bg-secondary/20 hover:bg-secondary/40 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Server className="w-4 h-4 text-primary" />
                    <span className="font-bold text-sm text-foreground">{dev.hostname}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {dev.vendor}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {dev.site}
                    </Badge>
                    <span className="text-xs text-muted-foreground hidden md:inline">
                      {dev.model}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Score pill */}
                    <div className="flex items-center gap-1.5">
                      {dev.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-destructive" />
                      )}
                      <span
                        className={`font-mono font-bold text-xs ${
                          dev.score >= 90
                            ? 'text-emerald-400'
                            : dev.score >= 70
                            ? 'text-amber-300'
                            : 'text-destructive'
                        }`}
                      >
                        {dev.score}%
                      </span>
                    </div>

                    {dev.critical_violations > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {dev.critical_violations} Crit
                      </Badge>
                    )}
                    {dev.high_violations > 0 && (
                      <Badge variant="warning" className="text-[10px]">
                        {dev.high_violations} High
                      </Badge>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDiff(dev.device_id);
                      }}
                    >
                      <span>Diff</span>
                    </Button>

                    <div className="text-muted-foreground">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Rule Violations & Remediation */}
                {isExpanded && (
                  <CardContent className="p-4 border-t border-border space-y-3 bg-background">
                    <div className="divide-y divide-border/60">
                      {dev.evaluations.map((ev) => (
                        <div key={ev.rule_id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {ev.passed ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-destructive shrink-0" />
                              )}
                              <span className="font-mono font-bold text-xs text-foreground">
                                {ev.rule_id}: {ev.name}
                              </span>
                              <Badge
                                variant={
                                  ev.severity === 'CRITICAL'
                                    ? 'destructive'
                                    : ev.severity === 'HIGH'
                                    ? 'warning'
                                    : 'secondary'
                                }
                                className="text-[9px] px-1.5 py-0"
                              >
                                {ev.severity}
                              </Badge>
                            </div>

                            <Badge
                              variant={ev.passed ? 'success' : 'destructive'}
                              className="text-[10px]"
                            >
                              {ev.status}
                            </Badge>
                          </div>

                          <p className="text-xs text-muted-foreground">{ev.message}</p>

                          {/* Violating Lines */}
                          {ev.violating_lines.length > 0 && (
                            <div className="bg-destructive/10 border border-destructive/20 rounded p-2 text-xs font-mono space-y-1">
                              <span className="text-[10px] text-destructive font-semibold block">
                                Violating Configuration:
                              </span>
                              {ev.violating_lines.map((vl, vIdx) => (
                                <div key={vIdx} className="text-destructive/90 text-[11px]">
                                  {vl.line_number && <span className="opacity-60">Line {vl.line_number}: </span>}
                                  <code>{vl.text}</code>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Remediation CLI */}
                          {!ev.passed && ev.remediation_cli && (
                            <div className="bg-secondary/40 border border-border rounded p-2.5 space-y-1.5 font-mono text-[11px]">
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1 font-semibold text-primary">
                                  <Terminal className="w-3.5 h-3.5" />
                                  Automated Rollback / Remediation CLI:
                                </span>
                                <button
                                  onClick={() =>
                                    copyToClipboard(ev.remediation_cli, `rem-${dev.device_id}-${ev.rule_id}`)
                                  }
                                  className="hover:text-foreground cursor-pointer flex items-center gap-1 font-mono text-[10px]"
                                >
                                  {copiedKey === `rem-${dev.device_id}-${ev.rule_id}` ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                  Copy Script
                                </button>
                              </div>
                              <pre className="text-emerald-400 overflow-x-auto whitespace-pre bg-black/50 p-2 rounded text-[11px]">
                                {ev.remediation_cli}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* View 2: Policy Rules Catalog */}
      {activeSubTab === 'rules' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rules.map((rule) => (
              <Card key={rule.rule_id} className="border-border/80">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-primary">{rule.rule_id}</span>
                        <Badge
                          variant={
                            rule.severity === 'CRITICAL'
                              ? 'destructive'
                              : rule.severity === 'HIGH'
                              ? 'warning'
                              : 'secondary'
                          }
                          className="text-[9px]"
                        >
                          {rule.severity}
                        </Badge>
                        <Badge variant="outline" className="text-[9px]">
                          {rule.vendor}
                        </Badge>
                      </div>
                      <CardTitle className="text-sm font-bold text-foreground">{rule.name}</CardTitle>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteRule(rule.rule_id)}
                      className="text-muted-foreground hover:text-destructive h-7 w-7"
                      title="Delete rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="p-4 pt-0 space-y-2 text-xs">
                  <p className="text-muted-foreground">{rule.description}</p>
                  <div className="bg-secondary/40 p-2 rounded text-[11px] font-mono space-y-1">
                    <div>
                      <span className="text-muted-foreground">Type: </span>
                      <code className="text-foreground">{rule.pattern_type}</code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Pattern: </span>
                      <code className="text-amber-300">{rule.pattern}</code>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Modal: New Policy Rule */}
      {showAddRule && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <CardHeader className="p-4 border-b border-border">
              <CardTitle className="text-base flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                Add Custom Compliance Rule
              </CardTitle>
              <CardDescription className="text-xs">
                Define an automated configuration baseline rule for multi-vendor auditing.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleCreateRule}>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-mono text-[11px] block mb-1">Rule ID *</label>
                    <Input
                      placeholder="e.g. SEC-NET-09"
                      value={newRule.rule_id}
                      onChange={(e) => setNewRule({ ...newRule, rule_id: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="font-mono text-[11px] block mb-1">Severity</label>
                    <select
                      value={newRule.severity}
                      onChange={(e) => setNewRule({ ...newRule, severity: e.target.value })}
                      className="w-full bg-secondary border border-border rounded p-2 text-xs text-foreground"
                    >
                      <option value="CRITICAL">CRITICAL</option>
                      <option value="HIGH">HIGH</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="LOW">LOW</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-mono text-[11px] block mb-1">Rule Name *</label>
                  <Input
                    placeholder="e.g. Enforce DNS Server Hardening"
                    value={newRule.name}
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="font-mono text-[11px] block mb-1">Description</label>
                  <Input
                    placeholder="Why this rule is required for SME network security"
                    value={newRule.description}
                    onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-mono text-[11px] block mb-1">Target Vendor</label>
                    <select
                      value={newRule.vendor}
                      onChange={(e) => setNewRule({ ...newRule, vendor: e.target.value })}
                      className="w-full bg-secondary border border-border rounded p-2 text-xs text-foreground"
                    >
                      <option value="ALL">ALL Vendors</option>
                      <option value="Cisco">Cisco IOS-XE / ASA</option>
                      <option value="Juniper">Juniper Junos</option>
                      <option value="Ubiquiti">Ubiquiti EdgeOS</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-mono text-[11px] block mb-1">Pattern Type</label>
                    <select
                      value={newRule.pattern_type}
                      onChange={(e) => setNewRule({ ...newRule, pattern_type: e.target.value })}
                      className="w-full bg-secondary border border-border rounded p-2 text-xs text-foreground"
                    >
                      <option value="must_contain">Must Contain Substring</option>
                      <option value="must_not_contain">Must NOT Contain Substring</option>
                      <option value="regex_match">Regex Must Match</option>
                      <option value="regex_no_match">Regex Must NOT Match</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-mono text-[11px] block mb-1">Configuration Pattern / Regex *</label>
                  <Input
                    placeholder="e.g. service password-encryption or (?i)ip name-server"
                    value={newRule.pattern}
                    onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="font-mono text-[11px] block mb-1">Remediation CLI Snippet</label>
                  <textarea
                    placeholder="configure terminal&#10;service password-encryption&#10;end&#10;write memory"
                    value={newRule.remediation_cli}
                    onChange={(e) => setNewRule({ ...newRule, remediation_cli: e.target.value })}
                    rows={3}
                    className="w-full bg-secondary border border-border rounded p-2 text-xs font-mono text-foreground"
                  />
                </div>
              </CardContent>

              <div className="p-4 border-t border-border flex items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowAddRule(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Save Rule
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Code2,
  Copy,
  Check,
  FileDown,
  GitCompare,
  Server,
  Terminal,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { api } from '../api';
import type { DeviceSearchResult, FleetSearchResponse } from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';

interface FleetSearchViewProps {
  onOpenDiff: (deviceId: number) => void;
  onNotify?: (message: string, type?: 'success' | 'info' | 'warning') => void;
}

const PRESET_QUERIES = [
  { label: 'Telnet / SSH Lines', query: 'transport input', isRegex: false },
  { label: 'SNMP Communities', query: 'snmp-server community', isRegex: false },
  { label: 'Firewall & ACLs', query: 'access-list|permit tcp', isRegex: true },
  { label: 'VLAN Trunks', query: 'switchport trunk|vlan', isRegex: true },
  { label: 'Dynamic Routing', query: 'router (ospf|bgp)|protocols ospf', isRegex: true },
  { label: 'Management IP Subnet', query: '10.10.', isRegex: false },
];

export function FleetSearchView({ onOpenDiff, onNotify }: FleetSearchViewProps) {
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<'latest' | 'lkg'>('latest');
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [vendorFilter, setVendorFilter] = useState('ALL');

  const [loading, setLoading] = useState(false);
  const [searchResponse, setSearchResponse] = useState<FleetSearchResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent, overrideQuery?: string) => {
    if (e) e.preventDefault();
    const searchQuery = overrideQuery !== undefined ? overrideQuery : query;
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      const resp = await api.searchFleetConfigs({
        query: searchQuery.trim(),
        is_regex: isRegex,
        case_sensitive: caseSensitive,
        site: siteFilter,
        vendor: vendorFilter,
        scope,
      });
      setSearchResponse(resp);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Search failed';
      if (onNotify) onNotify(`Search error: ${msg}`, 'warning');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPreset = (preset: (typeof PRESET_QUERIES)[0]) => {
    setQuery(preset.query);
    setIsRegex(preset.isRegex);
    handleSearch(undefined, preset.query);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    if (onNotify) onNotify('Copied to clipboard!', 'success');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const copyDeviceMatches = (device: DeviceSearchResult) => {
    const text = device.matches.map((m) => `L${m.line_number}: ${m.matched_line}`).join('\n');
    copyToClipboard(text, `dev-${device.device_id}`);
  };

  return (
    <div className="space-y-6">
      {/* Search Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 font-mono">
              <Search className="w-5 h-5 text-primary" />
              Fleet Configuration Search
            </h2>
            <Badge variant="outline" className="text-[10px]">
              Config Grep
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Perform sub-second regex or keyword queries across all device running and baseline configurations.
          </p>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1 mr-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Presets:
          </span>
          {PRESET_QUERIES.map((p) => (
            <button
              key={p.label}
              onClick={() => handleApplyPreset(p)}
              className="px-2 py-1 text-[11px] rounded bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border cursor-pointer transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Search Filter Box */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Enter string or regular expression (e.g., 'transport input', 'permit tcp', 'vlan 99')..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 font-mono text-xs"
              />
            </div>
            <Button type="submit" disabled={loading || !query.trim()} className="gap-2 shrink-0">
              {loading ? (
                <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>Grep Fleet</span>
            </Button>
          </form>

          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-2 border-t border-border">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
                <input
                  type="checkbox"
                  checked={isRegex}
                  onChange={(e) => setIsRegex(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="font-mono text-[11px]">Regex Mode</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="font-mono text-[11px]">Match Case</span>
              </label>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground font-mono">Scope:</span>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'latest' | 'lkg')}
                  className="bg-secondary text-foreground text-[11px] rounded px-2 py-0.5 border border-border cursor-pointer"
                >
                  <option value="latest">Latest Running</option>
                  <option value="lkg">Last-Known-Good Baseline</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground font-mono">Site:</span>
                <select
                  value={siteFilter}
                  onChange={(e) => setSiteFilter(e.target.value)}
                  className="bg-secondary text-foreground text-[11px] rounded px-2 py-0.5 border border-border cursor-pointer"
                >
                  <option value="ALL">All Sites</option>
                  <option value="HQ-Campus (Austin)">Austin HQ</option>
                  <option value="Branch-DC (Frankfurt)">Frankfurt DC</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground font-mono">Vendor:</span>
                <select
                  value={vendorFilter}
                  onChange={(e) => setVendorFilter(e.target.value)}
                  className="bg-secondary text-foreground text-[11px] rounded px-2 py-0.5 border border-border cursor-pointer"
                >
                  <option value="ALL">All Vendors</option>
                  <option value="Cisco">Cisco</option>
                  <option value="Juniper">Juniper</option>
                  <option value="Ubiquiti">Ubiquiti</option>
                </select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Header */}
      {searchResponse && (
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <div>
            Showing <strong className="text-foreground">{searchResponse.total_matched_lines}</strong> matching line
            {searchResponse.total_matched_lines === 1 ? '' : 's'} across{' '}
            <strong className="text-foreground">{searchResponse.devices_with_matches}</strong> of{' '}
            {searchResponse.total_devices_searched} searched devices for{' '}
            <code className="bg-secondary px-1.5 py-0.5 rounded text-primary font-mono font-bold">
              &quot;{searchResponse.query}&quot;
            </code>
          </div>
        </div>
      )}

      {/* Results List */}
      {searchResponse && searchResponse.results.length === 0 && (
        <Card className="text-center py-12">
          <CardContent className="space-y-2">
            <Code2 className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-semibold text-foreground">No matches found in configuration snapshots</p>
            <p className="text-xs text-muted-foreground">
              Try adjusting your query, toggling case sensitivity, or choosing &quot;All Sites / All Vendors&quot;.
            </p>
          </CardContent>
        </Card>
      )}

      {searchResponse && searchResponse.results.length > 0 && (
        <div className="space-y-4">
          {searchResponse.results.map((res) => (
            <Card key={res.device_id} className="overflow-hidden border-border/80">
              <CardHeader className="p-3 bg-secondary/30 flex flex-row items-center justify-between border-b border-border gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Server className="w-4 h-4 text-primary" />
                  <span className="font-bold text-sm text-foreground">{res.hostname}</span>
                  <span className="text-xs text-muted-foreground">({res.ip_address})</span>
                  <Badge variant="outline" className="text-[10px]">
                    {res.vendor}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {res.site}
                  </Badge>
                  <Badge variant="info" className="text-[10px]">
                    v{res.snapshot_version} ({res.is_lkg ? 'LKG' : 'Running'})
                  </Badge>
                  <Badge variant="warning" className="text-[10px]">
                    {res.match_count} match{res.match_count === 1 ? '' : 'es'}
                  </Badge>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => copyDeviceMatches(res)}
                    title="Copy matched lines"
                  >
                    {copiedKey === `dev-${res.device_id}` ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">Copy Matches</span>
                  </Button>

                  <a
                    href={api.getDeviceExportUrl(res.device_id, res.is_lkg ? 'lkg' : 'latest')}
                    download
                    className="inline-flex items-center gap-1 h-7 px-2 text-xs font-semibold rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                    title="Download config text"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Export</span>
                  </a>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => onOpenDiff(res.device_id)}
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    <span>View Diff</span>
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="divide-y divide-border/60">
                  {res.matches.map((m, mIdx) => (
                    <div key={mIdx} className="p-3 bg-background/50 font-mono text-[11px]">
                      <div className="text-[10px] text-muted-foreground mb-1.5 flex items-center justify-between">
                        <span>Match at line {m.line_number}</span>
                        <button
                          onClick={() => copyToClipboard(m.matched_line, `line-${res.device_id}-${mIdx}`)}
                          className="hover:text-foreground cursor-pointer flex items-center gap-1"
                        >
                          {copiedKey === `line-${res.device_id}-${mIdx}` ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          Copy line
                        </button>
                      </div>

                      {/* Surrounding Context Lines */}
                      <div className="rounded bg-black/40 border border-border/40 p-2.5 overflow-x-auto">
                        {m.context.map((ctx) => (
                          <div
                            key={ctx.line_number}
                            className={`flex items-start gap-3 py-0.5 px-1 rounded ${
                              ctx.is_target
                                ? 'bg-amber-500/15 text-amber-300 font-semibold border-l-2 border-amber-400'
                                : 'text-muted-foreground'
                            }`}
                          >
                            <span className="w-8 shrink-0 select-none text-right text-muted-foreground/60 text-[10px]">
                              {ctx.line_number}
                            </span>
                            <span className="whitespace-pre flex-1">{ctx.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ComplianceRuleDefinition {
  rule_id: string;
  name: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  vendor: string;
  pattern_type: 'must_contain' | 'must_not_contain' | 'regex_match' | 'regex_no_match';
  pattern: string;
  remediation_cli: string;
  enabled?: number | boolean;
}

export const BUILTIN_COMPLIANCE_RULES: ComplianceRuleDefinition[] = [
  {
    rule_id: 'CIS-NET-01',
    name: 'Disable Unencrypted Telnet Access',
    description: 'Ensure cleartext Telnet management is disabled and only SSHv2 is permitted.',
    severity: 'CRITICAL',
    vendor: 'ALL',
    pattern_type: 'must_not_contain',
    pattern: 'transport input telnet',
    remediation_cli: 'configure terminal\nline vty 0 15\n transport input ssh\nend\nwrite memory',
    enabled: 1,
  },
  {
    rule_id: 'CIS-NET-02',
    name: 'Enforce Strong SSH Version (SSHv2 / Key Auth)',
    description: 'Enforce modern SSH version 2 protocol and forbid insecure legacy SSHv1.',
    severity: 'HIGH',
    vendor: 'Cisco',
    pattern_type: 'must_contain',
    pattern: 'ip ssh version 2',
    remediation_cli: 'configure terminal\nip ssh version 2\nend\nwrite memory',
    enabled: 1,
  },
  {
    rule_id: 'CIS-NET-03',
    name: 'Prohibit Default SNMP Community Strings',
    description: 'Public or private read-write community strings are strictly prohibited.',
    severity: 'CRITICAL',
    vendor: 'ALL',
    pattern_type: 'regex_no_match',
    pattern: '(?i)snmp-server\\s+community\\s+(public|private)\\b',
    remediation_cli: 'configure terminal\nno snmp-server community public\nno snmp-server community private\nend\nwrite memory',
    enabled: 1,
  },
  {
    rule_id: 'CIS-NET-04',
    name: 'Enforce Local Password Encryption',
    description: 'Ensure Cisco type-7 password encryption is active for all local credentials.',
    severity: 'HIGH',
    vendor: 'Cisco',
    pattern_type: 'must_contain',
    pattern: 'service password-encryption',
    remediation_cli: 'configure terminal\nservice password-encryption\nend\nwrite memory',
    enabled: 1,
  },
  {
    rule_id: 'CIS-NET-05',
    name: 'Centralized Syslog Logging Configured',
    description: 'Device must stream audit trails and security events to a centralized SIEM / Syslog host.',
    severity: 'MEDIUM',
    vendor: 'ALL',
    pattern_type: 'regex_match',
    pattern: '(?i)(logging\\s+host|system\\s+syslog|set\\s+system\\s+syslog)',
    remediation_cli: 'configure terminal\nlogging host 10.10.99.50\nlogging trap informational\nend\nwrite memory',
    enabled: 1,
  },
  {
    rule_id: 'CIS-NET-06',
    name: 'NTP Network Time Synchronization',
    description: 'Synchronize clocks across the fleet to ensure timestamp consistency in incident forensics.',
    severity: 'MEDIUM',
    vendor: 'ALL',
    pattern_type: 'regex_match',
    pattern: '(?i)(ntp\\s+server|system\\s+ntp|set\\s+system\\s+ntp)',
    remediation_cli: 'configure terminal\nntp server 10.10.99.1\nend\nwrite memory',
    enabled: 1,
  },
  {
    rule_id: 'CIS-NET-07',
    name: 'AAA / Centralized Identity Active',
    description: 'Ensure AAA subsystem is enabled for RADIUS/TACACS+ centralized identity management.',
    severity: 'HIGH',
    vendor: 'Cisco',
    pattern_type: 'must_contain',
    pattern: 'aaa new-model',
    remediation_cli: 'configure terminal\naaa new-model\nend\nwrite memory',
    enabled: 1,
  },
  {
    rule_id: 'CIS-NET-08',
    name: 'Audit Privilege 15 Superuser Accounts',
    description: 'Disallow unauthorized backdoor or generic administrative accounts with privilege 15.',
    severity: 'CRITICAL',
    vendor: 'Cisco',
    pattern_type: 'regex_no_match',
    pattern: '(?i)username\\s+(backdoor|guest|temp|support|test)\\s+privilege\\s+15',
    remediation_cli: 'configure terminal\nno username backdoor\nno username guest\nno username temp\nend\nwrite memory',
    enabled: 1,
  },
];

export interface ViolatingLine {
  line_number: number | null;
  text: string;
}

export interface RuleEvaluationResult {
  rule_id: string;
  name: string;
  severity: string;
  passed: boolean;
  status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  violating_lines: ViolatingLine[];
  remediation_cli: string;
  message: string;
}

export function evaluateRuleAgainstConfig(
  rule: ComplianceRuleDefinition,
  configText: string,
  deviceVendor: string
): RuleEvaluationResult {
  const ruleVendor = rule.vendor || 'ALL';
  if (ruleVendor !== 'ALL' && !deviceVendor.toLowerCase().includes(ruleVendor.toLowerCase())) {
    return {
      rule_id: rule.rule_id,
      name: rule.name,
      severity: rule.severity,
      passed: true,
      status: 'NOT_APPLICABLE',
      violating_lines: [],
      remediation_cli: '',
      message: `Rule applicable only to ${ruleVendor} (Device is ${deviceVendor}).`,
    };
  }

  const lines = configText.split(/\r?\n/);
  const ptype = rule.pattern_type || 'must_contain';
  let pattern = rule.pattern || '';
  let passed = false;
  const violatingLines: ViolatingLine[] = [];

  // Strip Python inline (?i) flag if present and convert to case-insensitive flag in JS RegExp
  let flags = '';
  if (pattern.startsWith('(?i)')) {
    pattern = pattern.slice(4);
    flags = 'i';
  }

  if (ptype === 'must_contain') {
    let found = false;
    for (let idx = 0; idx < lines.length; idx++) {
      if (lines[idx].toLowerCase().includes(pattern.toLowerCase())) {
        found = true;
        break;
      }
    }
    passed = found;
    if (!passed) {
      violatingLines.push({
        line_number: null,
        text: `Missing required configuration: '${pattern}'`,
      });
    }
  } else if (ptype === 'must_not_contain') {
    const violations: ViolatingLine[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
      if (lines[idx].toLowerCase().includes(pattern.toLowerCase())) {
        violations.push({ line_number: idx + 1, text: lines[idx].trim() });
      }
    }
    passed = violations.length === 0;
    violatingLines.push(...violations);
  } else if (ptype === 'regex_match') {
    try {
      const regex = new RegExp(pattern, flags || 'i');
      passed = lines.some((l) => regex.test(l));
    } catch {
      passed = false;
    }
    if (!passed) {
      violatingLines.push({
        line_number: null,
        text: `Missing pattern match: ${pattern}`,
      });
    }
  } else if (ptype === 'regex_no_match') {
    const violations: ViolatingLine[] = [];
    try {
      const regex = new RegExp(pattern, flags || 'i');
      for (let idx = 0; idx < lines.length; idx++) {
        if (regex.test(lines[idx])) {
          violations.push({ line_number: idx + 1, text: lines[idx].trim() });
        }
      }
    } catch {
      // ignore
    }
    passed = violations.length === 0;
    violatingLines.push(...violations);
  }

  let remediation = rule.remediation_cli || '';
  if (deviceVendor.toLowerCase().includes('juniper') && remediation.includes('configure terminal')) {
    remediation = `# Juniper Junos Remediation for ${rule.rule_id}\nconfigure\n# Review policy and apply appropriate set commands\ncommit comment "Compliance Fix ${rule.rule_id}"`;
  }

  return {
    rule_id: rule.rule_id,
    name: rule.name,
    severity: rule.severity,
    passed,
    status: passed ? 'PASS' : 'FAIL',
    violating_lines: violatingLines,
    remediation_cli: !passed ? remediation : '',
    message: passed ? 'Compliant with policy' : `Violated policy: ${rule.description}`,
  };
}

export interface DeviceComplianceSummary {
  device_id: number;
  hostname: string;
  vendor: string;
  model: string;
  site: string;
  score: number;
  passed: boolean;
  total_rules_evaluated: number;
  passed_rules: number;
  failed_rules: number;
  critical_violations: number;
  high_violations: number;
  medium_violations: number;
  evaluations: RuleEvaluationResult[];
}

export function scanDeviceCompliance(
  device: {
    id: number;
    hostname: string;
    vendor: string;
    model: string;
    site: string;
  },
  rules: ComplianceRuleDefinition[],
  configText: string
): DeviceComplianceSummary {
  const evaluations: RuleEvaluationResult[] = [];
  for (const rule of rules) {
    const isEnabled = rule.enabled === undefined || rule.enabled === 1 || rule.enabled === true;
    if (!isEnabled) continue;
    evaluations.push(evaluateRuleAgainstConfig(rule, configText, device.vendor || 'Cisco'));
  }

  const applicable = evaluations.filter((e) => e.status !== 'NOT_APPLICABLE');
  const total = applicable.length;
  const passedCount = applicable.filter((e) => e.passed).length;
  const failedCount = total - passedCount;
  const score = total > 0 ? Math.round((passedCount / total) * 100) : 100;

  const criticalFails = applicable.filter((e) => !e.passed && e.severity === 'CRITICAL').length;
  const highFails = applicable.filter((e) => !e.passed && e.severity === 'HIGH').length;
  const mediumFails = applicable.filter((e) => !e.passed && e.severity === 'MEDIUM').length;

  return {
    device_id: device.id,
    hostname: device.hostname,
    vendor: device.vendor,
    model: device.model,
    site: device.site,
    score,
    passed: failedCount === 0,
    total_rules_evaluated: total,
    passed_rules: passedCount,
    failed_rules: failedCount,
    critical_violations: criticalFails,
    high_violations: highFails,
    medium_violations: mediumFails,
    evaluations,
  };
}

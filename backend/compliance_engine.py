"""
Compliance & Security Policy Baseline Engine for NetGuardia.
Audits multi-vendor network device configurations against hardening frameworks
(CIS Network Device Benchmark, NIST SP 800-128, SME Operational Baselines).
"""

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


BUILTIN_COMPLIANCE_RULES = [
    {
        "rule_id": "CIS-NET-01",
        "name": "Disable Unencrypted Telnet Access",
        "description": "Ensure cleartext Telnet management is disabled and only SSHv2 is permitted.",
        "severity": "CRITICAL",
        "vendor": "ALL",
        "pattern_type": "must_not_contain",
        "pattern": "transport input telnet",
        "remediation_cli": "configure terminal\nline vty 0 15\n transport input ssh\nend\nwrite memory",
        "enabled": 1,
    },
    {
        "rule_id": "CIS-NET-02",
        "name": "Enforce Strong SSH Version (SSHv2 / Key Auth)",
        "description": "Enforce modern SSH version 2 protocol and forbid insecure legacy SSHv1.",
        "severity": "HIGH",
        "vendor": "Cisco",
        "pattern_type": "must_contain",
        "pattern": "ip ssh version 2",
        "remediation_cli": "configure terminal\nip ssh version 2\nend\nwrite memory",
        "enabled": 1,
    },
    {
        "rule_id": "CIS-NET-03",
        "name": "Prohibit Default SNMP Community Strings",
        "description": "Public or private read-write community strings are strictly prohibited.",
        "severity": "CRITICAL",
        "vendor": "ALL",
        "pattern_type": "regex_no_match",
        "pattern": r"(?i)snmp-server\s+community\s+(public|private)\b",
        "remediation_cli": "configure terminal\nno snmp-server community public\nno snmp-server community private\nend\nwrite memory",
        "enabled": 1,
    },
    {
        "rule_id": "CIS-NET-04",
        "name": "Enforce Local Password Encryption",
        "description": "Ensure Cisco type-7 password encryption is active for all local credentials.",
        "severity": "HIGH",
        "vendor": "Cisco",
        "pattern_type": "must_contain",
        "pattern": "service password-encryption",
        "remediation_cli": "configure terminal\nservice password-encryption\nend\nwrite memory",
        "enabled": 1,
    },
    {
        "rule_id": "CIS-NET-05",
        "name": "Centralized Syslog Logging Configured",
        "description": "Device must stream audit trails and security events to a centralized SIEM / Syslog host.",
        "severity": "MEDIUM",
        "vendor": "ALL",
        "pattern_type": "regex_match",
        "pattern": r"(?i)(logging\s+host|system\s+syslog|set\s+system\s+syslog)",
        "remediation_cli": "configure terminal\nlogging host 10.10.99.50\nlogging trap informational\nend\nwrite memory",
        "enabled": 1,
    },
    {
        "rule_id": "CIS-NET-06",
        "name": "NTP Network Time Synchronization",
        "description": "Synchronize clocks across the fleet to ensure timestamp consistency in incident forensics.",
        "severity": "MEDIUM",
        "vendor": "ALL",
        "pattern_type": "regex_match",
        "pattern": r"(?i)(ntp\s+server|system\s+ntp|set\s+system\s+ntp)",
        "remediation_cli": "configure terminal\nntp server 10.10.99.1\nend\nwrite memory",
        "enabled": 1,
    },
    {
        "rule_id": "CIS-NET-07",
        "name": "AAA / Centralized Identity Active",
        "description": "Ensure AAA subsystem is enabled for RADIUS/TACACS+ centralized identity management.",
        "severity": "HIGH",
        "vendor": "Cisco",
        "pattern_type": "must_contain",
        "pattern": "aaa new-model",
        "remediation_cli": "configure terminal\naaa new-model\nend\nwrite memory",
        "enabled": 1,
    },
    {
        "rule_id": "CIS-NET-08",
        "name": "Audit Privilege 15 Superuser Accounts",
        "description": "Disallow unauthorized backdoor or generic administrative accounts with privilege 15.",
        "severity": "CRITICAL",
        "vendor": "Cisco",
        "pattern_type": "regex_no_match",
        "pattern": r"(?i)username\s+(backdoor|guest|temp|support|test)\s+privilege\s+15",
        "remediation_cli": "configure terminal\nno username backdoor\nno username guest\nno username temp\nend\nwrite memory",
        "enabled": 1,
    },
]


def evaluate_rule_against_config(
    rule: Dict[str, Any],
    config_text: str,
    device_vendor: str,
) -> Dict[str, Any]:
    """
    Evaluate a single compliance rule against a device configuration.
    Returns pass/fail status, violating lines, line numbers, and tailored remediation CLI.
    """
    rule_vendor = rule.get("vendor", "ALL")
    if rule_vendor != "ALL" and rule_vendor.lower() not in device_vendor.lower():
        return {
            "rule_id": rule["rule_id"],
            "name": rule["name"],
            "severity": rule["severity"],
            "passed": True,
            "status": "NOT_APPLICABLE",
            "violating_lines": [],
            "remediation_cli": "",
            "message": f"Rule applicable only to {rule_vendor} (Device is {device_vendor}).",
        }

    lines = config_text.splitlines()
    ptype = rule.get("pattern_type", "must_contain")
    pattern = rule.get("pattern", "")
    passed = False
    violating_lines = []

    if ptype == "must_contain":
        found = False
        for idx, line in enumerate(lines, start=1):
            if pattern.lower() in line.lower():
                found = True
                break
        passed = found
        if not passed:
            violating_lines.append(
                {"line_number": None, "text": f"Missing required configuration: '{pattern}'"}
            )

    elif ptype == "must_not_contain":
        violations = []
        for idx, line in enumerate(lines, start=1):
            if pattern.lower() in line.lower():
                violations.append({"line_number": idx, "text": line.strip()})
        passed = len(violations) == 0
        violating_lines = violations

    elif ptype == "regex_match":
        regex = re.compile(pattern, re.IGNORECASE)
        found = any(regex.search(line) for line in lines)
        passed = found
        if not passed:
            violating_lines.append(
                {"line_number": None, "text": f"Missing pattern match: {pattern}"}
            )

    elif ptype == "regex_no_match":
        regex = re.compile(pattern, re.IGNORECASE)
        violations = []
        for idx, line in enumerate(lines, start=1):
            if regex.search(line):
                violations.append({"line_number": idx, "text": line.strip()})
        passed = len(violations) == 0
        violating_lines = violations

    remediation = rule.get("remediation_cli", "")
    # Format remediation based on vendor if necessary
    if "juniper" in device_vendor.lower() and "configure terminal" in remediation:
        remediation = f"# Juniper Junos Remediation for {rule['rule_id']}\nconfigure\n# Review policy and apply appropriate set commands\ncommit comment \"Compliance Fix {rule['rule_id']}\""

    return {
        "rule_id": rule["rule_id"],
        "name": rule["name"],
        "severity": rule["severity"],
        "passed": passed,
        "status": "PASS" if passed else "FAIL",
        "violating_lines": violating_lines,
        "remediation_cli": remediation if not passed else "",
        "message": "Compliant with policy" if passed else f"Violated policy: {rule['description']}",
    }


def scan_device_compliance(
    device: Dict[str, Any],
    rules: List[Dict[str, Any]],
    config_text: str,
) -> Dict[str, Any]:
    """Scan all enabled rules against a single device configuration."""
    evaluations = []
    for rule in rules:
        if not rule.get("enabled", 1):
            continue
        eval_res = evaluate_rule_against_config(rule, config_text, device.get("vendor", "Cisco"))
        evaluations.append(eval_res)

    applicable = [e for e in evaluations if e["status"] != "NOT_APPLICABLE"]
    total = len(applicable)
    passed_count = sum(1 for e in applicable if e["passed"])
    failed_count = total - passed_count
    score = round((passed_count / total * 100)) if total > 0 else 100

    critical_fails = sum(1 for e in applicable if not e["passed"] and e["severity"] == "CRITICAL")
    high_fails = sum(1 for e in applicable if not e["passed"] and e["severity"] == "HIGH")
    medium_fails = sum(1 for e in applicable if not e["passed"] and e["severity"] == "MEDIUM")

    return {
        "device_id": device["id"],
        "hostname": device["hostname"],
        "vendor": device["vendor"],
        "model": device["model"],
        "site": device["site"],
        "score": score,
        "passed": failed_count == 0,
        "total_rules_evaluated": total,
        "passed_rules": passed_count,
        "failed_rules": failed_count,
        "critical_violations": critical_fails,
        "high_violations": high_fails,
        "medium_violations": medium_fails,
        "evaluations": evaluations,
    }

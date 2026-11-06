import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { scanDeviceCompliance, ComplianceRuleDefinition } from '@/lib/complianceEngine';
import { logAuditEvent } from '@/lib/audit';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(req: NextRequest) {
  const deviceIdParam = req.nextUrl.searchParams.get('device_id');
  const deviceId = deviceIdParam ? parseInt(deviceIdParam, 10) : null;

  const rawRules = await prisma.complianceRule.findMany({ where: { enabled: 1 } });
  const rules: ComplianceRuleDefinition[] = rawRules.map((r) => ({
    rule_id: r.ruleId,
    name: r.name,
    description: r.description,
    severity: r.severity as any,
    vendor: r.vendor,
    pattern_type: r.patternType as any,
    pattern: r.pattern,
    remediation_cli: r.remediationCli,
    enabled: r.enabled === 1,
  }));

  let devices = [];
  if (deviceId) {
    const targetDev = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!targetDev) return errorResponse('Device not found', 404);
    devices = [targetDev];
  } else {
    devices = await prisma.device.findMany();
  }

  const deviceResults = [];
  for (const dev of devices) {
    const snapId = dev.latestSnapshotId || dev.lkgSnapshotId;
    let cfgText = '';
    if (snapId) {
      const snap = await prisma.configSnapshot.findUnique({ where: { id: snapId } });
      if (snap) {
        cfgText = snap.configText || '';
      }
    }

    const res = scanDeviceCompliance(dev, rules, cfgText);
    deviceResults.push(res);
  }

  const totalDevices = deviceResults.length;
  const compliantDevices = deviceResults.filter((d) => d.passed).length;
  const fleetScore =
    totalDevices > 0
      ? Math.round(deviceResults.reduce((acc, d) => acc + d.score, 0) / totalDevices)
      : 100;

  const nowIso = new Date().toISOString();
  await logAuditEvent({
    action: 'COMPLIANCE_SCAN',
    severity: fleetScore >= 80 ? 'INFO' : 'WARNING',
    target: !deviceId ? `Fleet (${totalDevices} devices)` : devices[0].hostname,
    details: `Compliance scan completed: Fleet Score ${fleetScore}% (${compliantDevices}/${totalDevices} devices compliant)`,
    metadata: { fleet_score: fleetScore, compliant_devices: compliantDevices },
  });

  return jsonResponse({
    scanned_at: nowIso,
    total_rules: rules.length,
    total_devices_scanned: totalDevices,
    compliant_devices: compliantDevices,
    non_compliant_devices: totalDevices - compliantDevices,
    fleet_compliance_score: fleetScore,
    devices: deviceResults,
  });
}

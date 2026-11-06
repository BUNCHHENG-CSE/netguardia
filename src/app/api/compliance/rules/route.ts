import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/audit';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function GET(req: NextRequest) {
  const vendor = req.nextUrl.searchParams.get('vendor');
  const where = vendor && vendor !== 'ALL' ? { vendor } : undefined;

  const rules = await prisma.complianceRule.findMany({
    where,
    orderBy: { id: 'asc' },
  });

  const formatted = rules.map((r) => ({
    id: r.id,
    rule_id: r.ruleId,
    name: r.name,
    description: r.description,
    severity: r.severity,
    vendor: r.vendor,
    pattern_type: r.patternType,
    pattern: r.pattern,
    remediation_cli: r.remediationCli,
    enabled: r.enabled === 1,
    created_at: r.createdAt,
  }));

  return jsonResponse(formatted);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      rule_id,
      name,
      description,
      severity = 'HIGH',
      vendor = 'ALL',
      pattern_type = 'must_contain',
      pattern,
      remediation_cli,
      enabled = true,
    } = body;

    const existing = await prisma.complianceRule.findUnique({
      where: { ruleId: rule_id.trim().toUpperCase() },
    });
    if (existing) {
      return errorResponse(`Rule ID '${rule_id}' already exists.`, 400);
    }

    const nowIso = new Date().toISOString();
    const created = await prisma.complianceRule.create({
      data: {
        ruleId: rule_id.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim(),
        severity,
        vendor,
        patternType: pattern_type,
        pattern,
        remediationCli: remediation_cli,
        enabled: enabled ? 1 : 0,
        createdAt: nowIso,
      },
    });

    await logAuditEvent({
      action: 'COMPLIANCE_RULE_CREATED',
      severity: 'INFO',
      target: created.ruleId,
      details: `Created compliance rule '${created.name}' (${created.severity})`,
    });

    return jsonResponse(
      {
        id: created.id,
        rule_id: created.ruleId,
        name: created.name,
        description: created.description,
        severity: created.severity,
        vendor: created.vendor,
        pattern_type: created.patternType,
        pattern: created.pattern,
        remediation_cli: created.remediationCli,
        enabled: created.enabled === 1,
        created_at: created.createdAt,
      },
      201
    );
  } catch (err: any) {
    return errorResponse(err.message, 400);
  }
}

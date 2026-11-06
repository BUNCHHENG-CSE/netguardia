import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/audit';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  const { ruleId } = await params;
  const decodedRuleId = decodeURIComponent(ruleId);

  try {
    await prisma.complianceRule.delete({ where: { ruleId: decodedRuleId } });
    await logAuditEvent({
      action: 'COMPLIANCE_RULE_DELETED',
      severity: 'INFO',
      target: decodedRuleId,
      details: `Deleted compliance rule ${decodedRuleId}`,
    });
    return jsonResponse({ deleted: decodedRuleId });
  } catch (err: any) {
    return errorResponse(`Rule not found: ${err.message}`, 404);
  }
}

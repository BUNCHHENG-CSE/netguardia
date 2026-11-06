import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse } from '@/lib/apiUtils';


export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10))) : 50;
  const action = searchParams.get('action');
  const severity = searchParams.get('severity');

  const where: any = {};
  if (action && action !== 'ALL') where.action = action;
  if (severity && severity !== 'ALL') where.severity = severity;

  const logs = await prisma.auditLog.findMany({
    where: Object.keys(where).length > 0 ? where : undefined,
    orderBy: { id: 'desc' },
    take: limit,
  });

  const formatted = logs.map((l) => {
    let metadata = {};
    try {
      metadata = JSON.parse(l.metadataJson || '{}');
    } catch {
      metadata = {};
    }
    return {
      id: l.id,
      timestamp: l.timestamp,
      action: l.action,
      severity: l.severity,
      actor: l.actor,
      target: l.target,
      details: l.details,
      metadata,
    };
  });

  return jsonResponse(formatted);
}

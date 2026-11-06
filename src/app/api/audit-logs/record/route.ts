import { NextRequest } from 'next/server';
import { logAuditEvent } from '@/lib/audit';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, severity = 'INFO', target, details, actor = 'NetOps Admin', metadata } = body;

    if (!action || !target || !details) {
      return errorResponse('action, target, and details are required', 400);
    }

    await logAuditEvent({ action, severity, target, details, actor, metadata });
    return jsonResponse({ status: 'recorded' }, 201);
  } catch (err: any) {
    return errorResponse(err.message, 400);
  }
}

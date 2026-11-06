import { prisma } from './prisma';

export interface AuditEventParams {
  action: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  target: string;
  details: string;
  actor?: string;
  metadata?: Record<string, any> | null;
}

export async function logAuditEvent({
  action,
  severity = 'INFO',
  target,
  details,
  actor = 'NetOps Admin',
  metadata,
}: AuditEventParams): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    await prisma.auditLog.create({
      data: {
        timestamp: nowIso,
        action,
        severity,
        actor,
        target,
        details,
        metadataJson: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (err: any) {
    console.warn('[AuditLog] Failed to persist audit event:', err.message);
  }
}

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { executeDeviceBackup } from '@/lib/collectorEngine';
import { logAuditEvent } from '@/lib/audit';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const id = parseInt(deviceId, 10);
  if (isNaN(id)) return errorResponse('Invalid device id', 400);

  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) return errorResponse('Device not found', 404);

  if (!device.lkgSnapshotId) {
    return errorResponse('No Last-Known-Good snapshot found', 400);
  }

  const lkgSnap = await prisma.configSnapshot.findUnique({ where: { id: device.lkgSnapshotId } });
  if (!lkgSnap) return errorResponse('No Last-Known-Good snapshot record found', 400);

  await prisma.device.update({
    where: { id },
    data: { simulatedRunningConfig: lkgSnap.configText },
  });

  const res = await executeDeviceBackup(id, 'Automated LKG Rollback Engine');

  await prisma.alert.updateMany({
    where: { deviceId: id, alertType: 'OUT_OF_WINDOW_DRIFT' },
    data: { acknowledged: 1 },
  });

  await logAuditEvent({
    action: 'ROLLBACK_EXECUTED',
    severity: 'WARNING',
    target: device.hostname,
    details: `Device ${device.hostname} rolled back to Last-Known-Good baseline snapshot #${lkgSnap.id}.`,
    actor: 'NetOps Admin',
    metadata: { lkg_snapshot_id: lkgSnap.id },
  });

  return jsonResponse({
    status: 'rolled_back_to_lkg',
    device_id: id,
    lkg_snapshot_id: lkgSnap.id,
    backup_result: res,
  });
}

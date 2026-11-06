import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/audit';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ deviceId: string; snapshotId: string }> }
) {
  const { deviceId, snapshotId } = await params;
  const devId = parseInt(deviceId, 10);
  const snapId = parseInt(snapshotId, 10);

  if (isNaN(devId) || isNaN(snapId)) {
    return errorResponse('Invalid parameters', 400);
  }

  const targetSnap = await prisma.configSnapshot.findFirst({
    where: { id: snapId, deviceId: devId },
  });
  if (!targetSnap) return errorResponse('Snapshot not found for device', 404);

  const device = await prisma.device.findUnique({ where: { id: devId } });
  if (!device) return errorResponse('Device not found', 404);

  const latestSnap = device.latestSnapshotId
    ? await prisma.configSnapshot.findUnique({ where: { id: device.latestSnapshotId } })
    : null;

  await prisma.$transaction([
    prisma.configSnapshot.updateMany({
      where: { deviceId: devId },
      data: { isLkg: 0 },
    }),
    prisma.configSnapshot.update({
      where: { id: snapId },
      data: { isLkg: 1 },
    }),
  ]);

  const stillDrifted = latestSnap && latestSnap.normalizedHash !== targetSnap.normalizedHash ? 1 : 0;

  await prisma.device.update({
    where: { id: devId },
    data: {
      lkgSnapshotId: snapId,
      driftDetected: stillDrifted,
    },
  });

  if (!stillDrifted) {
    await prisma.alert.updateMany({
      where: { deviceId: devId, alertType: 'OUT_OF_WINDOW_DRIFT' },
      data: { acknowledged: 1 },
    });
  }

  await logAuditEvent({
    action: 'LKG_PROMOTED',
    severity: 'INFO',
    target: device.hostname,
    details: `Snapshot #${snapId} established as new Last-Known-Good baseline for ${device.hostname}.`,
    actor: 'NetOps Admin',
    metadata: { snapshot_id: snapId, still_drifted: Boolean(stillDrifted) },
  });

  return jsonResponse({
    device_id: devId,
    new_lkg_snapshot_id: snapId,
    drift_detected: Boolean(stillDrifted),
  });
}

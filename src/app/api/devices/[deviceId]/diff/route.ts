import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { compareConfigs } from '@/lib/diffEngine';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const id = parseInt(deviceId, 10);
  if (isNaN(id)) return errorResponse('Invalid device id', 400);

  const searchParams = req.nextUrl.searchParams;
  const baseSnapshotId = searchParams.get('base_snapshot_id');
  const targetSnapshotId = searchParams.get('target_snapshot_id');
  const ignoreNoise = searchParams.get('ignore_noise') !== 'false';

  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) return errorResponse('Device not found', 404);

  const baseId = baseSnapshotId ? parseInt(baseSnapshotId, 10) : device.lkgSnapshotId;
  const targetId = targetSnapshotId ? parseInt(targetSnapshotId, 10) : device.latestSnapshotId;

  if (!baseId || !targetId) {
    return errorResponse('Device does not have snapshots to compare', 404);
  }

  const baseSnap = await prisma.configSnapshot.findUnique({ where: { id: baseId } });
  const targetSnap = await prisma.configSnapshot.findUnique({ where: { id: targetId } });

  if (!baseSnap || !targetSnap) {
    return errorResponse('Configuration snapshots not found', 404);
  }

  const baseLabel = `v${baseSnap.versionNumber} (${baseSnap.isLkg ? 'Last-Known-Good' : 'Baseline'})`;
  const targetLabel = `v${targetSnap.versionNumber} (${targetSnap.id === device.latestSnapshotId ? 'Current' : 'Snapshot'})`;

  const diffData = compareConfigs(
    baseSnap.configText,
    targetSnap.configText,
    device.vendor,
    ignoreNoise,
    baseLabel,
    targetLabel
  );

  return jsonResponse({
    device: {
      id: device.id,
      hostname: device.hostname,
      ip_address: device.ipAddress,
      vendor: device.vendor,
      model: device.model,
      site: device.site,
      drift_detected: device.driftDetected === 1,
    },
    base_snapshot: {
      id: baseSnap.id,
      version_number: baseSnap.versionNumber,
      is_lkg: baseSnap.isLkg === 1,
      normalized_hash: baseSnap.normalizedHash,
      created_at: baseSnap.createdAt,
      config_text: baseSnap.configText,
    },
    target_snapshot: {
      id: targetSnap.id,
      version_number: targetSnap.versionNumber,
      is_lkg: targetSnap.isLkg === 1,
      normalized_hash: targetSnap.normalizedHash,
      created_at: targetSnap.createdAt,
      config_text: targetSnap.configText,
    },
    ignore_noise: ignoreNoise,
    diff: diffData,
  });
}

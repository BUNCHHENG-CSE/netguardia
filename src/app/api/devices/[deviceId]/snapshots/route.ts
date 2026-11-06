import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const id = parseInt(deviceId, 10);
  if (isNaN(id)) return errorResponse('Invalid device id', 400);

  const snapshots = await prisma.configSnapshot.findMany({
    where: { deviceId: id },
    orderBy: { versionNumber: 'desc' },
    select: {
      id: true,
      deviceId: true,
      versionNumber: true,
      rawHash: true,
      normalizedHash: true,
      sizeBytes: true,
      collectedBy: true,
      inMaintenanceWindow: true,
      isLkg: true,
      notes: true,
      createdAt: true,
    },
  });

  const formatted = snapshots.map((s) => ({
    id: s.id,
    device_id: s.deviceId,
    version_number: s.versionNumber,
    raw_hash: s.rawHash,
    normalized_hash: s.normalizedHash,
    size_bytes: s.sizeBytes,
    collected_by: s.collectedBy,
    in_maintenance_window: s.inMaintenanceWindow,
    is_lkg: s.isLkg,
    notes: s.notes || '',
    created_at: s.createdAt,
  }));

  return jsonResponse(formatted);
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/apiUtils';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const id = parseInt(deviceId, 10);
  if (isNaN(id)) return errorResponse('Invalid device id', 400);

  const version = req.nextUrl.searchParams.get('version') || 'latest';

  const dev = await prisma.device.findUnique({ where: { id } });
  if (!dev) return errorResponse('Device not found', 404);

  const snapId = version === 'lkg' ? dev.lkgSnapshotId : dev.latestSnapshotId;
  if (!snapId) return errorResponse('No snapshot found for device', 404);

  const snap = await prisma.configSnapshot.findUnique({ where: { id: snapId } });
  if (!snap) return errorResponse('Snapshot text not found', 404);

  const filename = `${dev.hostname}_v${snap.versionNumber}_${version}.cfg`;
  return new NextResponse(snap.configText, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

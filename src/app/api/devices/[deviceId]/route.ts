import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const id = parseInt(deviceId, 10);
  if (isNaN(id)) return errorResponse('Invalid device id', 400);

  try {
    await prisma.device.delete({ where: { id } });
    return jsonResponse({ deleted: id });
  } catch (err: any) {
    return errorResponse(`Could not delete device: ${err.message}`, 404);
  }
}

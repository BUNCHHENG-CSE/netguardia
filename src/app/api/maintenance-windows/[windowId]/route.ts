import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ windowId: string }> }
) {
  const { windowId } = await params;
  const id = parseInt(windowId, 10);
  if (isNaN(id)) return errorResponse('Invalid window id', 400);

  try {
    await prisma.maintenanceWindow.delete({ where: { id } });
    return jsonResponse({ deleted: id });
  } catch (err: any) {
    return errorResponse(`Could not delete maintenance window: ${err.message}`, 404);
  }
}

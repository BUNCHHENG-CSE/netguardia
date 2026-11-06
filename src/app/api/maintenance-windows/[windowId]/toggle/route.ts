import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ windowId: string }> }
) {
  const { windowId } = await params;
  const id = parseInt(windowId, 10);
  if (isNaN(id)) return errorResponse('Invalid window id', 400);

  const row = await prisma.maintenanceWindow.findUnique({ where: { id } });
  if (!row) return errorResponse('Maintenance window not found', 404);

  const newVal = row.isActiveOverride === 1 ? 0 : 1;
  await prisma.maintenanceWindow.update({
    where: { id },
    data: { isActiveOverride: newVal },
  });

  return jsonResponse({ id, is_active_override: newVal === 1 });
}

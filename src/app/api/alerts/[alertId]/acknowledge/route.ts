import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const { alertId } = await params;
  const id = parseInt(alertId, 10);
  if (isNaN(id)) return errorResponse('Invalid alert id', 400);

  await prisma.alert.updateMany({
    where: { id },
    data: { acknowledged: 1 },
  });

  return jsonResponse({ acknowledged: id });
}

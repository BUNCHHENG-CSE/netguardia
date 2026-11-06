import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ credId: string }> }
) {
  const { credId } = await params;
  const id = parseInt(credId, 10);
  if (isNaN(id)) return errorResponse('Invalid credential id', 400);

  try {
    await prisma.credential.delete({ where: { id } });
    return jsonResponse({ deleted: id });
  } catch (err: any) {
    return errorResponse(`Could not delete credential: ${err.message}`, 404);
  }
}

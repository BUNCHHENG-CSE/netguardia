import { prisma } from '@/lib/prisma';
import { jsonResponse } from '@/lib/apiUtils';


export async function POST() {
  await prisma.alert.updateMany({
    where: {},
    data: { acknowledged: 1 },
  });

  return jsonResponse({ status: 'all_acknowledged' });
}

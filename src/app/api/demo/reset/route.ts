import { prisma } from '@/lib/prisma';
import { resetDatabase } from '@/lib/seedData';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST() {
  try {
    await resetDatabase(prisma);
    return jsonResponse({ status: 'demo_environment_reset' });
  } catch (err: any) {
    return errorResponse(`Failed to reset demo environment: ${err.message}`, 500);
  }
}

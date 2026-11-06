import { getDatabaseEngineInfo } from '@/lib/prisma';
import { jsonResponse } from '@/lib/apiUtils';


export async function GET() {
  const info = await getDatabaseEngineInfo();
  return jsonResponse(info);
}

import { NextRequest } from 'next/server';
import { executeDeviceBackup } from '@/lib/collectorEngine';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const id = parseInt(deviceId, 10);
  if (isNaN(id)) return errorResponse('Invalid device id', 400);

  try {
    const result = await executeDeviceBackup(id, 'On-Demand Collector');
    return jsonResponse(result);
  } catch (err: any) {
    return errorResponse(err.message, 500);
  }
}

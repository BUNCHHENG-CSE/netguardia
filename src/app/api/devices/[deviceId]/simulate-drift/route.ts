import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applySimulatedDriftToConfig, executeDeviceBackup } from '@/lib/collectorEngine';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const id = parseInt(deviceId, 10);
  if (isNaN(id)) return errorResponse('Invalid device id', 400);

  const body = await req.json().catch(() => ({}));
  const scenario = body.scenario || 'rogue_acl';

  const dev = await prisma.device.findUnique({ where: { id } });
  if (!dev) return errorResponse('Device not found', 404);

  const baseCfg = dev.simulatedRunningConfig || '';
  const [mutatedCfg, summary] = applySimulatedDriftToConfig(baseCfg, dev.vendor, scenario);

  await prisma.device.update({
    where: { id },
    data: { simulatedRunningConfig: mutatedCfg, isSimulated: 1 },
  });

  const backupResult = await executeDeviceBackup(id, `Drift Detector (${scenario})`);

  return jsonResponse({
    scenario,
    summary,
    backup_result: backupResult,
  });
}

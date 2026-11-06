import { prisma } from '@/lib/prisma';
import { executeDeviceBackup } from '@/lib/collectorEngine';
import { jsonResponse } from '@/lib/apiUtils';

export async function POST() {
  const devices = await prisma.device.findMany();
  const results = [];

  for (const d of devices) {
    try {
      const res = await executeDeviceBackup(d.id, 'Scheduled Fleet Collector');
      results.push(res);
    } catch (err: any) {
      results.push({ device_id: d.id, error: err.message });
    }
  }

  const nowIso = new Date().toISOString();
  await prisma.backupSettings.update({
    where: { id: 1 },
    data: { lastGlobalRunAt: nowIso },
  });

  return jsonResponse({
    ran_at: nowIso,
    total_processed: results.length,
    drifted_count: results.filter((r: any) => Boolean(r.drift_detected)).length,
    results,
  });
}

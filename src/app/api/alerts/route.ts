import { prisma } from '@/lib/prisma';
import { jsonResponse } from '@/lib/apiUtils';


export async function GET() {
  const rawAlerts = await prisma.alert.findMany({
    include: {
      device: {
        select: {
          hostname: true,
          ipAddress: true,
          site: true,
          vendor: true,
        },
      },
    },
    orderBy: [{ acknowledged: 'asc' }, { id: 'desc' }],
  });

  const alerts = rawAlerts.map((item) => {
    let categories: string[] = [];
    try {
      categories = JSON.parse(item.riskCategories || '[]');
    } catch {
      categories = [];
    }

    return {
      id: item.id,
      device_id: item.deviceId,
      hostname: item.device.hostname,
      ip_address: item.device.ipAddress,
      site: item.device.site,
      vendor: item.device.vendor,
      snapshot_id: item.snapshotId,
      severity: item.severity,
      alert_type: item.alertType,
      title: item.title,
      message: item.message,
      outside_maintenance_window: item.outsideMaintenanceWindow === 1,
      added_lines: item.addedLines,
      removed_lines: item.removedLines,
      risk_categories: categories,
      acknowledged: item.acknowledged === 1,
      created_at: item.createdAt,
    };
  });

  return jsonResponse(alerts);
}

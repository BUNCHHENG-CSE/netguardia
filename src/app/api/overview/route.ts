import { prisma, getDatabaseEngineInfo } from '@/lib/prisma';
import { jsonResponse, ageDays } from '@/lib/apiUtils';


export async function GET() {
  const settings = (await prisma.backupSettings.findUnique({ where: { id: 1 } })) || {
    staleBackupThresholdDays: 7,
    lastGlobalRunAt: null,
    lastReadinessAuditAt: null,
  };
  const staleDaysLimit = settings.staleBackupThresholdDays ?? 7;

  const devices = await prisma.device.findMany();
  const unackAlerts = await prisma.alert.count({ where: { acknowledged: 0 } });
  const totalNeighborLinks = await prisma.neighborLink.count();

  const sites = Array.from(new Set(devices.map((d) => d.site))).sort();
  const totalDevices = devices.length;
  const onlineDevices = devices.filter((d) => d.status === 'online').length;
  const driftedDevices = devices.filter((d) => d.driftDetected === 1).length;
  const staleDevices = devices.filter((d) => ageDays(d.lastBackupAt) > staleDaysLimit).length;
  const verifiedCleanDevices = devices.filter(
    (d) => d.driftDetected === 0 && ageDays(d.lastBackupAt) <= staleDaysLimit
  ).length;

  const readinessScore = totalDevices > 0 ? Math.round((verifiedCleanDevices / totalDevices) * 100) : 100;
  const siteCount = sites.length;

  let recommendedPlan = 'Single-Site Plan';
  let monthlyPrice = 149;
  let priceBand = '$99–$199/mo (up to 50 devices)';

  if (siteCount > 1 || totalDevices > 50) {
    recommendedPlan = 'Multi-Site Plan';
    monthlyPrice = 349;
    priceBand = '$299–$499/mo (multi-site / up to 200 devices)';
  }

  const manualHoursSaved = Math.round(totalDevices * 1.4 * 10) / 10;
  const downtimeRiskAvoided = totalDevices * 1250;
  const dbInfo = await getDatabaseEngineInfo();

  return jsonResponse({
    total_devices: totalDevices,
    online_devices: onlineDevices,
    sites,
    site_count: siteCount,
    verified_clean_devices: verifiedCleanDevices,
    drifted_devices: driftedDevices,
    stale_devices: staleDevices,
    unacknowledged_alerts: unackAlerts,
    total_neighbor_links: totalNeighborLinks,
    readiness_score: readinessScore,
    last_global_run_at: settings.lastGlobalRunAt,
    last_readiness_audit_at: settings.lastReadinessAuditAt,
    stale_backup_threshold_days: staleDaysLimit,
    database: dbInfo,
    saas_roi: {
      recommended_plan: recommendedPlan,
      monthly_price_usd: monthlyPrice,
      price_band: priceBand,
      manual_hours_saved_monthly: manualHoursSaved,
      downtime_cost_avoided_usd: downtimeRiskAvoided,
    },
  });
}

import { prisma } from '@/lib/prisma';
import { decryptSecret } from '@/lib/vault';
import { verifySshConnectivity } from '@/lib/collectorEngine';
import { jsonResponse, ageDays } from '@/lib/apiUtils';


export async function POST() {
  const settings = (await prisma.backupSettings.findUnique({ where: { id: 1 } })) || {
    staleBackupThresholdDays: 7,
  };
  const staleLimit = settings.staleBackupThresholdDays ?? 7;

  const devices = await prisma.device.findMany({
    include: { credential: true },
  });

  const nowIso = new Date().toISOString();
  const results = [];

  for (const d of devices) {
    const cred = d.credential;
    const connCheck = await verifySshConnectivity(
      d.ipAddress,
      d.sshPort,
      cred?.username || '',
      cred?.encryptedPassword ? decryptSecret(cred.encryptedPassword) : null,
      d.isSimulated === 1
    );

    const ageD = ageDays(d.lastBackupAt);
    const isFresh = ageD <= staleLimit;
    const hasLkg = Boolean(d.lkgSnapshotId);
    const hasDrift = d.driftDetected === 1;

    let statusLabel = 'READY';
    if (!connCheck.authenticated) {
      statusLabel = 'AUTH_FAILED';
    } else if (!hasLkg || !isFresh) {
      statusLabel = 'STALE_BACKUP';
    } else if (hasDrift) {
      statusLabel = 'DRIFT_UNVERIFIED';
    }

    await prisma.device.update({
      where: { id: d.id },
      data: { lastVerifiedAt: nowIso },
    });

    results.push({
      device_id: d.id,
      hostname: d.hostname,
      site: d.site,
      vendor: d.vendor,
      credential_name: cred?.name || 'Unassigned',
      ssh_verified: connCheck.authenticated,
      latency_ms: connCheck.latency_ms,
      backup_age_days: ageD,
      is_backup_fresh: isFresh,
      has_lkg: hasLkg,
      drift_detected: hasDrift,
      readiness_status: statusLabel,
      detail: connCheck.message,
    });
  }

  await prisma.backupSettings.update({
    where: { id: 1 },
    data: { lastReadinessAuditAt: nowIso },
  });

  const readyCount = results.filter((r) => r.readiness_status === 'READY').length;
  return jsonResponse({
    audited_at: nowIso,
    total_devices: results.length,
    ready_devices: readyCount,
    readiness_percentage: results.length > 0 ? Math.round((readyCount / results.length) * 100) : 100,
    results,
  });
}

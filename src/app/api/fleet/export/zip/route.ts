import JSZip from 'jszip';
import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/audit';

export async function GET() {
  const devices = await prisma.device.findMany();
  const now = new Date();
  const nowIso = now.toISOString();
  const nowSlug = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '_');

  const zip = new JSZip();
  const manifestEntries = [];

  for (const dev of devices) {
    const siteSlug = dev.site
      .replace(/\s+/g, '_')
      .replace(/[()]/g, '')
      .replace(/\//g, '-');
    const vendorSlug = dev.vendor.replace(/\s+/g, '_');
    const hostname = dev.hostname;

    let latestCfg = '';
    let latestNormHash = '';
    let latestVersion = 0;
    if (dev.latestSnapshotId) {
      const snap = await prisma.configSnapshot.findUnique({ where: { id: dev.latestSnapshotId } });
      if (snap) {
        latestCfg = snap.configText || '';
        latestNormHash = snap.normalizedHash || '';
        latestVersion = snap.versionNumber || 0;
      }
    }

    let lkgCfg = '';
    let lkgNormHash = '';
    let lkgVersion = 0;
    if (dev.lkgSnapshotId) {
      const snapLkg = await prisma.configSnapshot.findUnique({ where: { id: dev.lkgSnapshotId } });
      if (snapLkg) {
        lkgCfg = snapLkg.configText || '';
        lkgNormHash = snapLkg.normalizedHash || '';
        lkgVersion = snapLkg.versionNumber || 0;
      }
    }

    if (latestCfg) {
      const path = `${siteSlug}/${vendorSlug}/${hostname}_v${latestVersion}_latest.cfg`;
      zip.file(path, latestCfg);
    }

    if (lkgCfg && dev.lkgSnapshotId !== dev.latestSnapshotId) {
      const lkgPath = `${siteSlug}/${vendorSlug}/${hostname}_v${lkgVersion}_lkg.cfg`;
      zip.file(lkgPath, lkgCfg);
    }

    manifestEntries.push({
      hostname,
      ip_address: dev.ipAddress,
      vendor: dev.vendor,
      model: dev.model,
      site: dev.site,
      latest_version: latestVersion,
      latest_normalized_hash: latestNormHash,
      lkg_version: lkgVersion,
      lkg_normalized_hash: lkgNormHash,
      drift_detected: dev.driftDetected === 1,
    });
  }

  const manifestData = {
    title: 'NetGuardia Fleet Disaster Recovery Bundle',
    exported_at: nowIso,
    total_devices: manifestEntries.length,
    manifest: manifestEntries,
  };
  zip.file('manifest.json', JSON.stringify(manifestData, null, 2));

  const readmeText = `NetGuardia Disaster Recovery Config Archive
Generated: ${nowIso}
Total Devices: ${manifestEntries.length}

================================================================================
RESTORATION INSTRUCTIONS:
================================================================================
1. To restore a Cisco IOS/IOS-XE device:
   - Connect via Console or OOB SSH.
   - Enter privileged EXEC mode ('enable').
   - In terminal: 'configure terminal'
   - Paste corresponding '<hostname>_lkg.cfg' content or upload via SCP/TFTP:
     copy tftp://<tftp_server>/<hostname>.cfg running-config
   - Verify with: 'show running-config' and 'write memory'

2. To restore a Juniper Junos device:
   - Connect via SSH or Console.
   - Enter CLI configuration mode: 'configure'
   - Load configuration: 'load override <hostname>.cfg'
   - Check syntax: 'commit check'
   - Commit changes: 'commit comment "Disaster Recovery Restoration"'

3. To restore a Ubiquiti EdgeOS device:
   - SCP config file to /config/config.boot
   - In CLI: 'reboot' or 'load <filename>' and 'commit; save'
================================================================================
`;
  zip.file('README.txt', readmeText);

  const zipUint8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const filename = `netguardia_fleet_dr_${nowSlug}.zip`;

  await logAuditEvent({
    action: 'DR_EXPORT',
    severity: 'INFO',
    target: 'Fleet DR Bundle',
    details: `Exported Disaster Recovery bundle containing ${devices.length} device configurations.`,
  });

  return new Response(zipUint8 as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

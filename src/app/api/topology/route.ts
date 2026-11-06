import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildTopologyGraph } from '@/lib/topologyEngine';
import { jsonResponse } from '@/lib/apiUtils';


export async function GET(req: NextRequest) {
  const site = req.nextUrl.searchParams.get('site');
  const whereClause = site && site !== 'ALL' ? { site } : undefined;

  const devices = await prisma.device.findMany({
    where: whereClause,
  });

  const deviceIds = devices.map((d) => d.id);
  const neighbors =
    deviceIds.length > 0
      ? await prisma.neighborLink.findMany({
          where: { deviceId: { in: deviceIds } },
        })
      : [];

  const graph = buildTopologyGraph(
    devices.map((d) => ({
      id: d.id,
      hostname: d.hostname,
      ip_address: d.ipAddress,
      vendor: d.vendor,
      model: d.model,
      os_type: d.osType,
      role: d.role,
      site: d.site,
      status: d.status,
      drift_detected: d.driftDetected === 1,
      lkg_snapshot_id: d.lkgSnapshotId,
      last_backup_at: d.lastBackupAt,
    })),
    neighbors.map((n) => ({
      device_id: n.deviceId,
      local_port: n.localPort,
      remote_hostname: n.remoteHostname,
      remote_port: n.remotePort,
      remote_ip: n.remoteIp,
      remote_platform: n.remotePlatform,
      protocol: n.protocol,
    }))
  );

  return jsonResponse(graph);
}

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseNeighborCliOutput } from '@/lib/topologyEngine';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { raw_output, vendor, attach_to_device_id } = body;

    const parsed = parseNeighborCliOutput(raw_output || '', vendor);
    if (attach_to_device_id && parsed.length > 0) {
      const nowIso = new Date().toISOString();
      await prisma.neighborLink.createMany({
        data: parsed.map((n) => ({
          deviceId: Number(attach_to_device_id),
          localPort: n.local_port,
          remoteHostname: n.remote_hostname,
          remotePort: n.remote_port,
          remoteIp: n.remote_ip || '',
          remotePlatform: n.remote_platform || '',
          protocol: n.protocol,
          updatedAt: nowIso,
        })),
      });
    }

    return jsonResponse({
      parsed_count: parsed.length,
      neighbors: parsed,
      attached_to_device_id: attach_to_device_id || null,
    });
  } catch (err: any) {
    return errorResponse(err.message, 400);
  }
}

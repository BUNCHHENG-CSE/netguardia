import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptSecret } from '@/lib/vault';
import { verifySshConnectivity } from '@/lib/collectorEngine';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ credId: string }> }
) {
  const { credId } = await params;
  const id = parseInt(credId, 10);
  if (isNaN(id)) return errorResponse('Invalid credential id', 400);

  const cred = await prisma.credential.findUnique({ where: { id } });
  if (!cred) return errorResponse('Credential profile not found', 404);

  const devices = await prisma.device.findMany({ where: { credentialId: id } });
  const nowIso = new Date().toISOString();

  const deviceChecks = [];
  for (const d of devices) {
    const chk = await verifySshConnectivity(
      d.ipAddress,
      d.sshPort,
      cred.username,
      decryptSecret(cred.encryptedPassword),
      d.isSimulated === 1
    );

    deviceChecks.push({
      hostname: d.hostname,
      ip_address: d.ipAddress,
      authenticated: chk.authenticated,
      latency_ms: chk.latency_ms,
      message: chk.message,
    });
  }

  await prisma.credential.update({
    where: { id },
    data: { lastVerifiedAt: nowIso },
  });

  return jsonResponse({
    credential_id: id,
    name: cred.name,
    verified_at: nowIso,
    devices_tested: deviceChecks.length,
    all_passed: deviceChecks.every((dc) => dc.authenticated),
    results: deviceChecks,
  });
}

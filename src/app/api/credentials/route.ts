import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptSecret, maskSecret } from '@/lib/vault';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function GET() {
  const rows = await prisma.credential.findMany({
    include: {
      _count: {
        select: { devices: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  const formatted = rows.map((row) => ({
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    username: row.username,
    password_masked: maskSecret(row.encryptedPassword),
    enable_secret_masked: maskSecret(row.encryptedEnableSecret),
    ssh_key_masked: row.encryptedSshKey ? 'RSA/OpenSSH Key (AES-Fernet Encrypted)' : 'Not configured',
    snmp_community_masked: maskSecret(row.encryptedSnmpCommunity),
    description: row.description || '',
    assigned_devices_count: row._count.devices,
    last_verified_at: row.lastVerifiedAt,
    created_at: row.createdAt,
  }));

  return jsonResponse(formatted);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      protocol = 'SSH',
      username,
      password,
      enable_secret,
      ssh_private_key,
      snmp_community,
      description = '',
    } = body;

    if (!name || !username) {
      return errorResponse('Name and username are required', 400);
    }

    const nowIso = new Date().toISOString();
    const created = await prisma.credential.create({
      data: {
        name,
        protocol,
        username,
        encryptedPassword: encryptSecret(password),
        encryptedEnableSecret: encryptSecret(enable_secret),
        encryptedSshKey: encryptSecret(ssh_private_key),
        encryptedSnmpCommunity: encryptSecret(snmp_community),
        description,
        lastVerifiedAt: nowIso,
        createdAt: nowIso,
      },
    });

    return jsonResponse({ id: created.id, name: created.name }, 201);
  } catch (err: any) {
    return errorResponse(err.message, 400);
  }
}

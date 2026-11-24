import { NextResponse } from 'next/server';
import type { ConfigSnapshot } from '@prisma/client';
import { prisma } from './prisma';

export function jsonResponse(data: any, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export function errorResponse(detail: string, status = 400) {
  return NextResponse.json({ detail }, { status });
}

export function ageDays(isoTs: string | null | undefined): number {
  if (!isoTs) return 999.0;
  try {
    const dt = new Date(isoTs);
    if (isNaN(dt.getTime())) return 999.0;
    const diffMs = Date.now() - dt.getTime();
    return Math.max(0, Math.round((diffMs / (86400 * 1000)) * 100) / 100);
  } catch {
    return 999.0;
  }
}

/**
 * Batch-load config snapshots by id in a single query (avoids N+1 lookups
 * when iterating over a device list). Null/undefined ids are skipped.
 */
export async function loadSnapshotsByIds(ids: Array<number | null | undefined>) {
  const unique = Array.from(new Set(ids.filter((id): id is number => typeof id === 'number')));
  if (unique.length === 0) return new Map<number, ConfigSnapshot>();
  const snaps = await prisma.configSnapshot.findMany({ where: { id: { in: unique } } });
  return new Map(snaps.map((s) => [s.id, s]));
}

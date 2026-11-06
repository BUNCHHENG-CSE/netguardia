import { NextResponse } from 'next/server';

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

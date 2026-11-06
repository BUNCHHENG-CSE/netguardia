import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function GET() {
  const windows = await prisma.maintenanceWindow.findMany({
    orderBy: { id: 'asc' },
  });
  const formatted = windows.map((w) => ({
    id: w.id,
    name: w.name,
    site: w.site,
    day_of_week: w.dayOfWeek,
    start_time_utc: w.startTimeUtc,
    end_time_utc: w.endTimeUtc,
    is_active_override: Boolean(w.isActiveOverride),
    auto_promote_lkg: Boolean(w.autoPromoteLkg),
    created_at: w.createdAt,
  }));
  return jsonResponse(formatted);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      site = 'ALL',
      day_of_week = 'Sunday',
      start_time_utc = '02:00',
      end_time_utc = '04:00',
      is_active_override = false,
      auto_promote_lkg = true,
    } = body;

    const nowIso = new Date().toISOString();
    const created = await prisma.maintenanceWindow.create({
      data: {
        name,
        site,
        dayOfWeek: day_of_week,
        startTimeUtc: start_time_utc,
        endTimeUtc: end_time_utc,
        isActiveOverride: is_active_override ? 1 : 0,
        autoPromoteLkg: auto_promote_lkg ? 1 : 0,
        createdAt: nowIso,
      },
    });

    return jsonResponse({ id: created.id, name: created.name }, 201);
  } catch (err: any) {
    return errorResponse(err.message, 400);
  }
}

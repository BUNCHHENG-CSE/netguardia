import { NextRequest } from 'next/server';
import { testPostgresConnection } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dsn = body.dsn || '';
    const res = await testPostgresConnection(dsn);
    return jsonResponse(res);
  } catch (err: any) {
    return errorResponse(err.message, 400);
  }
}

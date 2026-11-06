import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';


export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const query = searchParams.get('query') || '';
  const isRegex = searchParams.get('is_regex') === 'true';
  const caseSensitive = searchParams.get('case_sensitive') === 'true';
  const site = searchParams.get('site');
  const vendor = searchParams.get('vendor');
  const scope = searchParams.get('scope') || 'latest';

  if (!query) {
    return errorResponse('Search query is required', 400);
  }

  const whereClause: any = {};
  if (site && site !== 'ALL') whereClause.site = site;
  if (vendor && vendor !== 'ALL') whereClause.vendor = vendor;

  const devices = await prisma.device.findMany({
    where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
  });

  let regex: RegExp | null = null;
  if (isRegex) {
    try {
      regex = new RegExp(query, caseSensitive ? undefined : 'i');
    } catch (err: any) {
      return errorResponse(`Invalid regular expression: ${err.message}`, 400);
    }
  }
  const searchStr = caseSensitive ? query : query.toLowerCase();

  const results = [];
  let totalMatches = 0;

  for (const dev of devices) {
    const snapId = scope === 'latest' ? dev.latestSnapshotId : dev.lkgSnapshotId;
    if (!snapId) continue;

    const snap = await prisma.configSnapshot.findUnique({ where: { id: snapId } });
    if (!snap || !snap.configText) continue;

    const rawLines = snap.configText.split(/\r?\n/);
    const matchedItems = [];

    for (let idx = 0; idx < rawLines.length; idx++) {
      const line = rawLines[idx];
      let lineMatched = false;
      if (regex) {
        lineMatched = regex.test(line);
      } else {
        lineMatched = caseSensitive ? line.includes(searchStr) : line.toLowerCase().includes(searchStr);
      }

      if (lineMatched) {
        const startCtx = Math.max(0, idx - 2);
        const endCtx = Math.min(rawLines.length, idx + 3);
        const contextLines = [];

        for (let cIdx = startCtx; cIdx < endCtx; cIdx++) {
          contextLines.push({
            line_number: cIdx + 1,
            text: rawLines[cIdx],
            is_target: cIdx === idx,
          });
        }

        matchedItems.push({
          line_number: idx + 1,
          matched_line: line.trim(),
          context: contextLines,
        });
      }
    }

    if (matchedItems.length > 0) {
      totalMatches += matchedItems.length;
      results.push({
        device_id: dev.id,
        hostname: dev.hostname,
        ip_address: dev.ipAddress,
        site: dev.site,
        vendor: dev.vendor,
        model: dev.model,
        role: dev.role,
        snapshot_id: snap.id,
        snapshot_version: snap.versionNumber,
        is_lkg: snap.isLkg === 1,
        match_count: matchedItems.length,
        matches: matchedItems,
      });
    }
  }

  return jsonResponse({
    query,
    is_regex: isRegex,
    case_sensitive: caseSensitive,
    scope,
    total_devices_searched: devices.length,
    devices_with_matches: results.length,
    total_matched_lines: totalMatches,
    results,
  });
}

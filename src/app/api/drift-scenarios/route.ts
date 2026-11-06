import { DRIFT_SCENARIOS } from '@/lib/collectorEngine';
import { jsonResponse } from '@/lib/apiUtils';


export async function GET() {
  return jsonResponse(DRIFT_SCENARIOS);
}

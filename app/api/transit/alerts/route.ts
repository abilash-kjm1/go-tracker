import { getProvider } from '@/lib/transit/provider';
import { envelope, handleError, okAlerts, rateLimit } from '@/lib/transit/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;
  try {
    const provider = await getProvider();
    const alerts = await provider.getAlerts();
    const newest = alerts.length
      ? Math.max(...alerts.map((a) => new Date(a.updatedAt).getTime()))
      : null;
    return okAlerts(envelope(alerts, { updatedAt: newest ? new Date(newest) : null }));
  } catch (err) {
    return handleError(err);
  }
}

import { getProvider } from '@/lib/transit/provider';
import { envelope, handleError, okStatic, rateLimit } from '@/lib/transit/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;
  try {
    const provider = await getProvider();
    const routes = await provider.getRoutes();
    const type = new URL(request.url).searchParams.get('type');
    const filtered = type && type !== 'all' ? routes.filter((r) => r.type === type) : routes;
    return okStatic(envelope(filtered, { freshness: 'scheduled', updatedAt: null }));
  } catch (err) {
    return handleError(err);
  }
}

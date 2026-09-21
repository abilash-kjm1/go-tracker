import { getProvider } from '@/lib/transit/provider';
import { envelope, handleError, ok, rateLimit } from '@/lib/transit/api';
import { platformSourceEnabled } from '@/lib/transit/platformSource';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 60);
  if (limited) return limited;
  try {
    const provider = await getProvider();
    const health = await provider.health();
    // Boolean only — never the key itself.
    const withPlatforms = { ...health, platformSource: platformSourceEnabled() };
    return ok(
      envelope(withPlatforms, {
        updatedAt: health.lastSuccessAt,
        freshness: health.connected ? (health.stale ? 'stale' : 'live') : 'unavailable',
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}

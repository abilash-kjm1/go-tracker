import { getProvider } from '@/lib/transit/provider';
import { envelope, handleError, okSearch, rateLimit, searchQuerySchema } from '@/lib/transit/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 240);
  if (limited) return limited;
  try {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const parsed = searchQuerySchema.safeParse(q);
    if (!parsed.success) {
      return okSearch(
        envelope({ stops: [], routes: [], trips: [] }, { freshness: 'scheduled', updatedAt: null }),
      );
    }
    const provider = await getProvider();
    const results = await provider.search(parsed.data);
    return okSearch(envelope(results, { freshness: 'scheduled', updatedAt: null }));
  } catch (err) {
    return handleError(err);
  }
}

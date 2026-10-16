import type { Repository } from '../db/repository';
import type { WikiCandidate } from '../../shared/entity';
export class WikidataUnavailableError extends Error {}
export const USER_AGENT =
  'Vivid/0.1 (EPUB reader; contact: maintainer@example.invalid)';
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await run();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
interface WikiEntity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, { mainsnak?: { datavalue?: { value: unknown } } }[]>;
}
interface WikiResponse {
  search?: { id: string }[];
  entities?: Record<string, WikiEntity>;
  error?: { code: string };
}
const claim = <T>(entity: WikiEntity, property: string) =>
  entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value as T | undefined;
export class WikidataClient {
  constructor(
    private repo: Repository,
    private fetcher: typeof fetch = fetch,
    private delay: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  async request(params: Record<string, string>): Promise<WikiResponse> {
    const query = new URLSearchParams({
      ...params,
      format: 'json',
      maxlag: '5',
    });
    query.sort();
    const cacheKey = query.toString();
    const cached = this.repo.cacheGet(cacheKey);
    if (cached) return cached as WikiResponse;
    return limited(async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const response = await this.fetcher(
            `https://www.wikidata.org/w/api.php?${query}`,
            {
              headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
              signal: AbortSignal.timeout(20000),
            },
          );
          if (response.status === 429 || response.status >= 500) {
            if (attempt === 3) throw new Error('Wikidata rate limit');
            const retry = Number(response.headers.get('retry-after'));
            await this.delay(
              Math.max(
                300 * 2 ** attempt,
                Math.min(10000, Number.isFinite(retry) ? retry * 1000 : 0),
              ),
            );
            continue;
          }
          if (!response.ok) throw new Error('Wikidata HTTP failure');
          const value = (await response.json()) as WikiResponse;
          if (value.error) throw new Error('Wikidata API failure');
          this.repo.cachePut(cacheKey, value);
          return value;
        } catch (error) {
          if (attempt === 3)
            throw new WikidataUnavailableError('Wikidata request exhausted', {
              cause: error,
            });
          await this.delay(300 * 2 ** attempt);
        }
      }
      throw new Error('Wikidata request exhausted');
    });
  }
  async search(surface: string, original: string): Promise<WikiCandidate[]> {
    const searches = await Promise.all([
      this.request({
        action: 'wbsearchentities',
        search: surface,
        language: 'zh',
        limit: '8',
        type: 'item',
      }),
      this.request({
        action: 'wbsearchentities',
        search: original || surface,
        language: 'en',
        limit: '8',
        type: 'item',
      }),
    ]);
    const ids = [
      ...new Set(
        searches.flatMap((x) => x.search?.map((item) => item.id) ?? []),
      ),
    ].filter((x) => /^Q[1-9]\d*$/.test(x));
    if (!ids.length) return [];
    const result = await this.request({
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'labels|descriptions|claims',
      languages: 'zh|en',
    });
    const records = Object.values(result.entities ?? {}).filter((x) => x.id);
    const countries = [
      ...new Set(
        records
          .map((x) => claim<{ id: string }>(x, 'P17')?.id)
          .filter((x): x is string => !!x),
      ),
    ];
    const labels = countries.length
      ? await this.request({
          action: 'wbgetentities',
          ids: countries.join('|'),
          props: 'labels|claims',
          languages: 'zh|en',
        })
      : undefined;
    const capitalIds = [
      ...new Set(
        Object.values(labels?.entities ?? {}).flatMap((country) => {
          const id = claim<{ id: string }>(country, 'P36')?.id;
          return id ? [id] : [];
        }),
      ),
    ];
    const capitals = capitalIds.length
      ? await this.request({
          action: 'wbgetentities',
          ids: capitalIds.join('|'),
          props: 'labels|claims',
          languages: 'zh|en',
        })
      : undefined;
    return records.map((entity) => {
      const coord = claim<{ latitude: number; longitude: number }>(
        entity,
        'P625',
      );
      const country = claim<{ id: string }>(entity, 'P17')?.id;
      const lat = coord?.latitude;
      const lon = coord?.longitude;
      const valid =
        typeof lat === 'number' &&
        typeof lon === 'number' &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180;
      const capitalId =
        country && labels?.entities?.[country]
          ? claim<{ id: string }>(labels.entities[country], 'P36')?.id
          : undefined;
      const capitalEntity = capitalId
        ? capitals?.entities?.[capitalId]
        : undefined;
      const capitalCoord = capitalEntity
        ? claim<{ latitude: number; longitude: number }>(capitalEntity, 'P625')
        : undefined;
      const capital =
        capitalCoord &&
        Math.abs(capitalCoord.latitude) <= 90 &&
        Math.abs(capitalCoord.longitude) <= 180
          ? {
              name:
                capitalEntity?.labels?.zh?.value ??
                capitalEntity?.labels?.en?.value ??
                capitalId!,
              lat: capitalCoord.latitude,
              lon: capitalCoord.longitude,
            }
          : undefined;
      const area = claim<{ amount: string; unit: string }>(entity, 'P2046');
      const squareKm = area?.unit.endsWith('/Q712226')
        ? Number(area.amount)
        : area?.unit.endsWith('/Q25343')
          ? Number(area.amount) / 1e6
          : undefined;
      const region = (entity.claims?.P31 ?? []).some((x) =>
        ['Q82794', 'Q618123', 'Q6256', 'Q5107'].includes(
          (x.mainsnak?.datavalue?.value as { id?: string })?.id ?? '',
        ),
      );
      const radiusKm =
        region && squareKm && squareKm > 0
          ? Math.sqrt(squareKm / Math.PI)
          : undefined;
      return {
        capital,
        radiusKm,
        qid: entity.id,
        label:
          entity.labels?.zh?.value ?? entity.labels?.en?.value ?? entity.id,
        original: entity.labels?.en?.value ?? '',
        description:
          entity.descriptions?.zh?.value ??
          entity.descriptions?.en?.value ??
          '',
        ...(valid ? { lat, lon } : {}),
        types: (entity.claims?.P31 ?? []).flatMap((x) => {
          const value = x.mainsnak?.datavalue?.value as
            { id?: string } | undefined;
          return value?.id ? [value.id] : [];
        }),
        country: country
          ? (labels?.entities?.[country]?.labels?.zh?.value ?? country)
          : undefined,
        image: claim<string>(entity, 'P18'),
        birth: claim<{ time: string }>(entity, 'P569')?.time,
        death: claim<{ time: string }>(entity, 'P570')?.time,
      };
    });
  }
}

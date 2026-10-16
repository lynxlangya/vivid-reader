import type { Repository } from '../db/repository';
import type { WikiCandidate } from '../../shared/entity';
import { eachLimit } from '../concurrency';
export class WikidataUnavailableError extends Error {}
// Wikimedia's User-Agent policy asks for a way to reach the maintainer.
export const USER_AGENT =
  'Vivid/0.1 (EPUB reader; https://github.com/lynxlangya/vivid-reader)';
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
// The pipeline keeps few requests queued, so a reader's own candidate search
// waits behind a handful of them rather than the whole book.
const ENTITY_BATCH = 50;
const SEARCHES_IN_FLIGHT = 3;
const LOOKUPS_IN_FLIGHT = 2;
// The claims a candidate reads; cached entities keep nothing else.
const CANDIDATE_CLAIMS = ['P17', 'P18', 'P31', 'P569', 'P570', 'P625', 'P2046'];
interface Statement {
  rank?: 'preferred' | 'normal' | 'deprecated';
  mainsnak?: { datavalue?: { value: unknown } };
}
type Claims = Record<string, Statement[]>;
interface WikiEntity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Claims;
}
interface WikiResponse {
  search?: { id: string }[];
  entities?: Record<string, WikiEntity>;
  claims?: Claims;
  error?: { code: string };
}
interface Lookup {
  found: Map<string, WikiEntity>;
  failed: Set<string>;
}
// Wikidata's best statements: the preferred ones, else the normal ones. A
// deprecated statement is never read; one without a rank counts as normal.
function best(statements: Statement[] = []) {
  const live = statements.filter((x) => x.rank !== 'deprecated');
  const preferred = live.filter((x) => x.rank === 'preferred');
  return preferred.length ? preferred : live;
}
// The first value among the best statements. Best statements of no value or
// an unknown one still outrank the rest, so nothing is read then.
const claim = <T>(
  entity: Pick<WikiEntity, 'claims'> | undefined,
  property: string,
) => {
  const statements = best(entity?.claims?.[property]);
  const valued = statements.find((x) => x.mainsnak?.datavalue);
  return valued?.mainsnak?.datavalue?.value as T | undefined;
};
const itemId = (entity: WikiEntity | undefined, property: string) =>
  claim<{ id: string }>(entity, property)?.id;
function trim(entity: WikiEntity, properties: string[]): WikiEntity {
  if (!entity.claims) return entity;
  const claims: Claims = {};
  for (const property of properties)
    if (entity.claims[property])
      claims[property] = entity.claims[property].map(({ rank, mainsnak }) => ({
        rank,
        mainsnak: mainsnak?.datavalue
          ? { datavalue: { value: mainsnak.datavalue.value } }
          : {},
      }));
  return { ...entity, claims };
}
export class WikidataClient {
  constructor(
    private repo: Repository,
    private fetcher: typeof fetch = fetch,
    private delay: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  async request(params: Record<string, string>): Promise<WikiResponse> {
    // No maxlag: it throttles bots that edit, and only ever fails these reads
    // while the query service lags behind.
    const query = new URLSearchParams({ ...params, format: 'json' });
    query.sort();
    const cacheKey = query.toString();
    const cached = this.repo.cacheGet(cacheKey);
    if (cached) return cached as WikiResponse;
    const value = await this.fetchJson(query);
    this.repo.cachePut(cacheKey, value);
    return value;
  }
  private fetchJson(query: URLSearchParams): Promise<WikiResponse> {
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
          // wbgetentities answers a missing or redirected item with an entry;
          // wbgetclaims answers with these errors, which are answers too.
          const answer =
            query.get('action') === 'wbgetclaims' &&
            ['no-such-entity', 'unresolved-redirect'].includes(
              value.error?.code ?? '',
            );
          if (value.error && !answer) throw new Error('Wikidata API failure');
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
  // Entities by id, cached one by one with only the given claims and fetched
  // in batches. Ids in a batch that exhausts its retries come back as failed.
  private async entities(
    ids: Iterable<string>,
    props: string,
    properties: string[] = [],
  ): Promise<Lookup> {
    // Versioned by what trimmed entries keep; v2 added statement ranks.
    const key = (id: string) =>
      `entity-v2:${props}:${properties.join(',')}:${id}`;
    const lookup: Lookup = { found: new Map(), failed: new Set() };
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const cached = this.repo.cacheGet(key(id)) as WikiEntity | undefined;
      if (cached) lookup.found.set(id, cached);
      else missing.push(id);
    }
    const batches = Array.from(
      { length: Math.ceil(missing.length / ENTITY_BATCH) },
      (_, i) => missing.slice(i * ENTITY_BATCH, (i + 1) * ENTITY_BATCH),
    );
    await eachLimit(batches, LOOKUPS_IN_FLIGHT, async (batch) => {
      try {
        const result = await this.fetchJson(
          new URLSearchParams({
            action: 'wbgetentities',
            ids: batch.join('|'),
            props,
            languages: 'zh|en',
            format: 'json',
          }),
        );
        // Keyed by the requested id; a redirect's entry carries its target.
        for (const [id, entity] of Object.entries(result.entities ?? {})) {
          if (!entity.id) continue;
          const value = trim(entity, properties);
          this.repo.cachePut(key(id), value);
          lookup.found.set(id, value);
        }
      } catch (error) {
        if (!(error instanceof WikidataUnavailableError)) throw error;
        for (const id of batch) lookup.failed.add(id);
      }
    });
    return lookup;
  }
  // One property of each entity; wbgetclaims answers with only that property.
  private async claims(
    ids: Iterable<string>,
    property: string,
  ): Promise<Lookup> {
    const lookup: Lookup = { found: new Map(), failed: new Set() };
    await eachLimit([...new Set(ids)], LOOKUPS_IN_FLIGHT, async (id) => {
      try {
        const result = await this.request({
          action: 'wbgetclaims',
          entity: id,
          property,
        });
        if (result.error?.code !== 'unresolved-redirect') {
          lookup.found.set(id, { id, claims: result.claims ?? {} });
          return;
        }
        // wbgetentities follows the redirect, as full lookups always did.
        const resolved = await this.entities([id], 'claims', [property]);
        if (resolved.failed.has(id)) lookup.failed.add(id);
        else lookup.found.set(id, resolved.found.get(id) ?? { id });
      } catch (error) {
        if (!(error instanceof WikidataUnavailableError)) throw error;
        lookup.failed.add(id);
      }
    });
    return lookup;
  }
  // Searches for several entities at once. Candidates, their states and the
  // states' capitals are looked up together, so each id is fetched only once.
  async searchMany(
    queries: { surface: string; original: string }[],
  ): Promise<(WikiCandidate[] | WikidataUnavailableError)[]> {
    const searched: (string[] | WikidataUnavailableError)[] = [];
    await eachLimit(queries, SEARCHES_IN_FLIGHT, async (query, index) => {
      try {
        const searches = await Promise.all([
          this.request({
            action: 'wbsearchentities',
            search: query.surface,
            language: 'zh',
            limit: '8',
            type: 'item',
          }),
          this.request({
            action: 'wbsearchentities',
            search: query.original || query.surface,
            language: 'en',
            limit: '8',
            type: 'item',
          }),
        ]);
        searched[index] = [
          ...new Set(
            searches.flatMap((x) => x.search?.map((item) => item.id) ?? []),
          ),
        ].filter((x) => /^Q[1-9]\d*$/.test(x));
      } catch (error) {
        if (!(error instanceof WikidataUnavailableError)) throw error;
        searched[index] = error;
      }
    });
    const records = await this.entities(
      searched.flatMap((ids) => (Array.isArray(ids) ? ids : [])),
      'labels|descriptions|claims',
      CANDIDATE_CLAIMS,
    );
    const countryIds = [...records.found.values()].flatMap(
      (entity) => itemId(entity, 'P17') ?? [],
    );
    const [countries, capitalOf] = await Promise.all([
      this.entities(countryIds, 'labels'),
      this.claims(countryIds, 'P36'),
    ]);
    const capitalIds = countryIds.flatMap(
      (id) => itemId(capitalOf.found.get(id), 'P36') ?? [],
    );
    const [capitals, capitalCoords] = await Promise.all([
      this.entities(capitalIds, 'labels'),
      this.claims(capitalIds, 'P625'),
    ]);
    const lookups = [records, countries, capitalOf, capitals, capitalCoords];
    return searched.map((ids) => {
      if (!Array.isArray(ids)) return ids;
      const entities = ids.flatMap((id) => records.found.get(id) ?? []);
      const countryOf = entities.flatMap((x) => itemId(x, 'P17') ?? []);
      const needed = [
        ...ids,
        ...countryOf,
        ...countryOf.flatMap(
          (id) => itemId(capitalOf.found.get(id), 'P36') ?? [],
        ),
      ];
      if (needed.some((id) => lookups.some((x) => x.failed.has(id))))
        return new WikidataUnavailableError('Wikidata lookup exhausted');
      return entities.map((entity) =>
        this.candidate(entity, countries, capitalOf, capitals, capitalCoords),
      );
    });
  }
  async search(surface: string, original: string): Promise<WikiCandidate[]> {
    const [found] = await this.searchMany([{ surface, original }]);
    if (found instanceof Error) throw found;
    return found;
  }
  private candidate(
    entity: WikiEntity,
    countries: Lookup,
    capitalOf: Lookup,
    capitals: Lookup,
    capitalCoords: Lookup,
  ): WikiCandidate {
    const coord = claim<{ latitude: number; longitude: number }>(
      entity,
      'P625',
    );
    const country = itemId(entity, 'P17');
    const lat = coord?.latitude;
    const lon = coord?.longitude;
    const valid =
      typeof lat === 'number' &&
      typeof lon === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180;
    const capitalId = country
      ? itemId(capitalOf.found.get(country), 'P36')
      : undefined;
    const capitalEntity = capitalId ? capitals.found.get(capitalId) : undefined;
    const capitalCoord = capitalId
      ? claim<{ latitude: number; longitude: number }>(
          capitalCoords.found.get(capitalId),
          'P625',
        )
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
    // Every class but deprecated ones: a lesser rank can still be true.
    const types = (entity.claims?.P31 ?? []).flatMap((x) => {
      const value = x.mainsnak?.datavalue?.value as { id?: string } | undefined;
      return x.rank !== 'deprecated' && value?.id ? [value.id] : [];
    });
    const region = types.some((type) =>
      ['Q82794', 'Q618123', 'Q6256', 'Q5107'].includes(type),
    );
    const radiusKm =
      region && squareKm && squareKm > 0
        ? Math.sqrt(squareKm / Math.PI)
        : undefined;
    return {
      capital,
      radiusKm,
      qid: entity.id,
      label: entity.labels?.zh?.value ?? entity.labels?.en?.value ?? entity.id,
      original: entity.labels?.en?.value ?? '',
      description:
        entity.descriptions?.zh?.value ?? entity.descriptions?.en?.value ?? '',
      ...(valid ? { lat, lon } : {}),
      types,
      country: country
        ? (countries.found.get(country)?.labels?.zh?.value ?? country)
        : undefined,
      image: claim<string>(entity, 'P18'),
      birth: claim<{ time: string }>(entity, 'P569')?.time,
      death: claim<{ time: string }>(entity, 'P570')?.time,
    };
  }
}

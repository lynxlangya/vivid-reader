import { vi } from 'vitest';
import entities from './wikidata-entities.json';
import countries from './wikidata-countries.json';
type Rank = 'preferred' | 'normal' | 'deprecated';
type Claims = Record<
  string,
  {
    rank?: Rank;
    mainsnak?: { snaktype?: string; datavalue?: { value: unknown } };
  }[]
>;
interface FixtureRecord {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Claims;
}
// Statements as Wikidata returns them, which always carry a rank.
export const claim = (value: unknown, rank: Rank = 'normal') => ({
  rank,
  mainsnak: { snaktype: 'value', datavalue: { value } },
});
export const noValue = (rank: Rank = 'normal') => ({
  rank,
  mainsnak: { snaktype: 'novalue' },
});
export const item = (id: string, rank?: Rank) =>
  claim({ 'entity-type': 'item', id }, rank);
export const point = (latitude: number, longitude: number, rank?: Rank) =>
  claim({ latitude, longitude }, rank);
// Recorded candidates and the recorded labels of their preferred states, with
// synthetic capitals. Reading the first statement, or a deprecated one, picks
// a wrong capital or coordinate here, as the recorded P17 claims already do.
export const wikidataRecords: Record<string, FixtureRecord> = {
  ...(entities.entities as Record<string, FixtureRecord>),
  Q183: {
    id: 'Q183',
    labels: countries.entities.Q183.labels,
    claims: { P36: [item('Q900003'), item('Q900001', 'preferred')] },
  },
  Q145: {
    id: 'Q145',
    labels: countries.entities.Q145.labels,
    claims: { P36: [item('Q900003', 'deprecated'), item('Q900002')] },
  },
  Q900001: {
    id: 'Q900001',
    labels: { zh: { value: '合成都城甲' } },
    claims: {
      P625: [point(0, 0, 'deprecated'), point(52.4, 12.9), point(0, 0)],
    },
  },
  Q900002: {
    id: 'Q900002',
    labels: { en: { value: 'Fixture Capital B' } },
    claims: { P625: [point(41.9, 12.5)] },
  },
};
// Serves wbsearchentities, wbgetentities and wbgetclaims from records shaped
// like recorded Wikidata responses, and logs the ids each request asked for.
// Redirected ids answer as Wikidata does: wbgetentities returns the target
// under the requested id, wbgetclaims refuses.
export function wikidataServer(
  searches: Record<string, string[]>,
  records: Record<string, FixtureRecord> = wikidataRecords,
  redirects: Record<string, string> = {},
) {
  const log: { action: string; ids: string[] }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    const params = new URL(String(input)).searchParams;
    const action = params.get('action') ?? '';
    if (action === 'wbsearchentities') {
      log.push({ action, ids: [] });
      const key = `${params.get('language')}:${params.get('search')}`;
      return Response.json({
        search: (searches[key] ?? []).map((id) => ({ id })),
      });
    }
    if (action === 'wbgetclaims') {
      const id = params.get('entity') ?? '';
      log.push({ action, ids: [id] });
      if (redirects[id])
        return Response.json({ error: { code: 'unresolved-redirect' } });
      const record = records[id];
      if (!record) return Response.json({ error: { code: 'no-such-entity' } });
      const property = params.get('property') ?? '';
      const claims = record.claims?.[property];
      return Response.json({ claims: claims ? { [property]: claims } : {} });
    }
    const ids = (params.get('ids') ?? '').split('|');
    log.push({ action, ids });
    const props = (params.get('props') ?? '').split('|');
    return Response.json({
      entities: Object.fromEntries(
        ids.map((id) => {
          const target = redirects[id] ?? id;
          const record = records[target];
          if (!record) return [id, { id, missing: '' }];
          return [
            id,
            {
              type: 'item',
              id: target,
              ...(redirects[id] ? { redirects: { from: id, to: target } } : {}),
              ...(props.includes('labels') ? { labels: record.labels } : {}),
              ...(props.includes('descriptions')
                ? { descriptions: record.descriptions }
                : {}),
              ...(props.includes('claims') ? { claims: record.claims } : {}),
            },
          ];
        }),
      ),
    });
  });
  const count = (action: string) =>
    log.filter((entry) => entry.action === action).length;
  return { fetcher, log, count, maxInFlight: () => maxInFlight };
}

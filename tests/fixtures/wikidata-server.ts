import { vi } from 'vitest';
import entities from './wikidata-entities.json';
type Claims = Record<
  string,
  { mainsnak?: { datavalue?: { value: unknown } } }[]
>;
interface FixtureRecord {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Claims;
}
const claim = (value: unknown) => ({ mainsnak: { datavalue: { value } } });
const item = (id: string) => claim({ 'entity-type': 'item', id });
const point = (latitude: number, longitude: number) =>
  claim({ latitude, longitude });
// Recorded candidates plus synthetic states and capitals for their first P17
// claims. Each record lists more than one statement where order matters.
export const wikidataRecords: Record<string, FixtureRecord> = {
  ...(entities.entities as Record<string, FixtureRecord>),
  Q148499: {
    id: 'Q148499',
    labels: { zh: { value: '合成国甲' }, en: { value: 'Fixture State A' } },
    claims: { P36: [item('Q900001'), item('Q900003')] },
  },
  Q2277: {
    id: 'Q2277',
    labels: { en: { value: 'Fixture State B' } },
    claims: { P36: [item('Q900002')] },
  },
  Q900001: {
    id: 'Q900001',
    labels: { zh: { value: '合成都城甲' } },
    claims: { P625: [point(52.4, 12.9), point(0, 0)] },
  },
  Q900002: {
    id: 'Q900002',
    labels: { en: { value: 'Fixture Capital B' } },
    claims: { P625: [point(41.9, 12.5)] },
  },
};
// Serves wbsearchentities, wbgetentities and wbgetclaims from records shaped
// like recorded Wikidata responses, and logs the ids each request asked for.
export function wikidataServer(
  searches: Record<string, string[]>,
  records: Record<string, FixtureRecord> = wikidataRecords,
) {
  const log: { action: string; ids: string[] }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input) => {
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
          const record = records[id];
          if (!record) return [id, { id, missing: '' }];
          return [
            id,
            {
              type: 'item',
              id,
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
  return { fetcher, log, count };
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import initialSQL from './migrations/001_initial.sql?raw';
import canonicalSQL from './migrations/002_canonical.sql?raw';
import type { Chapter } from '../../shared/book';
import type {
  Entity,
  ExtractedEntity,
  PipelineReport,
  ReviewEntity,
} from '../../shared/entity';
import { cfiAt } from '../content/epub';
import type { ConversationMessage } from '../../shared/companion';
import { randomUUID } from 'node:crypto';
import type { Mention } from '../../shared/reading';
interface BookRecord {
  id: string;
  title: string;
  author: string;
  path: string;
}
interface Job {
  status: string;
  attempts: number;
  error: string | null;
}
interface UsageRecord {
  input: number;
  output: number;
  cacheRead: number;
  cost: { total: number };
}
type Row = Record<string, string | number | bigint | Uint8Array | null>;
export function openRepository(path: string) {
  if (path !== ':memory:') {
    const rel = relative(resolve(process.cwd()), resolve(path));
    if (!rel.startsWith('..') && !isAbsolute(rel))
      throw new Error('Database must be outside the repository');
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const migrations = [
    [1, initialSQL],
    [2, canonicalSQL],
  ] as const;
  for (const [version, sql] of migrations) {
    if (
      db
        .prepare('SELECT version FROM schema_migrations WHERE version=?')
        .get(version)
    )
      continue;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(
        version,
        Date.now(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  let active = false;
  const transaction = <T>(run: () => T): T => {
    if (active) return run();
    db.exec('BEGIN IMMEDIATE');
    active = true;
    try {
      const result = run();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      active = false;
    }
  };
  const rawEntities = (bookId: string): Entity[] =>
    db
      .prepare(
        'SELECT * FROM entities WHERE book_id=? AND canonical_id IS NULL ORDER BY id',
      )
      .all(bookId)
      .map((row) => {
        const candidates = JSON.parse(
          String(row.candidates_json),
        ) as Entity['candidates'];
        return {
          id: String(row.id),
          bookId,
          type: row.type as Entity['type'],
          name: String(row.name_zh),
          original: String(row.name_original),
          aliases: JSON.parse(String(row.aliases_json)) as string[],
          importance: Number(row.importance),
          note: String(row.extraction_note),
          chapters: JSON.parse(String(row.source_chapters_json)) as number[],
          candidates,
          linked: candidates.find((x) => x.qid === row.wikidata_qid),
          confidence: Number(row.link_confidence),
          status: row.link_status as Entity['status'],
          review: row.review === null ? null : !!row.review,
        };
      });
  const entities = (bookId: string): Entity[] =>
    rawEntities(bookId).map((entity) => {
      for (const row of db
        .prepare(
          'SELECT field,new_value FROM corrections WHERE entity_id=? ORDER BY id',
        )
        .all(entity.id)) {
        const value: unknown = JSON.parse(String(row.new_value));
        if (row.field === 'linked') {
          entity.linked = value as Entity['linked'];
          entity.status = value ? 'linked' : 'unlinked';
          entity.confidence = value ? 1 : 0;
        }
        if (row.field === 'type') entity.type = value as Entity['type'];
        if (row.field === 'hidden') entity.hidden = value === true;
      }
      return entity;
    });
  const report = (bookId: string): PipelineReport => {
    const all = entities(bookId);
    const reviewed = all.filter((x) => x.review !== null);
    const usage = db
      .prepare(
        'SELECT COALESCE(SUM(input_tokens),0) input,COALESCE(SUM(output_tokens),0) output,COALESCE(SUM(cache_tokens),0) cache,COALESCE(SUM(cost_usd),0) cost,COALESCE(SUM(elapsed_ms),0) elapsed FROM model_usage WHERE book_id=?',
      )
      .get(bookId)!;
    const linked = all.filter((x) => x.status === 'linked').length;
    return {
      extracted: all.length,
      linked,
      reviewed: reviewed.length,
      correct: reviewed.filter((x) => x.review).length,
      linkAccuracy: reviewed.length
        ? reviewed.filter((x) => x.review).length / reviewed.length
        : '待人工核对',
      recall: '缺少人工金标准',
      unlinkedRatio: all.length ? (all.length - linked) / all.length : 0,
      inputTokens: Number(usage.input),
      outputTokens: Number(usage.output),
      cacheTokens: Number(usage.cache),
      costUsd: Number(usage.cost),
      elapsedMs: Number(
        db
          .prepare(
            'SELECT COALESCE(SUM(elapsed_ms),0) elapsed FROM pipeline_runs WHERE book_id=?',
          )
          .get(bookId)!.elapsed,
      ),
    };
  };
  return {
    close: () => db.close(),
    transaction,
    putBook(book: BookRecord) {
      db.prepare(
        'INSERT INTO books(id,title,author,file_path,file_hash,imported_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,author=excluded.author,file_path=excluded.file_path',
      ).run(book.id, book.title, book.author, book.path, book.id, Date.now());
    },
    books(): BookRecord[] {
      return db
        .prepare('SELECT * FROM books ORDER BY imported_at DESC')
        .all()
        .map((row) => ({
          id: String(row.id),
          title: String(row.title),
          author: String(row.author),
          path: String(row.file_path),
        }));
    },
    putChapter(bookId: string, chapter: Chapter) {
      db.prepare(
        'INSERT INTO chapters VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,start_cfi=excluded.start_cfi,end_cfi=excluded.end_cfi,char_count=excluded.char_count,href=excluded.href,base_cfi=excluded.base_cfi,body_path=excluded.body_path,text=excluded.text,runs_json=excluded.runs_json,blocks_json=excluded.blocks_json',
      ).run(
        `${bookId}:${chapter.index}`,
        bookId,
        chapter.index,
        chapter.title,
        cfiAt(chapter, 0),
        cfiAt(chapter, chapter.text.length),
        chapter.text.length,
        chapter.href,
        chapter.baseCFI,
        chapter.bodyPath,
        chapter.text,
        JSON.stringify(chapter.runs),
        JSON.stringify(chapter.blocks ?? [chapter.text.length]),
      );
    },
    chapters(bookId: string): Chapter[] {
      return db
        .prepare('SELECT * FROM chapters WHERE book_id=? ORDER BY idx')
        .all(bookId)
        .map((row) => ({
          id: String(row.id),
          index: Number(row.idx),
          title: String(row.title),
          href: String(row.href),
          baseCFI: String(row.base_cfi),
          bodyPath: String(row.body_path),
          text: String(row.text),
          runs: JSON.parse(String(row.runs_json)) as Chapter['runs'],
          blocks: JSON.parse(String(row.blocks_json)) as number[],
        }));
    },
    putChunk(chapterId: string, index: number, entities: ExtractedEntity[]) {
      db.prepare('INSERT OR REPLACE INTO extraction_chunks VALUES (?,?,?)').run(
        chapterId,
        index,
        JSON.stringify(entities),
      );
    },
    chunks(chapterId: string): ExtractedEntity[][] {
      return db
        .prepare(
          'SELECT payload_json FROM extraction_chunks WHERE chapter_id=? ORDER BY idx',
        )
        .all(chapterId)
        .map(
          (row) => JSON.parse(String(row.payload_json)) as ExtractedEntity[],
        );
    },
    putEntity(entity: Entity) {
      const link = entity.linked;
      db.prepare(
        'INSERT INTO entities(id,book_id,type,name_zh,name_original,aliases_json,wikidata_qid,lat,lon,geo_shape,country,summary_ext,image_url,image_credit,link_status,link_confidence,importance,extraction_note,candidates_json,source_chapters_json,birth,death) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,name_zh=excluded.name_zh,name_original=excluded.name_original,aliases_json=excluded.aliases_json,wikidata_qid=excluded.wikidata_qid,lat=excluded.lat,lon=excluded.lon,country=excluded.country,summary_ext=excluded.summary_ext,image_url=excluded.image_url,link_status=excluded.link_status,link_confidence=excluded.link_confidence,importance=excluded.importance,extraction_note=excluded.extraction_note,candidates_json=excluded.candidates_json,source_chapters_json=excluded.source_chapters_json,birth=excluded.birth,death=excluded.death',
      ).run(
        entity.id,
        entity.bookId,
        entity.type,
        entity.name,
        entity.original,
        JSON.stringify(entity.aliases),
        link?.qid ?? null,
        link?.lat ?? null,
        link?.lon ?? null,
        null,
        link?.country ?? null,
        link?.description ?? null,
        link?.image ?? null,
        link?.image ? 'Wikidata' : null,
        entity.status,
        entity.confidence,
        entity.importance,
        entity.note,
        JSON.stringify(
          link &&
            !entity.candidates.some((candidate) => candidate.qid === link.qid)
            ? [...entity.candidates, link]
            : entity.candidates,
        ),
        JSON.stringify(entity.chapters),
        link?.birth ?? null,
        link?.death ?? null,
      );
    },
    entities,
    rawEntities,
    correct(
      entityId: string,
      field: 'linked' | 'type' | 'hidden',
      value: unknown,
    ) {
      const row = db
        .prepare('SELECT book_id FROM entities WHERE id=?')
        .get(entityId);
      if (!row) throw new Error('Unknown entity');
      const entity = entities(String(row.book_id)).find(
        (item) => item.id === entityId,
      );
      if (!entity) throw new Error('Entity has been merged');
      const oldValue =
        field === 'linked'
          ? (entity.linked ?? null)
          : field === 'hidden'
            ? !!entity.hidden
            : entity.type;
      db.prepare(
        'INSERT INTO corrections(entity_id,field,old_value,new_value,created_at) VALUES (?,?,?,?,?)',
      ).run(
        entityId,
        field,
        JSON.stringify(oldValue),
        JSON.stringify(value),
        Date.now(),
      );
    },
    coalesceSameQid(bookId: string) {
      transaction(() => {
        const groups = new Map<string, Entity[]>();
        for (const entity of rawEntities(bookId)) {
          if (!entity.linked) continue;
          const key = entity.type + ':' + entity.linked.qid;
          groups.set(key, [...(groups.get(key) ?? []), entity]);
        }
        for (const group of groups.values()) {
          if (
            group.length < 2 ||
            group.some(
              (entity) =>
                entity.review !== null ||
                db
                  .prepare(
                    'SELECT id FROM corrections WHERE entity_id=? LIMIT 1',
                  )
                  .get(entity.id) ||
                db
                  .prepare(
                    'SELECT entity_id FROM known WHERE entity_id=? LIMIT 1',
                  )
                  .get(entity.id),
            )
          )
            continue;
          const target = group[0];
          const aliases = [
            ...new Set(
              group.flatMap((entity) => [entity.name, ...entity.aliases]),
            ),
          ];
          const chapters = [
            ...new Set(group.flatMap((entity) => entity.chapters)),
          ];
          db.prepare(
            'UPDATE entities SET aliases_json=?,source_chapters_json=?,importance=? WHERE id=?',
          ).run(
            JSON.stringify(aliases),
            JSON.stringify(chapters),
            Math.max(...group.map((entity) => entity.importance)),
            target.id,
          );
          for (const source of group.slice(1))
            db.prepare('UPDATE entities SET canonical_id=? WHERE id=?').run(
              target.id,
              source.id,
            );
        }
      });
    },
    correctionCount() {
      return Number(
        db.prepare('SELECT COUNT(*) count FROM corrections').get()!.count,
      );
    },
    review(entityId: string, correct: boolean) {
      db.prepare('UPDATE entities SET review=? WHERE id=?').run(
        Number(correct),
        entityId,
      );
    },
    reviewRows(bookId: string): ReviewEntity[] {
      return entities(bookId)
        .filter((x) => x.chapters.some((c) => c < 2))
        .map((x) => ({
          id: x.id,
          bookId: x.bookId,
          type: x.type,
          name: x.name,
          original: x.original,
          aliases: x.aliases,
          importance: x.importance,
          chapters: x.chapters,
          candidates: x.candidates,
          linked: x.linked,
          confidence: x.confidence,
          status: x.status,
          review: x.review,
        }));
    },
    job(bookId: string, step: string, chapterId: string): Job | undefined {
      return db
        .prepare(
          'SELECT status,attempts,error FROM pipeline_jobs WHERE book_id=? AND step=? AND chapter_id=?',
        )
        .get(bookId, step, chapterId) as Job | undefined;
    },
    beginJob(bookId: string, step: string, chapterId: string) {
      db.prepare(
        "INSERT INTO pipeline_jobs VALUES (?,?,?,'running',1,NULL,?) ON CONFLICT(book_id,step,chapter_id) DO UPDATE SET status='running',attempts=attempts+1,error=NULL,updated_at=excluded.updated_at",
      ).run(bookId, step, chapterId, Date.now());
    },
    endJob(bookId: string, step: string, chapterId: string, error?: string) {
      db.prepare(
        'UPDATE pipeline_jobs SET status=?,error=?,updated_at=? WHERE book_id=? AND step=? AND chapter_id=?',
      ).run(
        error ? 'failed' : 'done',
        error ?? null,
        Date.now(),
        bookId,
        step,
        chapterId,
      );
    },
    jobs(bookId: string) {
      return db
        .prepare(
          'SELECT step,status,attempts FROM pipeline_jobs WHERE book_id=?',
        )
        .all(bookId) as Row[];
    },
    usage(bookId: string, step: string, usage: UsageRecord, elapsed: number) {
      db.prepare(
        'INSERT INTO model_usage(book_id,step,input_tokens,output_tokens,cache_tokens,cost_usd,elapsed_ms) VALUES (?,?,?,?,?,?,?)',
      ).run(
        bookId,
        step,
        usage.input,
        usage.output,
        usage.cacheRead,
        usage.cost.total,
        Math.round(elapsed),
      );
    },
    cacheGet(key: string): unknown {
      const row = db
        .prepare('SELECT response_json FROM wikidata_cache WHERE cache_key=?')
        .get(key);
      return row ? JSON.parse(String(row.response_json)) : undefined;
    },
    cachePut(key: string, value: unknown) {
      db.prepare('INSERT OR REPLACE INTO wikidata_cache VALUES (?,?,?)').run(
        key,
        JSON.stringify(value),
        Date.now(),
      );
    },
    timing(bookId: string, elapsed: number, succeeded: boolean) {
      db.prepare(
        'INSERT INTO pipeline_runs(book_id,elapsed_ms,succeeded) VALUES (?,?,?)',
      ).run(bookId, Math.round(elapsed), Number(succeeded));
    },
    progress(
      bookId: string,
    ): { current: string; boundary: string } | undefined {
      const row = db
        .prepare(
          'SELECT current_cfi,boundary_cfi FROM progress WHERE book_id=?',
        )
        .get(bookId);
      return row
        ? {
            current: String(row.current_cfi),
            boundary: String(row.boundary_cfi),
          }
        : undefined;
    },
    saveProgress(bookId: string, current: string, boundary: string) {
      db.prepare(
        'INSERT INTO progress VALUES (?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET current_cfi=excluded.current_cfi,boundary_cfi=excluded.boundary_cfi,updated_at=excluded.updated_at',
      ).run(bookId, current, boundary, Date.now());
    },

    replaceMentions(chapterId: string, mentions: Mention[]) {
      transaction(() => {
        db.prepare('DELETE FROM mentions WHERE chapter_id=?').run(chapterId);
        const insert = db.prepare(
          'INSERT INTO mentions VALUES (?,?,?,?,?,?,?,?)',
        );
        for (const mention of mentions)
          insert.run(
            mention.id,
            mention.entityId,
            chapterId,
            mention.cfiRange,
            mention.start,
            mention.end,
            Number(
              mentions.find((x) => x.entityId === mention.entityId)?.id ===
                mention.id,
            ),
            1,
          );
      });
    },
    mentions(
      bookId: string,
    ): Omit<Mention, 'surface' | 'startCFI' | 'endCFI'>[] {
      return db
        .prepare(
          'SELECT m.*,c.idx FROM mentions m JOIN chapters c ON c.id=m.chapter_id WHERE c.book_id=? ORDER BY c.idx,m.char_offset',
        )
        .all(bookId)
        .map((row) => ({
          id: String(row.id),
          entityId: String(row.entity_id),
          chapterId: String(row.chapter_id),
          chapter: Number(row.idx),
          start: Number(row.char_offset),
          end: Number(row.end_offset),
          cfiRange: String(row.cfi_range),
        }));
    },
    known(bookId: string): string[] {
      return db
        .prepare('SELECT entity_id FROM known WHERE book_id=?')
        .all(bookId)
        .map((row) => String(row.entity_id));
    },
    setKnown(bookId: string, entityId: string) {
      db.prepare('INSERT OR IGNORE INTO known VALUES (?,?)').run(
        bookId,
        entityId,
      );
    },
    gloss(entityId: string, chapterId: string): string | undefined {
      const row = db
        .prepare('SELECT text FROM glosses WHERE entity_id=? AND chapter_id=?')
        .get(entityId, chapterId);
      return row ? String(row.text) : undefined;
    },
    saveGloss(
      entityId: string,
      chapterId: string,
      text: string,
      model: string,
    ) {
      db.prepare(
        'INSERT INTO glosses VALUES (?,?,?,?,?,?) ON CONFLICT(entity_id,chapter_id) DO UPDATE SET text=excluded.text,model=excluded.model,created_at=excluded.created_at',
      ).run(
        entityId + ':' + chapterId,
        entityId,
        chapterId,
        text,
        model,
        Date.now(),
      );
    },
    conversation(bookId: string): {
      id: string;
      messages: ConversationMessage[];
    } {
      const row = db
        .prepare(
          'SELECT id,messages_json FROM conversations WHERE book_id=? AND archived=0',
        )
        .get(bookId);
      if (row)
        return {
          id: String(row.id),
          messages: JSON.parse(
            String(row.messages_json),
          ) as ConversationMessage[],
        };
      const id = randomUUID();
      db.prepare('INSERT INTO conversations VALUES (?,?,?,0,?)').run(
        id,
        bookId,
        '[]',
        Date.now(),
      );
      return { id, messages: [] };
    },
    saveConversation(
      bookId: string,
      id: string,
      messages: ConversationMessage[],
    ) {
      db.prepare(
        'UPDATE conversations SET messages_json=?,updated_at=? WHERE id=? AND book_id=? AND archived=0',
      ).run(JSON.stringify(messages), Date.now(), id, bookId);
    },
    conversations(bookId: string) {
      return db
        .prepare(
          'SELECT id,messages_json,archived FROM conversations WHERE book_id=? ORDER BY updated_at',
        )
        .all(bookId);
    },
    archiveConversations(bookId: string) {
      db.prepare(
        'UPDATE conversations SET archived=1 WHERE book_id=? AND archived=0',
      ).run(bookId);
    },
    report,
  };
}
export type Repository = ReturnType<typeof openRepository>;

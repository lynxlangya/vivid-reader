import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardData } from '../../shared/reading';
import type { WikiCandidate } from '../../shared/entity';
import type { MarkHit } from '../reader/marks';
import { Atlas } from '../map/Atlas';
import { cardLayout } from './layout';
const labels = {
  place: '地点',
  person: '人物',
  people: '族群',
  species: '物种',
  concept: '概念',
};
export function Card({
  hit,
  pinned,
  onClose,
  onEnter,
  onLeave,
  onKnown,
  onAsk,
}: {
  hit: MarkHit;
  pinned: boolean;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
  onKnown: () => void;
  onAsk: () => void;
}) {
  const [data, setData] = useState<CardData | null>(null),
    [fix, setFix] = useState(false),
    [query, setQuery] = useState(''),
    [candidates, setCandidates] = useState<WikiCandidate[]>([]),
    [message, setMessage] = useState('');
  const ref = useRef<HTMLElement>(null),
    [height, setHeight] = useState(520);
  useEffect(() => {
    let active = true;
    void window.vivid.card(hit.mark.id).then((card) => {
      if (!active) return;
      setData(card);
      setCandidates(card?.candidates ?? []);
      if (card?.gloss.status === 'loading')
        void window.vivid.gloss(hit.mark.id).then((result) => {
          if (active) setData(result);
        });
    });
    return () => {
      active = false;
    };
  }, [hit.mark.id]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) =>
      setHeight(entries[0].target.scrollHeight),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pinned) return;
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector('button')?.focus();
    return () => previous?.focus();
  }, [pinned]);
  const layout = cardLayout(
    hit.rect,
    hit.column,
    hit.viewportRight,
    window.innerHeight,
    height,
  );
  const correct = (action: 'link' | 'concept' | 'hide', qid?: string) =>
    void window.vivid
      .correct(hit.mark.id, action, qid)
      .then(() => {
        onKnown();
        onClose();
      })
      .catch(() => setMessage('纠错暂时未能保存'));
  return (
    <>
      {!layout.side &&
        hit.lines
          .filter(
            (line) =>
              line.bottom > layout.top &&
              line.top < layout.top + Math.min(height, layout.maxHeight),
          )
          .map((line, i) => (
            <div
              key={i}
              className="line-veil"
              style={{
                left: hit.column.left,
                top: line.top - 2,
                width: hit.column.right - hit.column.left,
                height: line.bottom - line.top + 4,
              }}
            />
          ))}
      {layout.side && (
        <svg
          className="leader"
          width={window.innerWidth}
          height={window.innerHeight}
          aria-hidden="true"
        >
          <circle
            cx={hit.column.right + 12}
            cy={(hit.rect.top + hit.rect.bottom) / 2}
            r="1.6"
          />
          <path
            d={`M${hit.column.right + 12},${(hit.rect.top + hit.rect.bottom) / 2}H${layout.left}`}
          />
        </svg>
      )}
      <aside
        ref={ref}
        role={pinned ? 'dialog' : 'tooltip'}
        aria-label="实体旁注"
        data-layout={layout.side ? 'margin' : 'fallback'}
        className="glimpse-card"
        style={
          {
            left: layout.left,
            top: layout.top,
            maxHeight: layout.maxHeight,
            '--entity-color': `var(--c-${hit.mark.type})`,
          } as React.CSSProperties
        }
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <div className="card-scroll">
          {data && (data.type === 'place' || data.type === 'people') && (
            <Atlas card={data} />
          )}
          <div className="entity-heading">
            <h2>{hit.mark.name}</h2>
            <span className="type-label">{labels[hit.mark.type]}</span>
          </div>
          <div className="entity-original">{data?.original}</div>
          {data?.type === 'person' && (
            <div className="timeline">
              <span>{data.fact?.birth?.slice(1, 5) ?? '生年未详'}</span>
              <i />
              <span>{data.fact?.death?.slice(1, 5) ?? '卒年未详'}</span>
            </div>
          )}
          <p className="entity-facts">
            {data?.fact?.country}
            {data?.fact?.lat !== undefined &&
              ` · ${Math.abs(data.fact.lat).toFixed(2)}°${data.fact.lat < 0 ? 'S' : 'N'} ${Math.abs(data.fact.lon!).toFixed(2)}°${data.fact.lon! < 0 ? 'W' : 'E'}`}
          </p>
          <p className="card-caption">在本书此处</p>
          {!data || data.gloss.status === 'loading' ? (
            <div className="skeleton" aria-label="释义加载中">
              <i />
              <i />
              <i />
            </div>
          ) : data.gloss.status === 'ready' ? (
            <p className="gloss">{data.gloss.text}</p>
          ) : (
            <p className="gloss">
              释义暂时生成不了 ·{' '}
              <button
                onClick={() => {
                  void window.vivid.gloss(hit.mark.id, true).then(setData);
                }}
              >
                重试
              </button>
            </p>
          )}
          {data && (
            <p className="footprint">
              第
              {new Intl.NumberFormat('zh-CN-u-nu-hanidec').format(
                data.footprint.firstChapter + 1,
              )}
              章初见 · 已见 {data.footprint.count} 次
            </p>
          )}
          {fix && (
            <section className="correction" aria-label="纠错">
              <label>
                中文 / 原文搜索
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button
                onClick={() =>
                  void window.vivid
                    .searchCandidates(hit.mark.id, query)
                    .then(setCandidates)
                    .catch(() => setMessage('搜索暂不可用'))
                }
              >
                搜索候选
              </button>
              {candidates.map((item) => (
                <button
                  key={item.qid}
                  onClick={() => correct('link', item.qid)}
                >
                  {item.label} · {item.description}
                </button>
              ))}
              <button onClick={() => correct('concept')}>
                这不是一个具体地方
              </button>
              <button onClick={() => correct('hide')}>以后别再标注它</button>
              <p role="status">{message}</p>
            </section>
          )}
        </div>
        <footer className="card-actions">
          <button onClick={onAsk}>问伴读</button>
          <span>·</span>
          <button
            onClick={() =>
              void window.vivid.markKnown(hit.mark.id).then(() => {
                onKnown();
                onClose();
              })
            }
          >
            标为已知
          </button>
          <span>·</span>
          <button onClick={() => setFix(!fix)}>纠错</button>
          {pinned && <button onClick={onClose}>关闭</button>}
        </footer>
      </aside>
    </>
  );
}

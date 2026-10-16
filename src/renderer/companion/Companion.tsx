import { useEffect, useRef, useState } from 'react';
import type { ReaderState } from '../../shared/reading';
import type {
  SelectionRange,
  CompanionUpdate,
  AskRequest,
} from '../../shared/companion';
export function Companion({
  state,
  selection,
  allowed,
  onJump,
  request,
}: {
  state: ReaderState | null;
  selection: SelectionRange | null;
  allowed: boolean;
  onJump: (cfi: string) => void;
  request?: { nonce: number; scope: 'selection' };
}) {
  const [value, setValue] = useState(''),
    [update, setUpdate] = useState<CompanionUpdate>({
      messages: [],
      busy: false,
    });
  const input = useRef<HTMLTextAreaElement>(null),
    bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true,
      received = false;
    const off = window.vivid.onCompanion((next) => {
      received = true;
      if (live) setUpdate(next);
    });
    void window.vivid.conversation().then((next) => {
      if (live && !received) setUpdate(next);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  const send = (scope?: AskRequest['scope']) => {
    if (update.busy || (!scope && !value.trim())) return;
    void window.vivid
      .ask({
        question: value,
        ...(scope ? { scope } : {}),
        ...(selection ? { selection } : {}),
      })
      .catch(() =>
        setUpdate((prev) => ({
          ...prev,
          busy: false,
          error: '这段在已读范围之后，或伴读暂不可用。',
        })),
      );
    setValue('');
  };
  const requestRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (request && request.nonce !== requestRef.current) {
      requestRef.current = request.nonce;
      void window.vivid
        .ask({
          question: '',
          scope: request.scope,
          ...(selection ? { selection } : {}),
        })
        .catch(() => {});
    }
  }, [request, selection]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [update]);
  const chapter = new Intl.NumberFormat('zh-CN-u-nu-hanidec').format(
    (state?.boundaryChapter ?? 0) + 1,
  );
  return (
    <aside className="companion" aria-label="伴读">
      <header>
        <h2>伴读</h2>
        <p className="boundary-label">
          已读至 第{chapter}章 ·{' '}
          {state?.toc[state.boundaryChapter]?.percent ?? 0}%
        </p>
        <p>伴读只知道朱线之前的内容</p>
      </header>
      <div className="dialogue" aria-live="polite" aria-busy={update.busy}>
        {update.messages.map((message, i) => (
          <div key={i} className={`dialogue-${message.role}`}>
            <p>
              {message.role === 'user' && <small>问 </small>}
              {message.text}
            </p>
            {message.citations?.map((citation) => (
              <button
                key={citation.cfi}
                className="citation"
                onClick={() => onJump(citation.cfi)}
              >
                见第
                {new Intl.NumberFormat('zh-CN-u-nu-hanidec').format(
                  citation.chapter + 1,
                )}
                章 ›
              </button>
            ))}
          </div>
        ))}
        {update.error && <p role="status">{update.error}</p>}
        <div ref={bottom} />
      </div>
      <footer className="companion-compose">
        <div className="summary-actions">
          <button
            disabled={!selection || !allowed || update.busy}
            title={
              selection && !allowed
                ? '这段在已读范围之后'
                : !selection
                  ? '请先选择一段正文'
                  : undefined
            }
            onClick={() => send('selection')}
          >
            总结选中
          </button>
          <span>·</span>
          <button disabled={update.busy} onClick={() => send('chapter')}>
            总结本章
          </button>
          <span>·</span>
          <button disabled={update.busy} onClick={() => send('to_boundary')}>
            总结至此
          </button>
        </div>
        <label>
          <span className="sr-only">伴读问题</span>
          <textarea
            ref={input}
            placeholder="问一个关于已读部分的问题"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
          />
        </label>
        <button disabled={update.busy || !value.trim()} onClick={() => send()}>
          发送 ⌘↩
        </button>
      </footer>
    </aside>
  );
}

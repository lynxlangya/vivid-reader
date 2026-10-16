import { useEffect, useRef, useState } from 'react';
import type { OpenBook } from '../shared/book';
import { Reader } from './reader/Reader';
import { Review } from './Review';
import type { MarkHit } from './reader/marks';
import type { ReaderState } from '../shared/reading';
import { Card } from './glimpse/Card';
export function App() {
  const [book, setBook] = useState<OpenBook | null>(null);
  const [readerState, setReaderState] = useState<ReaderState | null>(null);
  const [theme, setTheme] = useState('day');
  const [companion, setCompanion] = useState(false);
  const [settings, setSettings] = useState(false);
  const [review, setReview] = useState(false);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState('');
  const [hit, setHit] = useState<MarkHit | null>(null);
  const [pinned, setPinned] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pending = useRef<string | undefined>(undefined);
  const pinnedRef = useRef(false);
  function close() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    pending.current = undefined;
    pinnedRef.current = false;
    setPinned(false);
    setHit(null);
  }
  useEffect(() => {
    void window.vivid
      .restoreBook()
      .then(setBook)
      .catch(() => setStatus('上次的书暂时无法恢复'));
    void window.vivid.hasApiKey().then(setHasKey);
    const unsubscribe = window.vivid.onReaderState(setReaderState);
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearTimeout(openTimer.current);
        clearTimeout(closeTimer.current);
        pinnedRef.current = false;
        setPinned(false);
        setHit(null);
        setSettings(false);
      }
    };
    window.addEventListener('keydown', esc);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', esc);
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    };
  }, []);
  function hover(next: MarkHit | null) {
    if (pinnedRef.current) return;
    if (next) {
      clearTimeout(closeTimer.current);
      if (pending.current === next.mark.id) return;
      pending.current = next.mark.id;
      clearTimeout(openTimer.current);
      openTimer.current = setTimeout(() => setHit(next), 250);
    } else {
      pending.current = undefined;
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setHit(null), 200);
    }
  }
  return (
    <main className={`page ${companion ? 'with-companion' : ''}`}>
      <header className="app-actions">
        <button
          onClick={() => {
            close();
            void window.vivid
              .importBook()
              .then((result) => {
                if (result) setBook(result);
              })
              .catch(() => setStatus('导入未能完成，请检查 EPUB 文件'));
          }}
        >
          导入 EPUB
        </button>
        <button onClick={() => setSettings(!settings)}>设置</button>
        <button
          onClick={() => {
            const next = theme === 'day' ? 'night' : 'day';
            document.documentElement.classList.toggle(
              'night',
              next === 'night',
            );
            setTheme(next);
            close();
          }}
        >
          切换日夜
        </button>
        <button
          onClick={() => {
            setCompanion(!companion);
            close();
          }}
        >
          伴读
        </button>
        {import.meta.env.DEV && (
          <button onClick={() => setReview(true)}>开发核对</button>
        )}
      </header>
      {book ? (
        <Reader
          key={book.id}
          book={book}
          state={readerState}
          onState={setReaderState}
          theme={theme}
          onHover={hover}
          onClick={(next) => {
            close();
            pinnedRef.current = true;
            setPinned(true);
            setHit(next);
          }}
        />
      ) : (
        <>
          <aside className="spine">历历 · 试读</aside>
          <article className="col">
            <p className="ch-no">第一章</p>
            <h1 className="ch-title">土地与远行</h1>
            <p className="para">
              这并不是说某一群人天生更聪明。差别在于他们脚下的土地：有没有可以种的谷物，有没有肯被驯养的牲畜，大陆是东西走向还是南北走向。
            </p>
            <p className="para">这些问题，后面会一个一个讲到。</p>
          </article>
          <footer className="pager">— 1 / 1 —</footer>
        </>
      )}
      {status && (
        <p className="status" role="status">
          {status}
        </p>
      )}
      {review && import.meta.env.DEV && (
        <Review onClose={() => setReview(false)} />
      )}
      {settings && (
        <section className="settings" role="dialog" aria-label="模型设置">
          <h2>模型</h2>
          <label>
            DeepSeek Key
            <input
              type="password"
              value={key}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <p>保存在系统钥匙串中</p>
          <p>{hasKey ? '已配置' : '尚未配置'}</p>
          <button
            onClick={() => {
              void window.vivid
                .setApiKey(key)
                .then(() => {
                  setKey('');
                  setHasKey(true);
                })
                .catch(() => setStatus('系统密钥存储暂不可用'));
            }}
          >
            保存
          </button>
          <button
            onClick={() => {
              void window.vivid.clearApiKey().then(() => setHasKey(false));
            }}
          >
            清除
          </button>
          <button onClick={() => setSettings(false)}>关闭</button>
        </section>
      )}
      {readerState?.beyond && (
        <aside className="beyond">
          此处在已读范围之后 ·{' '}
          <button
            onClick={() =>
              void window.vivid
                .setBoundary(readerState.currentCFI)
                .then(setReaderState)
            }
          >
            设为已读至此
          </button>
        </aside>
      )}
      {companion && (
        <aside className="companion" aria-label="伴读">
          <h2>伴读</h2>
          <p className="boundary-label">
            已读至 第
            {new Intl.NumberFormat('zh-CN-u-nu-hanidec').format(
              (readerState?.boundaryChapter ?? 0) + 1,
            )}
            章
          </p>
          <p>伴读只知道朱线之前的内容</p>
        </aside>
      )}
      {hit && (
        <Card
          key={hit.mark.id}
          hit={hit}
          pinned={pinned}
          onClose={close}
          onEnter={() => clearTimeout(closeTimer.current)}
          onLeave={() => {
            if (!pinnedRef.current)
              closeTimer.current = setTimeout(() => setHit(null), 200);
          }}
          onKnown={() => void window.vivid.readerState().then(setReaderState)}
          onAsk={() => {
            setCompanion(true);
            close();
          }}
        />
      )}
      <div className="progress">
        <i
          className="read"
          style={{ width: `${(readerState?.boundaryFraction ?? 0) * 100}%` }}
        />
        <i
          className="cur"
          style={{ left: `${(readerState?.currentFraction ?? 0) * 100}%` }}
        />
        <i
          className="bound"
          style={{ left: `${(readerState?.boundaryFraction ?? 0) * 100}%` }}
        />
        <span
          className="bound-lab"
          style={{
            left: `${Math.max(4, (readerState?.boundaryFraction ?? 0) * 100)}%`,
          }}
        >
          已读至 第
          {new Intl.NumberFormat('zh-CN-u-nu-hanidec').format(
            (readerState?.boundaryChapter ?? 0) + 1,
          )}
          章
        </span>
      </div>
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { OpenBook } from '../shared/book';
import { Reader } from './reader/Reader';
import type { MarkHit } from './reader/marks';
export function App() {
  const [book, setBook] = useState<OpenBook | null>(null);
  const [settings, setSettings] = useState(false);
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
      window.removeEventListener('keydown', esc);
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    };
  }, []);
  function hover(next: MarkHit | null) {
    if (pinnedRef.current) return;
    if (next) {
      clearTimeout(closeTimer.current);
      if (pending.current === next.mark.name) return;
      pending.current = next.mark.name;
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
    <main className="page">
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
      </header>
      {book ? (
        <Reader
          key={book.id}
          book={book}
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
      {hit && (
        <aside
          role={pinned ? 'dialog' : 'tooltip'}
          aria-label="实体旁注"
          className="probe-card"
          style={{
            left: Math.min(hit.rect.left, window.innerWidth - 380),
            top:
              hit.rect.bottom + 200 > window.innerHeight
                ? Math.max(60, hit.rect.top - 190)
                : hit.rect.bottom + 10,
          }}
          onMouseEnter={() => clearTimeout(closeTimer.current)}
          onMouseLeave={() => {
            if (!pinnedRef.current)
              closeTimer.current = setTimeout(() => setHit(null), 200);
          }}
        >
          <h2>{hit.mark.name}</h2>
          <p>{hit.mark.type === 'place' ? '地点' : '人物'}</p>
          <p>试读专名旁注</p>
          {pinned && <button onClick={close}>关闭</button>}
        </aside>
      )}
      <div className="progress">
        <i className="read" />
        <i className="cur" />
        <i className="bound" />
        <span className="bound-lab">已读至 第一章</span>
      </div>
    </main>
  );
}

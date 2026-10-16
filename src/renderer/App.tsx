import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectionRange } from '../shared/companion';
import { defaultPreferences, type Preferences } from '../shared/settings';
import type { Box } from './glimpse/layout';
import { Companion } from './companion/Companion';
import type { OpenBook } from '../shared/book';
import { Reader } from './reader/Reader';
import { Review } from './Review';
import type { MarkHit } from './reader/marks';
import type { ReaderState } from '../shared/reading';
import { Card } from './glimpse/Card';
import { Library } from './shelf/Library';
import { Import } from './shelf/Import';
import { Settings } from './settings/Settings';
function apply(value: Preferences) {
  const root = document.documentElement;
  root.classList.toggle(
    'night',
    value.theme === 'night' ||
      (value.theme === 'system' &&
        matchMedia('(prefers-color-scheme: dark)').matches),
  );
  root.classList.toggle('voice-swap', value.font === 'kai');
}
export function App() {
  const [book, setBook] = useState<OpenBook | null>(null),
    [loaded, setLoaded] = useState(false),
    [screen, setScreen] = useState<'read' | 'library' | 'import'>('read'),
    [preferences, setPreferences] = useState<Preferences>(defaultPreferences),
    [readerState, setReaderState] = useState<ReaderState | null>(null),
    [selection, setSelection] = useState<
      (SelectionRange & { rect: Box }) | null
    >(null),
    [allowed, setAllowed] = useState(false),
    [jump, setJump] = useState<{ cfi: string; nonce: number }>(),
    [summaryRequest, setSummaryRequest] = useState<{
      nonce: number;
      scope: 'selection';
    }>(),
    [companion, setCompanion] = useState(false),
    [settings, setSettings] = useState(false),
    [review, setReview] = useState(false),
    [status, setStatus] = useState(''),
    [hit, setHit] = useState<MarkHit | null>(null),
    [pinned, setPinned] = useState(false);
  const requestNonce = useRef(0);
  const consumeSummary = useCallback((nonce: number) => {
    setSummaryRequest((request) =>
      request?.nonce === nonce ? undefined : request,
    );
  }, []);
  const consumeJump = useCallback((nonce: number) => {
    setJump((request) => (request?.nonce === nonce ? undefined : request));
  }, []);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pending = useRef<string | undefined>(undefined),
    pinnedRef = useRef(false);
  function close() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    pending.current = undefined;
    pinnedRef.current = false;
    setPinned(false);
    setHit(null);
  }
  useEffect(() => {
    let live = true;
    void Promise.all([window.vivid.preferences(), window.vivid.restoreBook()])
      .then(([prefs, book]) => {
        if (!live) return;
        apply(prefs);
        setPreferences(prefs);
        setBook(book);
        setScreen(book ? 'read' : 'library');
        setLoaded(true);
      })
      .catch(() => {
        setStatus('上次的书暂时无法恢复');
        setScreen('library');
        setLoaded(true);
      });
    const off = window.vivid.onReaderState(setReaderState);
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearTimeout(openTimer.current);
        clearTimeout(closeTimer.current);
        pending.current = undefined;
        pinnedRef.current = false;
        setPinned(false);
        setHit(null);
        setSettings(false);
        setSelection(null);
      }
    };
    window.addEventListener('keydown', esc);
    return () => {
      live = false;
      off();
      window.removeEventListener('keydown', esc);
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    };
  }, []);
  useEffect(() => {
    let live = true;
    if (selection)
      void window.vivid
        .selectionAllowed({ start: selection.start, end: selection.end })
        .then((value) => {
          if (live) setAllowed(value);
        });
    return () => {
      live = false;
    };
  }, [selection]);
  useEffect(() => {
    if (preferences.theme !== 'system') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => {
      apply(preferences);
      setPreferences({ ...preferences });
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [preferences]);
  function changePreferences(value: Preferences) {
    apply(value);
    setPreferences(value);
    close();
    void window.vivid
      .savePreferences(value)
      .catch(() => setStatus('设置暂时未能保存'));
  }
  function hover(next: MarkHit | null) {
    if (pinnedRef.current || preferences.focus) return;
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
  function imported() {
    if (!loaded) return;
    close();
    void window.vivid
      .importBook()
      .then((result) => {
        if (result) {
          setBook(result);
          setReaderState(null);
          setScreen('import');
        }
      })
      .catch(() => setStatus('导入未能完成，请检查 EPUB 文件'));
  }
  const reading = book && screen === 'read';
  return (
    <main
      className={`page ${companion && !preferences.focus ? 'with-companion' : ''} ${preferences.focus ? 'focus-mode' : ''} ${settings ? 'settings-open' : ''}`}
    >
      <header className="app-actions">
        <button
          onClick={() => {
            close();
            setSelection(null);
            setScreen(screen === 'library' && book ? 'read' : 'library');
          }}
        >
          {screen === 'library' && book ? '返回阅读' : '书架'}
        </button>
        <button disabled={!loaded} onClick={imported}>
          导入 EPUB
        </button>
        <button
          onClick={() => {
            close();
            setSettings(!settings);
          }}
        >
          设置
        </button>
        {reading && (
          <>
            <button
              onClick={() =>
                changePreferences({
                  ...preferences,
                  theme: document.documentElement.classList.contains('night')
                    ? 'day'
                    : 'night',
                })
              }
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
          </>
        )}
        {import.meta.env.DEV && (
          <button onClick={() => setReview(true)}>开发核对</button>
        )}
      </header>
      {!loaded ? (
        <p className="status">正在打开…</p>
      ) : reading ? (
        <Reader
          key={book.id}
          book={book}
          state={readerState}
          onState={setReaderState}
          onSelection={setSelection}
          preferences={preferences}
          jump={jump}
          onJumpHandled={consumeJump}
          onHover={hover}
          onClick={(next) => {
            close();
            pinnedRef.current = true;
            setPinned(true);
            setHit(next);
          }}
        />
      ) : book && screen === 'import' ? (
        <Import book={book} onRead={() => setScreen('read')} />
      ) : (
        <Library
          original={preferences.showOriginalCover}
          onOpen={(id) => {
            void window.vivid.openBook(id).then((result) => {
              setBook(result);
              setReaderState(null);
              setScreen('read');
            });
          }}
          onImport={imported}
        />
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
        <Settings
          value={preferences}
          onChange={changePreferences}
          state={readerState}
          onBoundary={setReaderState}
          onClose={() => setSettings(false)}
        />
      )}
      {reading && (
        <>
          {readerState?.beyond && !preferences.focus && (
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
          {companion && !preferences.focus && (
            <Companion
              state={readerState}
              selection={selection}
              allowed={allowed}
              onJump={(cfi) => {
                close();
                setJump({ cfi, nonce: ++requestNonce.current });
              }}
              request={summaryRequest}
              onRequestConsumed={consumeSummary}
            />
          )}
          {selection && !settings && (
            <div
              role="toolbar"
              aria-label="正文选区"
              className="selection-toolbar"
              style={{
                left: Math.max(
                  16,
                  Math.min(selection.rect.left, window.innerWidth - 200),
                ),
                top: Math.max(60, selection.rect.top - 42),
              }}
            >
              <button
                onClick={() => {
                  setCompanion(true);
                  close();
                }}
              >
                问伴读
              </button>
              <button
                disabled={!allowed}
                title={!allowed ? '这段在已读范围之后' : undefined}
                onClick={() => {
                  setCompanion(true);
                  setSummaryRequest({
                    nonce: ++requestNonce.current,
                    scope: 'selection',
                  });
                  close();
                }}
              >
                总结
              </button>
            </div>
          )}
          {hit && !preferences.focus && (
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
              onKnown={() =>
                void window.vivid.readerState().then(setReaderState)
              }
              onAsk={() => {
                setCompanion(true);
                close();
              }}
            />
          )}
          <div className="progress">
            <i
              className="read"
              style={{
                width: `${(readerState?.boundaryFraction ?? 0) * 100}%`,
              }}
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
        </>
      )}
    </main>
  );
}

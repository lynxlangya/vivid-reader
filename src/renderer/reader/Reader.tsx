import type { Preferences } from '../../shared/settings';
import type { SelectionRange } from '../../shared/companion';
import type { Box } from '../glimpse/layout';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OpenBook } from '../../shared/book';
import type { ReaderState, Navigation } from '../../shared/reading';
import { makeView, type FoliateView, type ReadingLocation } from './engine';
import { injectMarks, markGeometry, type MarkHit } from './marks';
// Moves a still-loading view offscreen without reloading its iframe, so foliate
// can finish laying it out and be closed normally afterwards.
function park(view: HTMLElement) {
  const { width, height } = view.getBoundingClientRect();
  const holder = document.createElement('div');
  holder.dataset.parked = '';
  holder.inert = true;
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = `position:fixed;top:0;left:${-width - 100}px;width:${width}px;height:${height}px;visibility:hidden;pointer-events:none;overflow:hidden`;
  document.body.append(holder);
  holder.moveBefore(view, null);
}
interface Props {
  book: OpenBook;
  state: ReaderState | null;
  onState: (state: ReaderState) => void;
  onSelection: (selection: (SelectionRange & { rect: Box }) | null) => void;
  preferences: Preferences;
  jump?: { cfi: string; nonce: number };
  onJumpHandled: (nonce: number) => void;
  onHover: (hit: MarkHit | null) => void;
  onClick: (hit: MarkHit) => void;
}
export function Reader({
  book,
  onHover,
  onClick,
  state,
  onState,
  onSelection,
  preferences,
  jump,
  onJumpHandled,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const loader = useRef<{ view: FoliateView; loading: boolean } | null>(null);
  const [toc, setToc] = useState(false);
  const [markMode, setMarkMode] = useState(false);
  const markNav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (markMode)
      requestAnimationFrame(() =>
        markNav.current?.querySelector('button')?.focus(),
      );
  }, [markMode]);
  const [items, setItems] = useState<{ label: string; href: string }[]>([]);
  const [location, setLocation] = useState<ReadingLocation>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState({ current: 1, total: 1 });
  const mode = useRef<Navigation>('jump');
  const prefs = useRef(preferences);
  useEffect(() => {
    prefs.current = preferences;
  }, [preferences]);
  const cleanup = useRef(new Map<Document, () => void>());
  const currentMarks = useRef(book.marks);
  const handlers = useRef({ onHover, onClick, onState, onSelection });
  function navigate(direction: 'next' | 'prev') {
    mode.current = direction;
    void viewRef.current?.[direction]();
  }
  useEffect(() => {
    if (!state || !viewRef.current) return;
    currentMarks.current = state.marks;
    for (const { doc, index } of viewRef.current.renderer.getContents()) {
      cleanup.current.get(doc)?.();
      cleanup.current.set(
        doc,
        injectMarks(viewRef.current, doc, index, state.marks, onHover, onClick),
      );
    }
  }, [state, onHover, onClick]);
  useEffect(() => {
    if (jump && viewRef.current) {
      mode.current = 'jump';
      void viewRef.current.goTo(jump.cfi).then(() => onJumpHandled(jump.nonce));
    }
  }, [jump, onJumpHandled]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer) return;
    const root = getComputedStyle(document.documentElement);
    view.renderer.setStyles(
      `html,body{background:${root.getPropertyValue('--paper')};color:${root.getPropertyValue('--ink')};font-family:${root.getPropertyValue('--voice-book')};font-size:${prefs.current.fontSize}px;line-height:${prefs.current.lineHeight}}body{margin:0}p{text-indent:2em;text-align:justify;margin:0 0 .6em;text-spacing-trim:normal;text-autospace:normal}h1{font-size:32px;line-height:1.35;margin:0 0 36px;font-weight:600}a{color:inherit}`,
    );
  }, [preferences]);
  useEffect(() => {
    handlers.current = { onHover, onClick, onState, onSelection };
  }, [onHover, onClick, onState, onSelection]);
  useEffect(() => {
    const markCleanup = cleanup.current;
    const view = makeView();
    viewRef.current = view;
    host.current!.append(view);
    let disposed = false;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Alt' && !prefs.current.focus) {
        event.preventDefault();
        setMarkMode(true);
        return;
      }
      if (event.key === 'Escape') {
        setMarkMode(false);
        return;
      }

      if (
        (event.target as Element)?.closest?.(
          'input,textarea,select,button,[role=dialog]',
        )
      )
        return;
      if (['ArrowRight', ' '].includes(event.key)) {
        event.preventDefault();
        mode.current = 'next';
        void view.next();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        mode.current = 'prev';
        void view.prev();
      }
    };
    view.addEventListener('load', (event) => {
      const { doc, index } = (
        event as CustomEvent<{ doc: Document; index: number }>
      ).detail;
      doc.addEventListener('keydown', key);
      doc.addEventListener('mouseup', () => {
        const selected = doc.getSelection();
        if (!selected || selected.isCollapsed || !selected.rangeCount) {
          handlers.current.onSelection(null);
          return;
        }
        const range = selected.getRangeAt(0),
          r = range.getBoundingClientRect(),
          f = doc.defaultView!.frameElement!.getBoundingClientRect();
        const a = range.cloneRange(),
          b = range.cloneRange();
        a.collapse(true);
        b.collapse(false);
        handlers.current.onSelection({
          start: view.getCFI(index, a),
          end: view.getCFI(index, b),
          rect: {
            left: r.left + f.left,
            right: r.right + f.left,
            top: r.top + f.top,
            bottom: r.bottom + f.top,
          },
        });
      });
      cleanup.current.get(doc)?.();
      cleanup.current.set(
        doc,
        injectMarks(
          view,
          doc,
          index,
          currentMarks.current,
          (hit) => handlers.current.onHover(hit),
          (hit) => handlers.current.onClick(hit),
        ),
      );
    });
    view.addEventListener('relocate', (event) => {
      if (disposed) return;
      const next = (event as CustomEvent<ReadingLocation>).detail;
      handlers.current.onSelection(null);
      setMarkMode(false);
      setLocation(next);
      setPages({
        current: Math.max(1, view.renderer.page),
        total: Math.max(1, view.renderer.pages - 2),
      });
      const navigation = mode.current;
      mode.current = 'jump';
      void window.vivid
        .relocate(next.cfi, navigation)
        .then((next) => {
          if (!disposed) handlers.current.onState(next);
        })
        .catch(() => setError('位置暂时未能保存'));
    });
    const pause = () => {
      void window.vivid.pauseReading(book.id).catch(() => {});
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', key);
    // foliate cannot close while open/init runs: its paginator has no inner
    // view until a section shows, and pending work still reads it. The loader
    // releases the view itself if the reader unmounted meanwhile.
    const load = { view, loading: true };
    loader.current = load;
    const release = () => {
      const parent = view.parentElement;
      if (view.renderer?.getContents().length) view.close();
      view.remove();
      if (parent?.dataset.parked !== undefined) parent.remove();
    };
    void (async () => {
      try {
        await view.open(book.url);
        if (disposed) return;
        view.renderer.setAttribute('gap', '4%');
        view.renderer.setAttribute('margin', '0');
        view.renderer.setAttribute('max-column-count', '1');
        view.renderer.setAttribute('max-inline-size', '680px');
        const root = getComputedStyle(document.documentElement);
        view.renderer.setStyles(
          `html,body{background:${root.getPropertyValue('--paper')};color:${root.getPropertyValue('--ink')};font-family:${root.getPropertyValue('--voice-book')};font-size:${prefs.current.fontSize}px;line-height:${prefs.current.lineHeight}}body{margin:0}p{text-indent:2em;text-align:justify;margin:0 0 .6em;text-spacing-trim:normal;text-autospace:normal}h1{font-size:32px;line-height:1.35;margin:0 0 36px;font-weight:600}a{color:inherit}`,
        );
        setItems(view.book.toc);
        const saved = await window.vivid.readerState();
        if (disposed) return;
        await view.init({ lastLocation: saved?.currentCFI ?? book.currentCFI });
        await view.renderer.getContents()[0].doc.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (!disposed) setReady(true);
      } catch {
        if (!disposed) setError('这本 EPUB 暂时无法打开');
      } finally {
        load.loading = false;
        if (disposed) release();
      }
    })();
    return () => {
      disposed = true;
      pause();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', key);
      markCleanup.forEach((fn) => fn());
      markCleanup.clear();
      if (!load.loading) release();
    };
  }, [book]);
  // Layout cleanup runs before React detaches the host; a detached iframe
  // would lose its document while foliate is still loading it.
  useLayoutEffect(
    () => () => {
      if (loader.current?.loading) park(loader.current.view);
    },
    [book],
  );
  return (
    <>
      <nav className="reader-actions">
        <button onClick={() => setToc(!toc)}>目录</button>
        <button onClick={() => navigate('prev')} aria-label="上一页">
          ←
        </button>
        <button onClick={() => navigate('next')} aria-label="下一页">
          →
        </button>
      </nav>
      {toc && (
        <aside className="toc" aria-label="目录">
          {items.map((item, index) => (
            <div key={item.href}>
              {index === (state?.boundaryChapter ?? -1) + 1 && (
                <p className="unread-divider">以下未读</p>
              )}
              <button
                key={item.href}
                onClick={() => {
                  mode.current = 'jump';
                  void viewRef.current?.goTo(item.href);
                  setToc(false);
                }}
              >
                <span>{item.label}</span>
                <i />
                {state?.toc[index]?.percent !== undefined && (
                  <small>{state.toc[index].percent}%</small>
                )}
              </button>
            </div>
          ))}
        </aside>
      )}
      {markMode && (
        <nav
          ref={markNav}
          className="annotation-nav"
          aria-label="标注导航"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setMarkMode(false);
              event.stopPropagation();
            }
            if (event.key === 'Tab') {
              const list = Array.from(
                markNav.current!.querySelectorAll('button'),
              );
              const index = list.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              event.preventDefault();
              list[
                (index + (event.shiftKey ? -1 : 1) + list.length) % list.length
              ]?.focus();
            }
          }}
        >
          <span>Tab 选择 · ↩ 打开 · Esc 退出</span>
          {state?.marks.map((mark) => (
            <button
              key={mark.id}
              onClick={() => {
                const view = viewRef.current;
                if (!view) return;
                const hit = markGeometry(view, mark);
                if (hit) handlers.current.onClick(hit);
              }}
            >
              {mark.name}
            </button>
          ))}
          {!state?.marks.length && <span>本页没有标注</span>}
        </nav>
      )}
      <aside className="spine">{book.title}</aside>
      <div className="reader-host" aria-busy={!ready} ref={host} />
      <footer className="pager" data-cfi={location?.cfi}>
        {error || `— ${pages.current} / ${pages.total} —`}
      </footer>
    </>
  );
}

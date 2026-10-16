import type { SelectionRange } from '../../shared/companion';
import type { Box } from '../glimpse/layout';
import { useEffect, useRef, useState } from 'react';
import type { OpenBook } from '../../shared/book';
import type { ReaderState, Navigation } from '../../shared/reading';
import { makeView, type FoliateView, type ReadingLocation } from './engine';
import { injectMarks, type MarkHit } from './marks';
interface Props {
  book: OpenBook;
  state: ReaderState | null;
  onState: (state: ReaderState) => void;
  onSelection: (selection: (SelectionRange & { rect: Box }) | null) => void;
  theme: string;
  jump?: string;
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
  theme,
  jump,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const [toc, setToc] = useState(false);
  const [items, setItems] = useState<{ label: string; href: string }[]>([]);
  const [location, setLocation] = useState<ReadingLocation>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState({ current: 1, total: 1 });
  const mode = useRef<Navigation>('jump');
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
      void viewRef.current.goTo(jump);
    }
  }, [jump]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer) return;
    const root = getComputedStyle(document.documentElement);
    view.renderer.setStyles(
      `html,body{background:${root.getPropertyValue('--paper')};color:${root.getPropertyValue('--ink')};font-family:${root.getPropertyValue('--voice-book')};font-size:19px;line-height:1.85}body{margin:0}p{text-indent:2em;text-align:justify;margin:0 0 .6em;text-spacing-trim:normal;text-autospace:normal}h1{font-size:32px;line-height:1.35;margin:0 0 36px;font-weight:600}a{color:inherit}`,
    );
  }, [theme]);
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
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
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
      const next = (event as CustomEvent<ReadingLocation>).detail;
      handlers.current.onSelection(null);
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
    window.addEventListener('keydown', key);
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
          `html,body{background:${root.getPropertyValue('--paper')};color:${root.getPropertyValue('--ink')};font-family:${root.getPropertyValue('--voice-book')};font-size:19px;line-height:1.85}body{margin:0}p{text-indent:2em;text-align:justify;margin:0 0 .6em;text-spacing-trim:normal;text-autospace:normal}h1{font-size:32px;line-height:1.35;margin:0 0 36px;font-weight:600}a{color:inherit}`,
        );
        setItems(view.book.toc);
        await view.init({ lastLocation: book.currentCFI });
        await view.renderer.getContents()[0].doc.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (!disposed) setReady(true);
      } catch {
        setError('这本 EPUB 暂时无法打开');
      }
    })();
    return () => {
      disposed = true;
      window.removeEventListener('keydown', key);
      markCleanup.forEach((fn) => fn());
      markCleanup.clear();
      if (view.renderer) view.close();
      view.remove();
    };
  }, [book]);
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
      <aside className="spine">{book.title}</aside>
      <div className="reader-host" aria-busy={!ready} ref={host} />
      <footer className="pager" data-cfi={location?.cfi}>
        {error || `— ${pages.current} / ${pages.total} —`}
      </footer>
    </>
  );
}

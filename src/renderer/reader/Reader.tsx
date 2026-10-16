import { useEffect, useRef, useState } from 'react';
import type { OpenBook } from '../../shared/book';
import { makeView, type FoliateView, type ReadingLocation } from './engine';
import { injectMarks, type MarkHit } from './marks';
interface Props {
  book: OpenBook;
  onHover: (hit: MarkHit | null) => void;
  onClick: (hit: MarkHit) => void;
}
export function Reader({ book, onHover, onClick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const [toc, setToc] = useState(false);
  const [items, setItems] = useState<{ label: string; href: string }[]>([]);
  const [location, setLocation] = useState<ReadingLocation>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState({ current: 1, total: 1 });
  const handlers = useRef({ onHover, onClick });
  useEffect(() => {
    handlers.current = { onHover, onClick };
  }, [onHover, onClick]);
  useEffect(() => {
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
        void view.next();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void view.prev();
      }
    };
    view.addEventListener('load', (event) => {
      const { doc, index } = (
        event as CustomEvent<{ doc: Document; index: number }>
      ).detail;
      doc.addEventListener('keydown', key);
      injectMarks(
        view,
        doc,
        index,
        book.marks,
        (hit) => handlers.current.onHover(hit),
        (hit) => handlers.current.onClick(hit),
      );
    });
    view.addEventListener('relocate', (event) => {
      const next = (event as CustomEvent<ReadingLocation>).detail;
      setLocation(next);
      setPages({
        current: Math.max(1, view.renderer.page),
        total: Math.max(1, view.renderer.pages - 2),
      });
      void window.vivid
        .savePosition(next.cfi)
        .catch(() => setError('位置暂时未能保存'));
    });
    window.addEventListener('keydown', key);
    void (async () => {
      try {
        await view.open(
          new File([new Uint8Array(book.bytes).buffer], 'book.epub', {
            type: 'application/epub+zip',
          }),
        );
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
      if (view.renderer) view.close();
      view.remove();
    };
  }, [book]);
  return (
    <>
      <nav className="reader-actions">
        <button onClick={() => setToc(!toc)}>目录</button>
        <button
          onClick={() => void viewRef.current?.prev()}
          aria-label="上一页"
        >
          ←
        </button>
        <button
          onClick={() => void viewRef.current?.next()}
          aria-label="下一页"
        >
          →
        </button>
      </nav>
      {toc && (
        <aside className="toc" aria-label="目录">
          {items.map((item) => (
            <button
              key={item.href}
              onClick={() => {
                void viewRef.current?.goTo(item.href);
                setToc(false);
              }}
            >
              {item.label}
            </button>
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

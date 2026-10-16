import type { ProbeMark } from '../../shared/book';
import type { FoliateView } from './engine';
import type { Box } from '../glimpse/layout';
export interface MarkHit {
  mark: ProbeMark;
  rect: Box;
  column: Box;
  viewportRight: number;
  lines: Box[];
}
export function injectMarks(
  view: FoliateView,
  doc: Document,
  index: number,
  marks: ProbeMark[],
  onHover: (hit: MarkHit | null) => void,
  onClick: (hit: MarkHit) => void,
) {
  const scoped = marks
    .filter((m) => m.chapter === index)
    .map((mark) => {
      const range = view.resolveCFI(mark.startCFI).anchor(doc);
      const end = view.resolveCFI(mark.endCFI).anchor(doc);
      range.setEnd(end.startContainer, end.startOffset);
      return { mark, range };
    });
  const frameWindow = doc.defaultView as unknown as { CSS: typeof CSS };
  const types = ['place', 'person', 'people', 'species', 'concept'] as const;
  const root = getComputedStyle(document.documentElement);
  const style = doc.createElement('style');
  style.textContent = types
    .map((type) => {
      for (const prefix of ['m', 'c'])
        doc.documentElement.style.setProperty(
          `--${prefix}-${type}`,
          root.getPropertyValue(`--${prefix}-${type}`),
        );
      frameWindow.CSS.highlights.set(
        `vivid-${type}`,
        new Highlight(
          ...scoped
            .filter((x) => x.mark.type === type && !x.mark.seenBefore)
            .map((x) => x.range),
        ),
      );
      frameWindow.CSS.highlights.set(
        `vivid-seen-${type}`,
        new Highlight(
          ...scoped
            .filter((x) => x.mark.type === type && x.mark.seenBefore)
            .map((x) => x.range),
        ),
      );
      return `::highlight(vivid-${type}){text-decoration:underline solid var(--m-${type}) 1px;text-underline-offset:5px;text-decoration-skip-ink:none}::highlight(vivid-seen-${type}){text-decoration:underline solid color-mix(in srgb,var(--c-${type}) 25%,${root.getPropertyValue('--paper')}) 1px;text-underline-offset:5px;text-decoration-skip-ink:none}::highlight(vivid-hover-${type}){text-decoration:underline solid var(--c-${type}) 1.5px;text-underline-offset:5px;text-decoration-skip-ink:none}`;
    })
    .join('');
  doc.head.append(style);
  const hitTest = (event: MouseEvent) => {
    const caret = doc.caretPositionFromPoint(event.clientX, event.clientY);
    const contains = (rect: DOMRect) =>
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    const rectangles = (range: Range) => Array.from(range.getClientRects());
    const target =
      scoped.find(
        (item) =>
          caret &&
          item.range.isPointInRange(caret.offsetNode, caret.offset) &&
          rectangles(item.range).some(contains),
      ) ?? scoped.find((item) => rectangles(item.range).some(contains));
    if (!target) return null;
    const rect = rectangles(target.range).find(contains)!;
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
    if (!frame) return null;
    const column = document
      .querySelector('.reader-host')!
      .getBoundingClientRect();
    const viewportRight =
      document.querySelector('.companion')?.getBoundingClientRect().left ??
      window.innerWidth;
    const lines: Box[] = [];
    for (const paragraph of doc.querySelectorAll('p,h1,h2,h3,li')) {
      const content = doc.createRange();
      content.selectNodeContents(paragraph);
      for (const r of content.getClientRects()) {
        const box = {
          left: column.left,
          right: column.right,
          top: r.top + frame.top,
          bottom: r.bottom + frame.top,
        };
        if (box.bottom < 0 || box.top > window.innerHeight) continue;
        const same = lines.find((x) => Math.abs(x.top - box.top) < 3);
        if (same) same.bottom = Math.max(same.bottom, box.bottom);
        else lines.push(box);
      }
    }
    return {
      mark: target.mark,
      column: {
        left: column.left,
        right: column.right,
        top: column.top,
        bottom: column.bottom,
      },
      viewportRight,
      lines,
      rect: {
        left: rect.left + frame.left,
        right: rect.right + frame.left,
        top: rect.top + frame.top,
        bottom: rect.bottom + frame.top,
      },
    };
  };
  const move = (event: MouseEvent) => {
    const hit = hitTest(event);
    types.forEach((type) =>
      frameWindow.CSS.highlights.delete(`vivid-hover-${type}`),
    );
    if (hit) {
      const found = scoped.find((x) => x.mark === hit.mark)!;
      frameWindow.CSS.highlights.set(
        `vivid-hover-${hit.mark.type}`,
        new Highlight(found.range),
      );
    }
    onHover(hit);
  };
  const leave = () => onHover(null);
  const click = (event: MouseEvent) => {
    const hit = hitTest(event);
    if (hit) onClick(hit);
  };
  doc.addEventListener('mousemove', move);
  doc.addEventListener('mouseleave', leave);
  doc.addEventListener('click', click);
  return () => {
    doc.removeEventListener('mousemove', move);
    doc.removeEventListener('mouseleave', leave);
    doc.removeEventListener('click', click);
    style.remove();
    for (const type of types)
      for (const prefix of ['vivid-', 'vivid-seen-', 'vivid-hover-'])
        frameWindow.CSS.highlights.delete(prefix + type);
  };
}

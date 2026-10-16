import type { ProbeMark } from '../../shared/book';
import type { FoliateView } from './engine';
export interface MarkHit {
  mark: ProbeMark;
  rect: { left: number; right: number; top: number; bottom: number };
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
  for (const type of ['place', 'person'] as const)
    frameWindow.CSS.highlights.set(
      `vivid-${type}`,
      new Highlight(
        ...scoped.filter((x) => x.mark.type === type).map((x) => x.range),
      ),
    );
  const style = doc.createElement('style');
  style.textContent = `::highlight(vivid-place){text-decoration:underline solid #88A8AC 1px;text-underline-offset:5px;text-decoration-skip-ink:none}::highlight(vivid-person){text-decoration:underline solid #BD9C85 1px;text-underline-offset:5px;text-decoration-skip-ink:none}::highlight(vivid-hover-place){text-decoration:underline solid #2E6B78 1.5px;text-underline-offset:5px;text-decoration-skip-ink:none}::highlight(vivid-hover-person){text-decoration:underline solid #8F5530 1.5px;text-underline-offset:5px;text-decoration-skip-ink:none}`;
  doc.head.append(style);
  const hitTest = (event: MouseEvent) => {
    const caret = doc.caretPositionFromPoint(event.clientX, event.clientY);
    if (!caret) return null;
    const target = scoped.find((x) =>
      x.range.isPointInRange(caret.offsetNode, caret.offset),
    );
    if (!target) return null;
    const rect = Array.from(target.range.getClientRects()).find(
      (r) =>
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom,
    );
    if (!rect) return null;
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
    if (!frame) return null;
    return {
      mark: target.mark,
      rect: {
        left: rect.left + frame.left,
        right: rect.right + frame.left,
        top: rect.top + frame.top,
        bottom: rect.bottom + frame.top,
      },
    };
  };
  doc.addEventListener('mousemove', (event) => {
    const hit = hitTest(event);
    frameWindow.CSS.highlights.delete('vivid-hover-place');
    frameWindow.CSS.highlights.delete('vivid-hover-person');
    if (hit) {
      const found = scoped.find((x) => x.mark === hit.mark)!;
      frameWindow.CSS.highlights.set(
        `vivid-hover-${hit.mark.type}`,
        new Highlight(found.range),
      );
    }
    onHover(hit);
  });
  doc.addEventListener('mouseleave', () => onHover(null));
  doc.addEventListener('click', (event) => {
    const hit = hitTest(event);
    if (hit) onClick(hit);
  });
}

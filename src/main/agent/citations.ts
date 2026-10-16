import type { Citation } from '../../shared/companion';
import type { ContentGateway } from '../content/gateway';
import { compareCFI } from '../../shared/cfi';
export function validateAnswer(raw: string, gateway: ContentGateway) {
  const citations: Citation[] = [];
  let text = raw.replace(
    /\[\[cite:(epubcfi\([^\n]*?\))\]\]/g,
    (_whole, cfi: string) => {
      try {
        const point = gateway.position(cfi);
        if (
          compareCFI(
            gateway.position(cfi, true).cfi,
            gateway.context().boundaryCFI,
          ) <= 0 &&
          !citations.some((x) => x.cfi === point.cfi)
        )
          citations.push({ cfi: point.cfi, chapter: point.chapter });
      } catch {
        /* Ignore invalid citations. */
      }
      return '';
    },
  );
  // Incomplete citation tokens stay buffered until a later stream update.
  const open = text.indexOf('[[cite:');
  if (open >= 0) text = text.slice(0, open);
  text = text.replace(/epubcfi\([^\n]*?\)/g, '');
  const pending = text.indexOf('epubcfi(');
  if (pending >= 0) text = text.slice(0, pending);
  return { text: text.trim(), citations };
}

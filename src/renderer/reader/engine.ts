import '../vendor/foliate-js/view.js';
export interface ReadingLocation {
  cfi: string;
  fraction?: number;
  section?: { current: number; total: number };
  range: Range;
  tocItem?: { label: string };
  location?: { current: number; total: number };
}
export interface FoliateView extends HTMLElement {
  book: {
    toc: {
      label: string;
      href: string;
      subitems?: { label: string; href: string }[];
    }[];
    sections: {
      id: string;
      cfi: string;
      createDocument(): Promise<Document>;
    }[];
  };
  renderer: {
    setAttribute(name: string, value: string): void;
    setStyles(styles: string): void;
    getContents(): { doc: Document; index: number }[];
    page: number;
    pages: number;
  };
  lastLocation?: ReadingLocation;
  open(file: File | string): Promise<void>;
  init(options: { lastLocation?: string }): Promise<void>;
  close(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: string | number): Promise<void>;
  getCFI(index: number, range: Range): string;
  resolveCFI(cfi: string): { index: number; anchor(doc: Document): Range };
}
export function makeView() {
  return document.createElement('foliate-view') as FoliateView;
}

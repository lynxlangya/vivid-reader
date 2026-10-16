import { useEffect, useState } from 'react';
import type { LibraryBook } from '../../shared/settings';
export const papers = [
  '#D9D2C3',
  '#C9C3B3',
  '#B9A88F',
  '#A9B4AE',
  '#B7A49A',
  '#3F4A4C',
];
export function paperColor(title: string) {
  let hash = 0;
  for (const char of title)
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return papers[(hash >>> 0) % papers.length];
}
export function Cover({
  book,
  original = false,
}: {
  book: Pick<LibraryBook, 'id' | 'title' | 'author'>;
  original?: boolean;
}) {
  const [url, setURL] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (original)
      void window.vivid.originalCover(book.id).then((url) => {
        if (active) setURL(url);
      });
    return () => {
      active = false;
    };
  }, [book.id, original]);
  return (
    <div
      className="book-cover"
      style={{ background: paperColor(book.title) }}
      role="img"
      aria-label={`${book.title}${original && url ? '原书封面' : '题签封面'}`}
    >
      {original && url ? (
        <img src={url} alt={`${book.title}原书封面`} />
      ) : (
        <>
          <span className="book-slip">{book.title}</span>
          <span
            className="book-author"
            style={{
              color:
                paperColor(book.title) === papers[5] ? '#E8E3D8' : '#4A4640',
            }}
          >
            {book.author}
          </span>
        </>
      )}
    </div>
  );
}
export function Library({
  original,
  onOpen,
  onImport,
}: {
  original: boolean;
  onOpen: (id: string) => void;
  onImport: () => void;
}) {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  useEffect(() => {
    void window.vivid.library().then(setBooks);
  }, []);
  return (
    <section className="library">
      <header>
        <h1>书架</h1>
        <span>
          {books.length} 本 <button onClick={onImport}>导入书籍…</button>
        </span>
      </header>
      <div className="shelf">
        {books.map((book) => (
          <article key={book.id}>
            <button className="book-open" onClick={() => onOpen(book.id)}>
              <Cover book={book} original={original} />
              <h2>{book.title}</h2>
              <p>{book.author}</p>
            </button>
            <div className="shelf-progress">
              <i style={{ width: book.boundaryFraction * 100 + '%' }} />
              <b style={{ left: book.boundaryFraction * 100 + '%' }} />
            </div>
            <p className="book-progress-label">
              已读 {Math.floor(book.boundaryFraction * 100)}% · 边界
            </p>
          </article>
        ))}
      </div>
      {!books.length && (
        <p className="library-empty">
          书还没有放上来。导入一本 EPUB，开始安静地读。
        </p>
      )}
    </section>
  );
}

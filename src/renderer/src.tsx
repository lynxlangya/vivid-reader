import { createRoot } from 'react-dom/client';
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css';
import './styles/tokens.css';
import './styles/app.css';
const paragraphs = [
  '这并不是说某一群人天生更聪明。',
  '差别在于他们脚下的土地：有没有可以种的谷物，有没有肯被驯养的牲畜，大陆是东西走向还是南北走向。',
  '这并不是说某一群人天生更聪明。差别在于他们脚下的土地：有没有可以种的谷物，有没有肯被驯养的牲畜，大陆是东西走向还是南北走向。这些问题，后面会一个一个讲到。',
];
function App() {
  return (
    <main className="page">
      <aside className="spine">历历 · 试读</aside>
      <article className="col">
        <p className="ch-no">第一章</p>
        <h1 className="ch-title">土地与远行</h1>
        {paragraphs.map((p) => (
          <p className="para" key={p}>
            {p}
          </p>
        ))}
      </article>
      <footer className="pager">— 1 / 1 —</footer>
      <div className="progress">
        <i className="read" />
        <i className="cur" />
        <i className="bound" />
        <span className="bound-lab">已读至 第一章</span>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

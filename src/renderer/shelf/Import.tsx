import { useEffect, useState } from 'react';
import type { OpenBook } from '../../shared/book';
import type { PipelineStatus } from '../../shared/pipeline';
import { Cover } from './Library';
const states = {
  idle: '等待中',
  running: '整理中',
  done: '完成',
  failed: '可重试',
  'missing-key': '等待模型设置',
};
export function Import({
  book,
  onRead,
}: {
  book: OpenBook;
  onRead: () => void;
}) {
  const [status, setStatus] = useState<PipelineStatus>({
    state: 'idle',
    chapters: 0,
    entities: 0,
    completedSteps: 0,
  });
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void window.vivid.pipelineStatus().then((status) => {
        if (live) setStatus(status);
      });
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="import-page">
      <header>
        <Cover book={book} />
        <div>
          <h1>正在整理书稿</h1>
          <p>整理时只显示数量。读到后面时，那些地方仍然是你第一次见到。</p>
        </div>
      </header>
      <div className="import-step">
        <span>解析章节</span>
        <i />
        <span>{status.chapters} 章</span>
      </div>
      <div className="import-step">
        <span>识别人名地名</span>
        <i />
        <span>{status.entities} 个</span>
      </div>
      <div className="import-step">
        <span>关联真实资料</span>
        <i />
        <span>{states[status.state]}</span>
      </div>
      <div className="import-step">
        <span>整理步骤</span>
        <i />
        <span>{status.completedSteps} 项完成</span>
      </div>
      <p className="start-note">现在就可以开始读。</p>
      <button className="primary" onClick={onRead}>
        开始阅读
      </button>
      {(status.state === 'missing-key' || status.state === 'failed') && (
        <button onClick={() => void window.vivid.preprocess()}>重试整理</button>
      )}
    </section>
  );
}

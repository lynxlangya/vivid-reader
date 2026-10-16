import { useEffect, useState } from 'react';
import type { ReviewEntity } from '../shared/entity';
import type { PipelineStatus } from '../shared/pipeline';
export function Review({ onClose }: { onClose: () => void }) {
  const [entities, setEntities] = useState<ReviewEntity[]>([]);
  const [status, setStatus] = useState<PipelineStatus>();
  const [error, setError] = useState('');
  function refresh() {
    void Promise.all([
      window.vivid.reviewEntities(),
      window.vivid.pipelineStatus(),
    ])
      .then(([rows, next]) => {
        setEntities(rows);
        setStatus(next);
      })
      .catch(() => setError('核对数据暂时不可用'));
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="review" role="dialog" aria-label="抽取核对">
      <header>
        <h1>抽取核对</h1>
        <button onClick={onClose}>关闭核对</button>
      </header>
      <p>仅第一、二章 · 链接准确率：待人工核对</p>
      <p>
        章节 {status?.chapters ?? 0} · 实体 {status?.entities ?? 0} · 已完成步骤{' '}
        {status?.completedSteps ?? 0}
      </p>
      <button
        onClick={() => {
          void window.vivid.preprocess().then(refresh);
        }}
      >
        继续整理
      </button>
      {status?.state === 'missing-key' && (
        <p>尚未配置模型 Key，预处理未实跑。</p>
      )}
      {error && <p role="status">{error}</p>}
      {entities.map((entity) => (
        <article key={entity.id}>
          <h2>
            {entity.name} <small>{entity.original}</small>
          </h2>
          <p>
            {entity.type} · 重要度 {entity.importance.toFixed(2)} ·{' '}
            {entity.aliases.join(' / ')}
          </p>
          <p>
            采用：{entity.linked?.label ?? '未链接'} · 置信度{' '}
            {entity.confidence.toFixed(2)}
          </p>
          <ul>
            {entity.candidates.map((candidate) => (
              <li key={candidate.qid}>
                {candidate.label} · {candidate.qid} · {candidate.country ?? ''}{' '}
                · {candidate.description}
              </li>
            ))}
          </ul>
          <p>
            核对：
            {entity.review === null ? '未标记' : entity.review ? '对' : '错'}
          </p>
          <button
            onClick={() => {
              void window.vivid.markReview(entity.id, true).then(refresh);
            }}
          >
            对
          </button>
          <button
            onClick={() => {
              void window.vivid.markReview(entity.id, false).then(refresh);
            }}
          >
            错
          </button>
        </article>
      ))}
    </section>
  );
}

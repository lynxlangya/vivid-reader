import { useEffect, useRef, useState } from 'react';
import type { Preferences } from '../../shared/settings';
import type { ReaderState } from '../../shared/reading';
export function Settings({
  value,
  onChange,
  state,
  onBoundary,
  onClose,
}: {
  value: Preferences;
  onChange: (value: Preferences) => void;
  state: ReaderState | null;
  onBoundary: (state: ReaderState) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState('阅读'),
    [key, setKey] = useState(''),
    [hasKey, setHasKey] = useState(false),
    [status, setStatus] = useState(''),
    [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [fraction, setFraction] = useState(
      Math.round((state?.boundaryFraction ?? 0) * 100),
    );
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector('button')?.focus();
    void window.vivid.hasApiKey().then(setHasKey);
    void window.vivid.modelCatalog().then(setModels);
    return () => previous?.focus();
  }, []);
  const set = <K extends keyof Preferences>(field: K, next: Preferences[K]) =>
    onChange({ ...value, [field]: next });
  return (
    <div className="settings-backdrop">
      <section
        ref={dialog}
        className="preferences"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const list = Array.from(
              dialog.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input,select,textarea',
              ),
            );
            const first = list[0],
              last = list.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h1>设置</h1>
          <button onClick={onClose}>关闭设置</button>
        </header>
        <div className="preferences-body">
          <nav aria-label="设置分类">
            {['阅读', '标注', '模型', '伴读'].map((name) => (
              <button
                key={name}
                aria-pressed={name === tab}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          <div className="preferences-main">
            <h2>{tab}</h2>
            {tab === '阅读' && (
              <>
                <div className="pref-group">
                  <div className="pref-row">
                    <span>正文字体</span>
                    <div className="segment">
                      {(['song', 'kai'] as const).map((font) => (
                        <button
                          key={font}
                          aria-pressed={value.font === font}
                          onClick={() => set('font', font)}
                        >
                          {font === 'song' ? '宋体' : '楷体'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="pref-row">
                    字号
                    <input
                      aria-label="字号"
                      type="range"
                      min="16"
                      max="26"
                      value={value.fontSize}
                      onChange={(e) => set('fontSize', Number(e.target.value))}
                    />
                    <output>{value.fontSize} px</output>
                  </label>
                  <label className="pref-row">
                    行高
                    <input
                      aria-label="行高"
                      type="range"
                      min="1.5"
                      max="2.3"
                      step=".05"
                      value={value.lineHeight}
                      onChange={(e) =>
                        set('lineHeight', Number(e.target.value))
                      }
                    />
                    <output>{value.lineHeight}</output>
                  </label>
                  <div className="pref-row">
                    <span>主题</span>
                    <div className="segment">
                      {(['day', 'night', 'system'] as const).map((theme, i) => (
                        <button
                          key={theme}
                          aria-pressed={value.theme === theme}
                          onClick={() => set('theme', theme)}
                        >
                          {['纸', '夜', '跟随系统'][i]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="pref-row">
                    显示原书封面
                    <input
                      type="checkbox"
                      checked={value.showOriginalCover}
                      onChange={(e) =>
                        set('showOriginalCover', e.target.checked)
                      }
                    />
                  </label>
                </div>
                <div className="font-preview">
                  <p
                    style={{
                      fontFamily:
                        value.font === 'song'
                          ? 'var(--font-book)'
                          : 'var(--font-kai)',
                      fontSize: value.fontSize,
                      lineHeight: value.lineHeight,
                    }}
                  >
                    沿着纸上的河流，旅人走进了山间的田野。
                  </p>
                  <p
                    style={{
                      fontFamily:
                        value.font === 'song'
                          ? 'var(--font-kai)'
                          : 'var(--font-book)',
                    }}
                  >
                    伴读：这里以行旅作为线索，理解人与土地之间的关系。
                  </p>
                  <small>正文与伴读的字体自动对调</small>
                </div>
              </>
            )}
            {tab === '标注' && (
              <>
                <div className="pref-group">
                  <div className="pref-row">
                    <span>标注密度</span>
                    <div className="segment">
                      {(['low', 'medium', 'high'] as const).map(
                        (density, i) => (
                          <button
                            key={density}
                            aria-pressed={value.density === density}
                            onClick={() => set('density', density)}
                          >
                            {['少', '中', '多'][i]}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
                <div className="pref-group">
                  {(
                    ['place', 'person', 'people', 'species', 'concept'] as const
                  ).map((type, i) => (
                    <label key={type} className="pref-row">
                      <span>{['地点', '人物', '族群', '物种', '概念'][i]}</span>
                      <span
                        className="mark-example"
                        style={{ textDecorationColor: `var(--m-${type})` }}
                      >
                        专名线示例
                      </span>
                      <input
                        type="checkbox"
                        checked={value.types.includes(type)}
                        onChange={(e) =>
                          set(
                            'types',
                            e.target.checked
                              ? [...value.types, type]
                              : value.types.filter((x) => x !== type),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            {tab === '模型' && (
              <>
                <div className="pref-group">
                  <label className="pref-row">
                    DeepSeek Key
                    <input
                      aria-label="DeepSeek Key"
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                  </label>
                  <p>保存在系统钥匙串中</p>
                  <p>{hasKey ? '已配置' : '尚未配置'}</p>
                  <button
                    disabled={!key}
                    onClick={() =>
                      void window.vivid
                        .setApiKey(key)
                        .then(() => {
                          setKey('');
                          setHasKey(true);
                          setStatus('已保存');
                        })
                        .catch(() => setStatus('系统密钥存储暂不可用'))
                    }
                  >
                    保存 Key
                  </button>
                  <button
                    onClick={() =>
                      void window.vivid.clearApiKey().then(() => {
                        setHasKey(false);
                        setKey('');
                      })
                    }
                  >
                    清除 Key
                  </button>
                </div>
                <label className="pref-row">
                  模型
                  <select
                    value={value.model}
                    onChange={(e) => set('model', e.target.value)}
                  >
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} · {model.id}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {tab === '伴读' && (
              <>
                <div className="pref-group">
                  <label className="pref-row">
                    已读边界
                    <input
                      aria-label="已读边界"
                      type="range"
                      min="0"
                      max="100"
                      value={fraction}
                      onChange={(e) => setFraction(Number(e.target.value))}
                    />
                    <output>{fraction}%</output>
                  </label>
                  <p>伴读只知道朱线之前的内容。往回调整会归档旧对话。</p>
                  <button
                    disabled={!state}
                    onClick={() =>
                      void window.vivid
                        .setBoundaryFraction(fraction / 100)
                        .then((next) => {
                          onBoundary(next);
                          setStatus('边界已调整');
                        })
                    }
                  >
                    应用边界
                  </button>
                </div>
                <label className="pref-row">
                  专注模式
                  <input
                    role="switch"
                    type="checkbox"
                    checked={value.focus}
                    onChange={(e) => set('focus', e.target.checked)}
                  />
                </label>
                <p>隐藏页边、目录和进度线</p>
              </>
            )}
            <p role="status">{status}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

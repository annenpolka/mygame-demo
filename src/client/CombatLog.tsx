import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../lab/session';

const labels = {
  action: '行動',
  damage: 'ダメージ',
  heal: '回復',
  move: '移動',
  shift: '武器',
  break: 'ブレイク',
  warning: '予告',
  system: '進行',
};
export function CombatLog({
  entries,
  onExport,
  initialOpen = false,
}: {
  entries: LogEntry[];
  onExport: () => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen),
    [filter, setFilter] = useState('all'),
    [battle, setBattle] = useState('all'),
    [query, setQuery] = useState(''),
    [follow, setFollow] = useState(true),
    [limit, setLimit] = useState(200);
  const list = useRef<HTMLDivElement>(null);
  const filtered = entries.filter(
    (e) =>
      (battle === 'all' || e.encounter === Number(battle)) &&
      (filter === 'all' ||
        (filter === 'important'
          ? ['warning', 'break', 'system'].includes(e.type)
          : e.type === filter)) &&
      e.text.includes(query),
  );
  const visible = filtered.slice(-limit),
    latest = entries.at(-1);
  useEffect(() => {
    if (follow && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [entries.length, open, follow, filter, battle, query]);
  return (
    <section className={`combat-log ${open ? 'expanded' : ''}`} aria-label="戦闘ログ">
      <div className="log-heading">
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          戦闘ログ <small>{entries.length}件</small> {open ? '⌃' : '⌄'}
        </button>
        {!open && (
          <p>
            {latest ? (
              <>
                <time>{latest.time.toFixed(1)}s</time> {latest.text}
              </>
            ) : (
              '戦闘開始から、行動・予告・ダメージを記録します。'
            )}
          </p>
        )}
        <button onClick={onExport} disabled={!entries.length}>
          JSON保存
        </button>
      </div>
      {open && (
        <>
          <div className="log-tools">
            <label>
              戦闘
              <select
                aria-label="ログの戦闘"
                value={battle}
                onChange={(e) => setBattle(e.target.value)}
              >
                <option value="all">2戦すべて</option>
                <option value="1">第一戦</option>
                <option value="2">第二戦</option>
              </select>
            </label>
            <label>
              種類
              <select
                aria-label="ログの種類"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">すべて</option>
                <option value="important">予告・ブレイク・進行</option>
                {Object.entries(labels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="search"
              aria-label="ログを検索"
              placeholder="名前・技で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="log-follow">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              最新を追う
            </label>
            <small>{filtered.length}件</small>
          </div>
          <div className="log-entries" ref={list} tabIndex={0} aria-label="戦闘ログ一覧">
            {filtered.length > limit && (
              <button
                className="older-events"
                onClick={() => {
                  setFollow(false);
                  setLimit(limit + 200);
                }}
              >
                以前の200件を表示（残り {filtered.length - limit}件）
              </button>
            )}
            {visible.map((e) => (
              <div className={`log-entry log-${e.type}`} key={e.id}>
                <time>
                  {e.encounter}戦 / {e.time.toFixed(1)}s
                </time>
                <b>{labels[e.type]}</b>
                <span>{e.text}</span>
              </div>
            ))}
            {!visible.length && (
              <p className="log-empty">
                {entries.length ? '条件に合うログはありません。' : 'まだ戦闘ログはありません。'}
              </p>
            )}
          </div>
          <p className="log-footnote">
            時刻は第一戦からの累計。ログを開いている間も戦闘は進みます。
          </p>
        </>
      )}
    </section>
  );
}

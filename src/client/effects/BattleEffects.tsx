import { actionPhase } from '../timing';
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { State, Target } from '../../sim/types';
import { effectCues, type EffectCue } from './events';
type Point = { x: number; y: number };
interface Layout {
  width: number;
  height: number;
  points: Record<string, Point>;
}
const colors = {
  slash: '#ffda94',
  shot: '#aaddff',
  magic: '#9ecffb',
  impact: '#ecc592',
  hit: '#f4a291',
  heal: '#93e7bd',
  shield: '#9fe3dc',
  move: '#dfc5f8',
  shift: '#e2d3a9',
  break: '#ffe2a5',
};
export function BattleEffects({
  state: s,
  field,
  aim = null,
  targetSide = 'enemy',
}: {
  state: State;
  field: RefObject<HTMLDivElement | null>;
  aim?: Target | null;
  targetSide?: 'ally' | 'enemy';
}) {
  const [layout, setLayout] = useState<Layout>({ width: 1, height: 1, points: {} });
  const [reduced, setReduced] = useState(false);
  const positions = s.allies.map((a) => a.row).join() + s.enemies.map((e) => e.row).join();
  useEffect(() => {
    const root = field.current;
    if (!root) return;
    const measure = () => {
      const b = root.getBoundingClientRect(),
        points: Record<string, Point> = {};
      root.querySelectorAll<HTMLElement>('[data-unit]').forEach((el) => {
        const r = (el.querySelector('.field-symbol') ?? el).getBoundingClientRect();
        points[el.dataset.unit!] = { x: r.x + r.width / 2 - b.x, y: r.y + r.height / 2 - b.y };
      });
      setLayout((old) => {
        const next = { width: b.width, height: b.height, points };
        return JSON.stringify(old) === JSON.stringify(next) ? old : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [field, positions, s.encounter]);
  useLayoutEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  const cues = effectCues(s);
  const from = layout.points[`a${s.selected}`];
  const to = !aim
    ? null
    : aim.kind === 'row'
      ? {
          x:
            layout.width *
            (targetSide === 'ally'
              ? aim.row === 'back'
                ? 0.125
                : 0.375
              : aim.row === 'front'
                ? 0.625
                : 0.875),
          y: layout.height * 0.52,
        }
      : layout.points[`${aim.kind === 'ally' ? 'a' : 'e'}${aim.id}`];
  return (
    <svg
      className="battle-effects"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      data-effects={reduced ? 'reduced' : 'full'}
    >
      {from && to && (
        <g className="field-aim-path">
          <path
            d={`M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${Math.max(10, Math.min(from.y, to.y) - 25)} ${to.x} ${to.y}`}
          />
          <circle cx={to.x} cy={to.y} r={27} />
          <path
            d={`M ${to.x - 7} ${to.y - 36} L ${to.x} ${to.y - 29} L ${to.x + 7} ${to.y - 36}`}
          />
        </g>
      )}
      {s.allies
        .filter((a) => a.hp > 0)
        .map((a) => {
          const p = layout.points[`a${a.id}`];
          if (!p) return null;
          return (
            <g key={`status-${a.id}`}>
              {a.shield > 0 && (
                <g className="fx-protection" data-status="shield">
                  <rect x={p.x - 37} y={p.y - 18} width={74} height={36} rx={12} />
                  <text x={p.x} y={p.y + 27}>
                    防護 {a.shield.toFixed(1)}s
                  </text>
                </g>
              )}
              {a.action && (
                <circle
                  className={`fx-casting ally ${a.action.resolved ? 'recovering' : ''}`}
                  data-status={a.action.resolved ? 'recovery' : 'windup'}
                  cx={p.x}
                  cy={p.y}
                  r={22}
                  pathLength={100}
                  strokeDasharray={`${(1 - actionPhase(a.action).remaining / actionPhase(a.action).total) * 100} 100`}
                />
              )}
            </g>
          );
        })}
      {s.enemies
        .filter((e) => e.hp > 0 && e.cast)
        .map((e) => {
          const p = layout.points[`e${e.id}`];
          if (!p || !e.cast) return null;
          return (
            <circle
              key={`cast-${e.id}`}
              className="fx-casting enemy"
              cx={p.x}
              cy={p.y}
              r={23}
              pathLength={100}
              strokeDasharray={`${(1 - e.cast.remaining / e.cast.total) * 100} 100`}
            />
          );
        })}
      {cues.map(
        (cue) =>
          layout.points[cue.target] && (
            <Cue
              key={cue.id}
              cue={cue}
              point={layout.points[cue.target]}
              source={cue.source ? layout.points[cue.source] : undefined}
              layout={layout}
              reduced={reduced}
              siblings={cues.filter((c) => c.target === cue.target)}
            />
          ),
      )}
    </svg>
  );
}
function Cue({
  cue: c,
  point: p,
  source,
  layout,
  reduced,
  siblings,
}: {
  cue: EffectCue;
  point: Point;
  source?: Point;
  layout: Layout;
  reduced: boolean;
  siblings: EffectCue[];
}) {
  const t = reduced ? 0.5 : c.progress,
    burst = Math.min(1, t * 4),
    fade = Math.min(1, (1 - c.progress) * 3),
    radius = 12 + burst * 24;
  const hit = ['hit', 'impact', 'magic', 'break'].includes(c.type);
  const x0 = c.target.startsWith('e')
    ? p.x < layout.width * 0.75
      ? p.x + layout.width / 4
      : p.x - layout.width / 4
    : p.x < layout.width * 0.25
      ? p.x + layout.width / 4
      : p.x - layout.width / 4;
  const value = c.value === undefined ? c.label : `${c.type === 'heal' ? '+' : ''}${c.value}`;
  const numbered = siblings.filter((x) => x.value !== undefined);
  const offset =
    c.value === undefined
      ? 0
      : (numbered.findIndex((x) => x.id === c.id) - (numbered.length - 1) / 2) * 40;
  return (
    <g
      className={`fx-cue fx-${c.type}`}
      data-effect={c.type}
      data-target={c.target}
      data-value={c.value}
      opacity={fade}
      style={{ color: colors[c.type] }}
    >
      {source && !reduced && ['shot', 'magic', 'heal', 'slash'].includes(c.type) && (
        <path
          className="fx-flight"
          d={`M ${source.x} ${source.y} Q ${(source.x + p.x) / 2} ${Math.max(10, Math.min(source.y, p.y) - 25)} ${p.x} ${p.y}`}
          pathLength={100}
          strokeDasharray={c.type === 'shot' ? '12 8' : '65 35'}
          strokeDashoffset={100 - t * 160}
        />
      )}
      {c.type === 'slash' && (
        <g
          className="fx-slashes"
          transform={`translate(${p.x} ${p.y}) scale(${0.7 + burst * 0.4})`}
        >
          <path d="M -29 21 Q -5 -2 31 -20" />
          <path d="M -17 -22 L 19 19" />
        </g>
      )}
      {c.type === 'shot' && (
        <g className="fx-arrow-impact">
          <path
            d={`M ${p.x - 24} ${p.y + 12} L ${p.x + 19} ${p.y - 10} M ${p.x + 8} ${p.y - 14} L ${p.x + 19} ${p.y - 10} L ${p.x + 13} ${p.y + 1}`}
          />
          <circle cx={p.x} cy={p.y} r={radius * 0.5} />
        </g>
      )}
      {hit && (
        <g className="fx-burst">
          <circle cx={p.x} cy={p.y} r={radius} />
          {Array.from({ length: c.type === 'break' ? 10 : 6 }, (_, i) => {
            const angle = (i * Math.PI * 2) / (c.type === 'break' ? 10 : 6);
            return (
              <path
                key={i}
                d={`M ${p.x + Math.cos(angle) * radius * 0.6} ${p.y + Math.sin(angle) * radius * 0.6} L ${p.x + Math.cos(angle) * (radius + 10)} ${p.y + Math.sin(angle) * (radius + 10)}`}
              />
            );
          })}
        </g>
      )}
      {c.type === 'heal' && (
        <g className="fx-healing">
          <ellipse cx={p.x} cy={p.y + 9} rx={radius} ry={radius * 0.35} />
          {[-1, 0, 1].map((i) => (
            <path
              key={i}
              d={`M ${p.x + i * 20 - 5} ${p.y - 20 - t * 16 + Math.abs(i) * 8} h 10 m -5 -5 v 10`}
            />
          ))}
        </g>
      )}
      {c.type === 'shield' && (
        <path
          className="fx-shield-shape"
          d={`M ${p.x - 25} ${p.y - 19} Q ${p.x} ${p.y - 28} ${p.x + 25} ${p.y - 19} L ${p.x + 21} ${p.y + 8} L ${p.x} ${p.y + 24} L ${p.x - 21} ${p.y + 8} Z`}
        />
      )}
      {c.type === 'move' && (
        <g className="fx-displace">
          <path
            d={`M ${x0} ${p.y} Q ${(x0 + p.x) / 2} ${p.y - 25} ${p.x} ${p.y}`}
            pathLength={100}
            strokeDasharray="5 4"
          />
          <path
            d={`M ${p.x + (x0 > p.x ? 12 : -12)} ${p.y - 9} L ${p.x} ${p.y} L ${p.x + (x0 > p.x ? 12 : -12)} ${p.y + 9}`}
          />
        </g>
      )}
      {c.type === 'shift' && (
        <g
          className="fx-shifting"
          transform={`translate(${p.x} ${p.y}) rotate(${reduced ? 0 : t * 100})`}
        >
          <rect x={-21} y={-21} width={42} height={42} rx={3} />
          <rect x={-14} y={-14} width={28} height={28} />
        </g>
      )}
      <text
        className={`fx-number ${c.type === 'break' ? 'break-label' : ''}`}
        x={p.x + offset}
        y={p.y - 23 - (reduced ? 0 : t * 14)}
      >
        {value}
      </text>
      {c.value !== undefined && siblings.at(-1)?.id === c.id && (
        <text className="fx-action-label" x={p.x} y={p.y + 21}>
          {c.label}
        </text>
      )}
    </g>
  );
}

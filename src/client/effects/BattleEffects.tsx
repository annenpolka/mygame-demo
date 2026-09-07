import { useEffect, useState, type RefObject } from 'react';
import type { State, Target } from '../../sim/types';
import { type EffectCue, type ActionCue } from './events';
import { Particles } from './Particles';
import { PALETTE, arc, clamp, columnX, type Layout, type Anchor } from './geometry';

export function BattleEffects({
  state: s,
  field,
  aim = null,
  targetSide = 'enemy',
  cues,
  actions,
}: {
  state: State;
  field: RefObject<HTMLDivElement | null>;
  aim?: Target | null;
  targetSide?: 'ally' | 'enemy';
  cues: EffectCue[];
  actions: ActionCue[];
}) {
  const [layout, setLayout] = useState<Layout>({ width: 1, height: 1, points: {} });
  const [reduced, setReduced] = useState(false);
  const positions = s.allies.map((a) => a.row).join() + s.enemies.map((e) => e.row).join();
  useEffect(() => {
    const root = field.current;
    if (!root) return;
    const measure = () => {
      const b = root.getBoundingClientRect(),
        points: Layout['points'] = {};
      root.querySelectorAll<HTMLElement>('[data-unit]').forEach((el) => {
        const r = (el.querySelector('.field-symbol') ?? el).getBoundingClientRect(),
          card = el.getBoundingClientRect();
        points[el.dataset.unit!] = {
          x: r.x + r.width / 2 - b.x,
          y: r.y + r.height / 2 - b.y,
          left: card.x - b.x,
          top: card.y - b.y,
          width: card.width,
          height: card.height,
        };
      });
      setLayout((old) => {
        const next = { width: b.width, height: b.height, points };
        return JSON.stringify(old) === JSON.stringify(next) ? old : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll('[data-unit]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [field, positions, s.encounter]);
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)'),
      update = () => setReduced(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  const from = layout.points[`a${s.selected}`];
  const to = !aim
    ? null
    : aim.kind === 'row'
      ? { x: columnX(layout, targetSide, aim.row), y: layout.height * 0.5 }
      : layout.points[`${aim.kind === 'ally' ? 'a' : 'e'}${aim.id}`];
  return (
    <>
      <svg
        className="battle-effects fx-underlay"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="threat-hatch"
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <path d="M0 0V12" stroke="#ff957b" strokeWidth="2" opacity=".16" />
          </pattern>
        </defs>
        {actions
          .filter((c) => !c.recovery)
          .map((c) => {
            const p = layout.points[c.source];
            if (!p) return null;
            const color = PALETTE[c.type];
            return (
              <g
                key={c.source}
                className={`fx-intent ${c.hostile ? 'hostile' : 'friendly'}`}
                data-source={c.source}
                data-action={c.label}
                color={color}
              >
                {c.area &&
                  (c.area.row ? [c.area.row] : (['front', 'back'] as const)).map((row) => {
                    const x = columnX(layout, c.area!.side, row) - layout.width / 8;
                    return (
                      <g key={row} data-zone={`${c.area!.side}-${row}`}>
                        <rect
                          className="fx-area-fill"
                          x={x + 3}
                          y={25}
                          width={layout.width / 4 - 6}
                          height={layout.height - 30}
                          fill={c.hostile ? 'url(#threat-hatch)' : color}
                          opacity={c.hostile ? 0.8 : 0.07}
                        />
                        <path
                          className="fx-area-bracket"
                          d={`M${x + 15} 29h-10v${layout.height - 39}h10 M${x + layout.width / 4 - 15} 29h10v${layout.height - 39}h-10`}
                          opacity={0.3 + c.progress * 0.5}
                        />
                      </g>
                    );
                  })}
                {c.targets.map((id) => {
                  const q = layout.points[id];
                  if (!q) return null;
                  return (
                    <g key={id} data-aim-target={id}>
                      <path
                        className="fx-intent-line"
                        d={arc(p, q)}
                        opacity={c.hostile ? 0.25 + c.progress * 0.4 : 0.17}
                        strokeDasharray={c.hostile ? '5 7' : '2 8'}
                      />
                      <g
                        className="fx-lock"
                        transform={`translate(${q.x} ${q.y})`}
                        opacity={c.hostile ? 0.45 + c.progress * 0.45 : 0.35}
                      >
                        <path d="M-31-12v-13h13M18-25h13v13M31 12v13H18M-18 25h-13V12" />
                        {c.hostile && <path d="M-5-33 0-27 5-33" />}
                      </g>
                    </g>
                  );
                })}
              </g>
            );
          })}
        {from && to && (
          <g className="field-aim-path">
            <path d={arc(from, to)} />
            <circle cx={to.x} cy={to.y} r="32" />
          </g>
        )}
      </svg>
      <Particles layout={layout} cues={cues} actions={actions} reduced={reduced} />
      <svg
        className="battle-effects fx-foreground"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-hidden="true"
        data-effects={reduced ? 'reduced' : 'full'}
      >
        {s.allies
          .filter((a) => a.hp > 0 && a.shield > 0)
          .map((a) => {
            const p = layout.points[`a${a.id}`];
            return (
              p && (
                <g
                  key={a.id}
                  className="fx-protection"
                  data-status="shield"
                  transform={`translate(${p.x} ${p.y})`}
                >
                  <path d="M0-33 29-18 29 16 0 34-29 16-29-18Z" />
                  <path d="M0-28 24-14 24 13 0 28-24 13-24-14Z" opacity=".4" />
                  <text
                    className="fx-shield-caption"
                    x={p.left + p.width / 2 - p.x}
                    y={p.top + p.height - 2 - p.y}
                  >
                    防護 {a.shield.toFixed(1)}s
                  </text>
                </g>
              )
            );
          })}
        {actions.map((c) => {
          const p = layout.points[c.source];
          return (
            p && (
              <g key={c.source} color={c.recovery ? '#92a8b7' : PALETTE[c.type]}>
                <circle
                  className={`fx-casting ${c.hostile ? 'enemy' : 'ally'}`}
                  data-status={c.recovery ? 'recovery' : 'windup'}
                  cx={p.x}
                  cy={p.y}
                  r="30"
                  pathLength="100"
                  strokeDasharray={`${c.progress * 100} 100`}
                  transform={`rotate(-90 ${p.x} ${p.y})`}
                />
                {c.combo > 1 && (
                  <text className="fx-combo" x={p.x} y={p.y - 38}>
                    {c.combo}連続
                  </text>
                )}
              </g>
            )
          );
        })}
        {cues.map((c) => {
          const p = layout.points[c.target];
          return p && <ImpactLabel key={c.id} cue={c} p={p} reduced={reduced} />;
        })}
      </svg>
    </>
  );
}
function ImpactLabel({ cue: c, p, reduced }: { cue: EffectCue; p: Anchor; reduced: boolean }) {
  const special = c.value === undefined,
    t = reduced ? 0.4 : c.progress;
  const text = c.value === undefined ? c.label : `${c.type === 'heal' ? '+' : ''}${c.value}`;
  // Dedicated feedback strip at the foot of the card keeps numbers clear of name/HP/cast.
  const compact = p.height < 85;
  const x = compact ? p.x : p.left + p.width * (special ? 0.5 : 0.16 + (c.lane % 4) * 0.225);
  const y = p.top + p.height - 9 - (reduced ? 0 : Math.sin(t * Math.PI) * 5);
  return (
    <g
      className={`fx-cue fx-${c.type}`}
      data-effect={c.type}
      data-source={c.source}
      data-target={c.target}
      data-value={c.value}
      opacity={clamp((1 - c.progress) * 4)}
      color={PALETTE[c.type]}
    >
      {(c.type === 'break' || c.type === 'interrupt') && (
        <path
          className="fx-shatter"
          d={`M${p.x - 29} ${p.y - 29}l18 8-11 13 22 10-15 18M${p.x + 29} ${p.y - 29}l-18 8 11 13-22 10 15 18`}
          opacity={1 - t}
        />
      )}
      {reduced && c.value !== undefined && (
        <circle className="fx-static-impact" cx={p.x} cy={p.y} r="25" />
      )}
      <text
        className={`fx-number ${special ? 'fx-outcome' : ''} ${compact ? 'fx-compact' : ''}`}
        x={x}
        y={y - (special ? (compact ? 5 : 17) : 0)}
      >
        {text}
      </text>
      {c.shielded && (
        <text className="fx-mitigated" x={x} y={y + 10}>
          軽減
        </text>
      )}
    </g>
  );
}

import { useLayoutEffect, useRef } from 'react';
import type { ActionCue, EffectCue } from './events';
import { PALETTE, along, clamp, columnX, noise, type Layout, type Point } from './geometry';

/** One canvas, no particle DOM nodes, no private animation loop or simulation writes. */
export function Particles({
  layout,
  cues,
  actions,
  reduced,
}: {
  layout: Layout;
  cues: EffectCue[];
  actions: ActionCue[];
  reduced: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current,
      ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const paintStarted = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(layout.width * dpr),
      h = Math.round(layout.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, layout.width, layout.height);
    if (reduced) {
      canvas.dataset.particles = '0';
      return;
    }
    let particles = 0;
    const ring = (p: Point, r: number, color: string, alpha: number, width = 2, yScale = 1) => {
      ctx.globalAlpha = clamp(alpha);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, Math.max(0.1, r), Math.max(0.1, r * yScale), 0, 0, Math.PI * 2);
      ctx.stroke();
    };
    const glow = (p: Point, r: number, color: string, alpha: number) => {
      ctx.globalAlpha = clamp(alpha);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, color);
      g.addColorStop(0.25, color + '88');
      g.addColorStop(1, color + '00');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    };
    const streak = (a: Point, b: Point, color: string, width: number, alpha: number) => {
      ctx.globalAlpha = clamp(alpha);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    ctx.globalCompositeOperation = 'lighter';
    for (const c of actions) {
      const p = layout.points[c.source];
      if (!p || c.recovery) continue;
      const color = PALETTE[c.type],
        t = c.progress;
      glow(p, 25 + 20 * t, color, 0.13 + 0.22 * t);
      ring({ x: p.x, y: p.y + 19 }, 20 + 3 * t, color, 0.5, 1, 0.3);
      if (c.type === 'magic' || c.type === 'heal' || c.type === 'shield') {
        for (let i = 0; i < 9; i++) {
          const angle = (i * Math.PI * 2) / 9 + t * 4,
            r = 28 * (1 - t * 0.55);
          const q = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r * 0.7 };
          glow(q, 4, color, 0.35 + t * 0.4);
          particles++;
        }
      }
      // Windup owns flight. A cancelled cast disappears without producing an impact.
      if (t > 0.55)
        for (const id of c.targets) {
          const to = layout.points[id];
          if (!to) continue;
          const travel = clamp((t - 0.55) / 0.45);
          const tip = along(p, to, travel),
            tail = along(p, to, Math.max(0, travel - 0.12));
          if (c.type === 'slash' || c.type === 'hit' || c.type === 'impact') {
            // A weapon silhouette advances along its attack arc, not the unit's hit box.
            streak(tail, tip, color, 4, 0.65);
            streak(
              { x: tip.x - 8, y: tip.y + 14 },
              { x: tip.x + 9, y: tip.y - 15 },
              '#ffffff',
              2,
              0.9,
            );
          } else {
            streak(tail, tip, color, c.type === 'blast' ? 7 : 3, 0.6);
            glow(tip, c.type === 'blast' ? 20 : 12, color, 0.8);
            for (let j = 1; j <= 5; j++) {
              const q = along(p, to, Math.max(0, travel - j * 0.022));
              glow(q, 4 - j * 0.4, color, (1 - j / 6) * 0.5);
              particles++;
            }
          }
        }
    }
    for (const c of cues) {
      const p = layout.points[c.target];
      if (!p) continue;
      const t = c.progress,
        fade = clamp((1 - t) * 2),
        burst = 1 - Math.pow(1 - clamp(t * 2), 3),
        color = PALETTE[c.type];
      const hit = c.value !== undefined && c.type !== 'heal';
      if (c.type === 'miss' || c.type === 'resist') continue;
      if (hit || c.type === 'break' || c.type === 'defeat') {
        const big = c.type === 'break' || c.type === 'blast';
        glow(p, big ? 85 : 52, c.shielded ? PALETTE.shield : color, Math.pow(1 - t, 3) * 0.85);
        ring(p, 8 + burst * (big ? 65 : 33), color, fade * (1 - t), big ? 3 : 1.5);
        ring({ x: p.x, y: p.y + 23 }, 12 + burst * (big ? 76 : 45), color, fade * 0.65, 2, 0.28);
        if (c.shielded) {
          ring(p, 28, PALETTE.shield, fade, 4);
          streak(
            { x: p.x - 22, y: p.y - 24 },
            { x: p.x + 18, y: p.y + 23 },
            PALETTE.shield,
            2,
            fade,
          );
        }
        const count = big ? 32 : c.type === 'defeat' ? 24 : 16;
        for (let i = 0; i < count; i++) {
          const seed = c.id * 131 + i * 17,
            angle = noise(seed) * Math.PI * 2;
          const speed = 18 + noise(seed + 1) * (big ? 90 : 47),
            distance = speed * burst;
          const q = {
            x: p.x + Math.cos(angle) * distance,
            y: p.y + Math.sin(angle) * distance * 0.8 + t * t * 18,
          };
          const tail = {
            x: q.x - Math.cos(angle) * (3 + noise(seed + 2) * 10) * (1 - t),
            y: q.y - Math.sin(angle) * 8 * (1 - t),
          };
          streak(
            tail,
            q,
            i % 3 === 0 ? '#ffffff' : color,
            1 + noise(seed + 3) * 2,
            fade * (0.4 + noise(seed + 4) * 0.6),
          );
          particles++;
          if (c.type === 'break' && i % 3 === 0) {
            ctx.globalAlpha = fade;
            ctx.fillStyle = color;
            ctx.save();
            ctx.translate(q.x, q.y);
            ctx.rotate(angle + t * 2);
            ctx.fillRect(-2, -4, 4, 8);
            ctx.restore();
          }
        }
        if (c.type === 'slash' || c.type === 'hit') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(c.combo % 2 === 0 ? -0.7 : 0.55);
          ctx.globalAlpha = fade;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(-45, 24);
          ctx.quadraticCurveTo(3, -20, 47, -24);
          ctx.quadraticCurveTo(7, -3, -45, 24);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-40, 20);
          ctx.quadraticCurveTo(0, -8, 45, -23);
          ctx.stroke();
          ctx.restore();
        }
        if (c.type === 'magic') {
          for (let i = 0; i < 3; i++) {
            const dx = (i - 1) * 19;
            streak(
              { x: p.x + dx - 9, y: p.y - 62 * (1 - t) },
              { x: p.x + dx, y: p.y + 8 },
              color,
              3,
              fade * 0.7,
            );
          }
        }
        if (c.type === 'impact' || c.type === 'blast')
          for (let i = 0; i < 5; i++) {
            const a = (i * Math.PI * 2) / 5;
            streak(
              { x: p.x + Math.cos(a) * 14, y: p.y + Math.sin(a) * 14 },
              { x: p.x + Math.cos(a) * 47 * burst, y: p.y + Math.sin(a) * 47 * burst },
              color,
              4,
              fade,
            );
          }
      } else if (c.type === 'heal' || c.type === 'shield' || c.type === 'shift') {
        glow(p, 56, color, fade * 0.32);
        ring({ x: p.x, y: p.y + 22 }, 15 + burst * 24, color, fade, 2, 0.3);
        for (let i = 0; i < 18; i++) {
          const x = p.x + (noise(c.id * 31 + i) - 0.5) * 55,
            y = p.y + 25 - t * (38 + noise(i + 5) * 38);
          ctx.globalAlpha = fade;
          ctx.fillStyle = i % 3 ? '#ffffff' : color;
          ctx.fillRect(x - 1.5, y - 3, 3, 6);
          particles++;
        }
      } else if (c.type === 'move' && c.fromRow) {
        const x0 = columnX(layout, c.target.startsWith('a') ? 'ally' : 'enemy', c.fromRow);
        for (let i = 0; i < 7; i++) {
          const q = along({ x: x0, y: p.y }, p, clamp(t + i * 0.04));
          glow(q, 8 - i * 0.6, color, fade * (1 - i / 8) * 0.4);
          particles++;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    canvas.dataset.particles = String(particles);
    canvas.dataset.paintMs = (performance.now() - paintStarted).toFixed(3);
  }, [layout, cues, actions, reduced]);
  return <canvas ref={ref} className="battle-particles" aria-hidden="true" />;
}

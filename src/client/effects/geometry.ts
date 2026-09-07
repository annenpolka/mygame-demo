import { FIELD_COLUMNS } from '../../input/field-navigation';
import type { Row } from '../../sim/types';
export interface Point {
  x: number;
  y: number;
}
export interface Anchor extends Point {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Layout {
  width: number;
  height: number;
  points: Record<string, Anchor>;
}
export const PALETTE = {
  slash: '#ffe1a3',
  shot: '#a6e4ff',
  magic: '#aaa6ff',
  impact: '#ffc885',
  hit: '#ff987f',
  blast: '#ff947e',
  heal: '#95ffd4',
  shield: '#80e9e4',
  move: '#d4afff',
  shift: '#ead3ff',
  break: '#ffe294',
  defeat: '#b6c5d5',
  interrupt: '#d8b4ff',
  miss: '#adc7d5',
  resist: '#93e0e0',
};
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export function columnX(layout: Layout, side: 'ally' | 'enemy', row: Row) {
  return (
    ((FIELD_COLUMNS.findIndex((c) => c.side === side && c.row === row) + 0.5) * layout.width) / 4
  );
}
/** Arc above the unit info, with capped height so it stays inside the field. */
export function control(from: Point, to: Point): Point {
  return {
    x: (from.x + to.x) / 2,
    y: Math.max(8, Math.min(from.y, to.y) - Math.min(65, Math.abs(from.x - to.x) * 0.16)),
  };
}
export function along(from: Point, to: Point, t: number): Point {
  const c = control(from, to),
    q = 1 - t;
  return {
    x: q * q * from.x + 2 * q * t * c.x + t * t * to.x,
    y: q * q * from.y + 2 * q * t * c.y + t * t * to.y,
  };
}
export const arc = (a: Point, b: Point) => {
  const c = control(a, b);
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
};
/** Stateless, deterministic visual noise; deliberately independent of combat RNG. */
export const noise = (seed: number) =>
  ((Math.imul(seed + 73, 1597334677) ^ Math.imul(seed + 191, 3812015801)) >>> 0) / 4294967296;

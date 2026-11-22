"use client";

import { useEffect, useRef, type ComponentProps } from "react";

const CELL = 40;
const REACH = 140;
const PULSE_LENGTH = 48;
const AMBER = "246, 163, 33";
const TRACE = "255, 255, 255";

type Point = { x: number; y: number };
type Trace = { points: Point[]; lengths: number[]; total: number; pulse: number; speed: number; wait: number };
type Chip = { x: number; y: number; w: number; h: number };

// Octilinear directions: traces only run at multiples of 45 degrees, like a PCB.
const DIRS: Point[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTrace(points: Point[], rand: () => number): Trace {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(len);
    total += len;
  }
  return { points, lengths, total, pulse: -rand() * total * 2, speed: 50 + rand() * 50, wait: 0 };
}

function walk(start: Point, dir: number, width: number, height: number, rand: () => number): Point[] {
  const points = [start];
  let { x, y } = start;
  const segments = 3 + Math.floor(rand() * 4);
  for (let s = 0; s < segments; s++) {
    const len = 2 + Math.floor(rand() * 5);
    const nx = x + DIRS[dir].x * len * CELL;
    const ny = y + DIRS[dir].y * len * CELL;
    if (nx < 0 || ny < 0 || nx > width || ny > height) break;
    x = nx;
    y = ny;
    points.push({ x, y });
    if (rand() > 0.3) dir = (dir + (rand() < 0.5 ? 1 : 7)) % 8;
  }
  return points;
}

function buildLayout(width: number, height: number) {
  const rand = mulberry32(26);
  const cols = Math.floor(width / CELL);
  const rows = Math.floor(height / CELL);
  const area = cols * rows;
  const traces: Trace[] = [];
  const chips: Chip[] = [];

  const chipCount = Math.max(2, Math.round(area / 60));
  for (let i = 0; i < chipCount; i++) {
    const w = 4 + Math.floor(rand() * 3);
    const h = 3 + Math.floor(rand() * 2);
    if (cols <= w + 4 || rows <= h + 4) continue;
    const gx = 2 + Math.floor(rand() * (cols - w - 3));
    const gy = 2 + Math.floor(rand() * (rows - h - 3));
    chips.push({ x: gx * CELL, y: gy * CELL, w: w * CELL, h: h * CELL });
    for (let p = 1; p < w; p++) {
      if (rand() < 0.6) traces.push(makeTrace(walk({ x: (gx + p) * CELL, y: gy * CELL }, 6, width, height, rand), rand));
      if (rand() < 0.6) traces.push(makeTrace(walk({ x: (gx + p) * CELL, y: (gy + h) * CELL }, 2, width, height, rand), rand));
    }
  }

  const looseCount = Math.round(area / 6);
  for (let i = 0; i < looseCount; i++) {
    const start = { x: Math.floor(rand() * (cols + 1)) * CELL, y: Math.floor(rand() * (rows + 1)) * CELL };
    traces.push(makeTrace(walk(start, Math.floor(rand() * 8), width, height, rand), rand));
  }

  return { traces: traces.filter((t) => t.points.length > 1), chips };
}

function drawStatic(ctx: CanvasRenderingContext2D, traces: Trace[], chips: Chip[]) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(${TRACE}, 0.12)`;
  ctx.fillStyle = `rgba(${TRACE}, 0.12)`;
  ctx.lineWidth = 1.5;
  for (const t of traces) {
    ctx.beginPath();
    t.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    const end = t.points[t.points.length - 1];
    ctx.beginPath();
    ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    const start = t.points[0];
    ctx.beginPath();
    ctx.arc(start.x, start.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const c of chips) {
    ctx.fillStyle = "#050507";
    ctx.fillRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
    ctx.strokeStyle = `rgba(${TRACE}, 0.22)`;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = `rgba(${TRACE}, 0.22)`;
    for (let x = c.x + CELL; x < c.x + c.w; x += CELL) {
      ctx.fillRect(x - 1.5, c.y - 5, 3, 5);
      ctx.fillRect(x - 1.5, c.y + c.h, 3, 5);
    }
  }
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointAt(t: Trace, d: number): Point {
  let remaining = Math.max(0, Math.min(t.total, d));
  for (let i = 0; i < t.lengths.length; i++) {
    if (remaining <= t.lengths[i]) {
      const f = remaining / t.lengths[i];
      const a = t.points[i];
      const b = t.points[i + 1];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= t.lengths[i];
  }
  return t.points[t.points.length - 1];
}

/**
 * Full-viewport-height circuit-board background: dim octilinear traces with amber signal pulses
 * that speed up and light the traces near the cursor. Children render above it.
 */
export function CircuitBackground({ children, className = "", ...props }: ComponentProps<"div">) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !container || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let traces: Trace[] = [];
    let chips: Chip[] = [];
    let board: HTMLCanvasElement | null = null;
    let dpr = 1;
    let width = 0;
    let height = 0;
    let mouse: Point = { x: -1000, y: -1000 };
    let frame = 0;
    let last = performance.now();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ({ traces, chips } = buildLayout(width, height));

      board = document.createElement("canvas");
      board.width = canvas.width;
      board.height = canvas.height;
      const bctx = board.getContext("2d");
      if (bctx) {
        bctx.scale(dpr, dpr);
        drawStatic(bctx, traces, chips);
      }
      if (reduceMotion) paint(0);
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const paint = (dt: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (board) ctx.drawImage(board, 0, 0, width, height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const t of traces) {
        let nearest = Infinity;
        for (let i = 0; i < t.lengths.length; i++) {
          const d = distanceToSegment(mouse, t.points[i], t.points[i + 1]);
          nearest = Math.min(nearest, d);
          if (d < REACH) {
            ctx.strokeStyle = `rgba(${AMBER}, ${(1 - d / REACH) * 0.7})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(t.points[i].x, t.points[i].y);
            ctx.lineTo(t.points[i + 1].x, t.points[i + 1].y);
            ctx.stroke();
          }
        }
        if (reduceMotion) continue;

        const boost = nearest < REACH ? 1 + (1 - nearest / REACH) * 3 : 1;
        t.pulse += t.speed * boost * dt;
        if (t.pulse > t.total + PULSE_LENGTH) t.pulse = -Math.random() * t.total * 2;
        if (t.pulse < 0) continue;

        const strength = nearest < REACH ? 1 : 0.55;
        const steps = 8;
        for (let k = 0; k < steps; k++) {
          const a = pointAt(t, t.pulse - (k * PULSE_LENGTH) / steps);
          const b = pointAt(t, t.pulse - ((k + 1) * PULSE_LENGTH) / steps);
          ctx.strokeStyle = `rgba(${AMBER}, ${(1 - k / steps) * strength})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    };

    const loop = (now: number) => {
      paint(Math.min((now - last) / 1000, 0.05));
      last = now;
      frame = requestAnimationFrame(loop);
    };

    resize();
    if (!reduceMotion) frame = requestAnimationFrame(loop);
    window.addEventListener("resize", resize);
    // Window-level so the pointer still lights the board under the floating header.
    window.addEventListener("mousemove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div {...props} className={`relative h-dvh w-full overflow-hidden bg-[#050507] ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div className="relative z-10 flex h-full w-full">{children}</div>
    </div>
  );
}

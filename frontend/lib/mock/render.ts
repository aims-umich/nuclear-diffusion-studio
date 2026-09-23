import { createRng, hashString } from "@/lib/prng";

/**
 * Procedural placeholder "generation": a monochrome reactor core power map.
 *
 * It is deterministic in (seed, prompt), so re-running a request with the
 * same seed reproduces the same image - the same guarantee the real diffusion
 * pipeline gives. The image is clearly labelled as mock output so it is never
 * mistaken for model output.
 */

const VIEWBOX = 1024;
const CENTER = VIEWBOX / 2;
const CORE_RADIUS = 352;
const FG = "#f2f2f3";

type Cell = { x: number; y: number; power: number; rod: boolean };
type Core = { cells: Cell[]; cellSize: number };

export function renderMockImage(options: {
  seed: number;
  prompt: string;
  size: number;
}): string {
  const { seed, prompt, size } = options;
  const promptHash = hashString(prompt.trim().toLowerCase());
  const rng = createRng(seed ^ promptHash);
  const layout = promptHash % 2 === 0 ? "square" : "hex";
  const { cells, cellSize } = layout === "square" ? squareCore(rng) : hexCore(rng);
  const rotation = layout === "square" ? (rng() < 0.5 ? 0 : 45) : rng() < 0.5 ? 0 : 30;
  const glow = 0.1 + rng() * 0.08;
  const cellMarkup = cells.map((cell) => renderCell(cell, cellSize)).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">`,
    "<defs>",
    `<radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${FG}" stop-opacity="${glow.toFixed(3)}"/><stop offset="1" stop-color="${FG}" stop-opacity="0"/></radialGradient>`,
    "</defs>",
    `<rect width="${VIEWBOX}" height="${VIEWBOX}" fill="#0e0e0f"/>`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="470" fill="url(#g)"/>`,
    renderRings(),
    `<g transform="rotate(${rotation} ${CENTER} ${CENTER})">${cellMarkup}</g>`,
    renderLabel(),
    "</svg>",
  ].join("");
}

/** Octant-symmetric noise so the map reads like a real, symmetric core loading. */
function symmetricNoise(rng: () => number) {
  const table = new Map<string, number>();
  return (a: number, b: number) => {
    const lo = Math.min(Math.abs(a), Math.abs(b));
    const hi = Math.max(Math.abs(a), Math.abs(b));
    const key = `${lo}:${hi}`;
    let value = table.get(key);
    if (value === undefined) {
      value = rng();
      table.set(key, value);
    }
    return value;
  };
}

function powerAt(distance: number, noise: number) {
  const radial = Math.max(0, 1 - (distance / CORE_RADIUS) ** 2) ** 0.7;
  return Math.min(1, radial * (0.62 + noise * 0.55));
}

function squareCore(rng: () => number): Core {
  const n = [13, 15, 17][Math.floor(rng() * 3)];
  const half = (n - 1) / 2;
  const pitch = (CORE_RADIUS * 2) / n;
  const noise = symmetricNoise(rng);
  const rodChance = 0.14 + rng() * 0.08;
  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const di = i - half;
      const dj = j - half;
      const x = CENTER + di * pitch;
      const y = CENTER + dj * pitch;
      const distance = Math.hypot(x - CENTER, y - CENTER);
      if (distance + pitch * 0.45 > CORE_RADIUS) continue;
      const value = noise(di, dj);
      cells.push({ x, y, power: powerAt(distance, value), rod: value < rodChance && (di + dj) % 2 === 0 });
    }
  }
  return { cells, cellSize: pitch * 0.86 };
}

function hexCore(rng: () => number): Core {
  const rings = [7, 8, 9][Math.floor(rng() * 3)];
  const pitch = CORE_RADIUS / (rings + 0.5);
  const noise = symmetricNoise(rng);
  const rodChance = 0.14 + rng() * 0.08;
  const cells: Cell[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = Math.max(-rings, -q - rings); r <= Math.min(rings, -q + rings); r++) {
      const x = CENTER + pitch * (q + r / 2);
      const y = CENTER + pitch * r * (Math.sqrt(3) / 2);
      const distance = Math.hypot(x - CENTER, y - CENTER);
      if (distance + pitch * 0.45 > CORE_RADIUS) continue;
      const ringIndex = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const value = noise(ringIndex, Math.abs(q) + Math.abs(r));
      cells.push({ x, y, power: powerAt(distance, value), rod: value < rodChance && ringIndex % 2 === 1 });
    }
  }
  return { cells, cellSize: pitch * 0.8 };
}

function renderCell(cell: Cell, size: number) {
  const x = (cell.x - size / 2).toFixed(1);
  const y = (cell.y - size / 2).toFixed(1);
  const s = size.toFixed(1);
  const radius = (size * 0.12).toFixed(1);
  if (cell.rod) {
    return (
      `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${radius}" fill="none" stroke="${FG}" stroke-opacity="0.55" stroke-width="2"/>` +
      `<circle cx="${cell.x.toFixed(1)}" cy="${cell.y.toFixed(1)}" r="${(size * 0.14).toFixed(1)}" fill="${FG}" fill-opacity="0.7"/>`
    );
  }
  const opacity = (0.06 + cell.power * 0.84).toFixed(3);
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${radius}" fill="${FG}" fill-opacity="${opacity}"/>`;
}

function renderRings() {
  const ticks: string[] = [];
  for (let i = 0; i < 120; i++) {
    const angle = (i / 120) * Math.PI * 2;
    const inner = i % 10 === 0 ? 428 : 436;
    const x1 = CENTER + Math.cos(angle) * inner;
    const y1 = CENTER + Math.sin(angle) * inner;
    const x2 = CENTER + Math.cos(angle) * 444;
    const y2 = CENTER + Math.sin(angle) * 444;
    ticks.push(`M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`);
  }
  return [
    `<circle cx="${CENTER}" cy="${CENTER}" r="${CORE_RADIUS + 18}" fill="none" stroke="${FG}" stroke-opacity="0.16" stroke-width="1.5"/>`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="400" fill="none" stroke="${FG}" stroke-opacity="0.08" stroke-width="1"/>`,
    `<path d="${ticks.join("")}" stroke="${FG}" stroke-opacity="0.18" stroke-width="1.5"/>`,
  ].join("");
}

function renderLabel() {
  // The UI shows the seed in its own badge; the image only needs to say it is not model output.
  return `<text x="40" y="${VIEWBOX - 40}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" letter-spacing="3" fill="${FG}" fill-opacity="0.45">MOCK OUTPUT</text>`;
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

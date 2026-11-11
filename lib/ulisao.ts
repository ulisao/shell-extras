import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExplorerTheme } from "./explorer-view.ts";

/**
 * Ulisao, the estudiobaretta.com.ar bot: a slowly turning sphere of dots
 * with an iridescent rim (pink, cyan, green) and a dim violet core, like the
 * site's widget. It is drawn with Braille cells (2x4 dots each) in 24-bit
 * color; a full turn takes ULISAO_FRAMES frames.
 */
export const ULISAO_FRAMES = 60;
const ROWS = 9;
const COLS = 18;
const POINTS = 320;
/** Columns kept free on the right of the sphere. */
const MARGIN = 1;
const BLANK = 0x2800;
/** Braille dot bits by [dy][dx] inside one cell. */
const DOT = [
	[0x01, 0x08],
	[0x02, 0x10],
	[0x04, 0x20],
	[0x40, 0x80],
];

type Vec = [number, number, number];

/** Evenly spread points on the unit sphere (Fibonacci lattice). */
const SPHERE: Vec[] = Array.from({ length: POINTS }, (_, index) => {
	const y = 1 - (2 * (index + 0.5)) / POINTS;
	const radius = Math.sqrt(1 - y * y);
	const theta = index * Math.PI * (3 - Math.sqrt(5));
	return [Math.cos(theta) * radius, y, Math.sin(theta) * radius];
});

function hsl(h: number, s: number, l: number): [number, number, number] {
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
	return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Rim dots shimmer through pink, cyan and green; front dots are lavender; back dots dim violet. */
function dotColor(x: number, y: number, z: number, phase: number): [number, number, number] {
	if (z < -0.15) return [92, 74, 150];
	const rim = 1 - Math.abs(z);
	if (rim > 0.55) {
		const hue = ((Math.atan2(y, x) * 180) / Math.PI + phase * 360 + 360) % 360;
		// Green → cyan → blue → violet → pink, as on the site's rim.
		return hsl(140 + (hue / 360) * 200, 0.8, 0.7);
	}
	return [176, 164, 222];
}

interface Cell {
	bits: number;
	/** Nearest dot depth in this cell, and its color. */
	depth: number;
	color: [number, number, number];
}

export function ulisaoFrame(index: number, theme: ExplorerTheme, width: number): string[] {
	void theme;
	const frame = ((index % ULISAO_FRAMES) + ULISAO_FRAMES) % ULISAO_FRAMES;
	const t = frame / ULISAO_FRAMES;
	const spin = t * Math.PI * 2;
	const tilt = 0.35;
	const cells: Cell[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ bits: 0, depth: -2, color: [0, 0, 0] as [number, number, number] })));
	const width2 = COLS * 2;
	const height4 = ROWS * 4;
	const radius = Math.min(width2, height4) / 2 - 1;
	for (const [px, py, pz] of SPHERE) {
		// A gentle breathing wobble, like the site's sphere.
		const wobble = 1 + 0.05 * Math.sin(py * 4 + spin * 2) * Math.cos(px * 3 - spin);
		const x1 = px * Math.cos(spin) + pz * Math.sin(spin);
		const z1 = -px * Math.sin(spin) + pz * Math.cos(spin);
		const y2 = py * Math.cos(tilt) - z1 * Math.sin(tilt);
		const z2 = py * Math.sin(tilt) + z1 * Math.cos(tilt);
		const sx = Math.round(width2 / 2 - 0.5 + x1 * radius * wobble);
		const sy = Math.round(height4 / 2 - 0.5 - y2 * radius * wobble);
		if (sx < 0 || sy < 0 || sx >= width2 || sy >= height4) continue;
		const cell = cells[Math.floor(sy / 4)]![Math.floor(sx / 2)]!;
		cell.bits |= DOT[sy % 4]![sx % 2]!;
		if (z2 > cell.depth) {
			cell.depth = z2;
			cell.color = dotColor(x1, y2, z2, t);
		}
	}
	const left = Math.max(0, width - COLS - MARGIN);
	return cells.map((row) => {
		let line = " ".repeat(left);
		for (const cell of row) {
			const glyph = String.fromCodePoint(BLANK + cell.bits);
			line += cell.bits ? `\x1b[38;2;${cell.color[0]};${cell.color[1]};${cell.color[2]}m${glyph}\x1b[39m` : " ";
		}
		line += " ".repeat(MARGIN);
		const clipped = truncateToWidth(line, width, "");
		return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	});
}

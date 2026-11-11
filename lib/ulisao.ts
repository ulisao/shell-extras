import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExplorerTheme } from "./explorer-view.ts";

const EYES = { open: "◉   ◉", blink: "─   ─", wink: "◉   ─", side: "◉  ◉ " } as const;
type Eyes = keyof typeof EYES;

/** One frame: whether the bot floats up, its eyes and its mouth. */
const FRAMES: ReadonlyArray<{ up: boolean; eyes: Eyes; mouth: string }> = [
	{ up: true, eyes: "open", mouth: "◡" },
	{ up: true, eyes: "open", mouth: "◡" },
	{ up: true, eyes: "side", mouth: "◡" },
	{ up: false, eyes: "open", mouth: "◡" },
	{ up: false, eyes: "blink", mouth: "◡" },
	{ up: false, eyes: "open", mouth: "◡" },
	{ up: true, eyes: "open", mouth: "▿" },
	{ up: true, eyes: "wink", mouth: "◡" },
];

export const ULISAO_FRAMES = FRAMES.length;
/** Columns kept free on the right of the bot. */
const MARGIN = 1;

function body(eyes: string, mouth: string): string[] {
	return [" ╭───────╮ ", "╭╯ " + eyes.padEnd(5) + " ╰╮", "│    " + mouth + "    │", "╰╮       ╭╯", " ╰───────╯ "];
}

/**
 * The Ulisao bot (estudiobaretta.com.ar) as a floating round ASCII face:
 * it bobs one row up and down over its shadow, blinks and winks. Every
 * frame has the same height and ends with the shadow row, so the rail never
 * jumps and the host never strips a trailing blank row.
 */
export function ulisaoFrame(index: number, theme: ExplorerTheme, width: number): string[] {
	const frame = FRAMES[((index % FRAMES.length) + FRAMES.length) % FRAMES.length]!;
	const art = body(EYES[frame.eyes], frame.mouth).map((line) => theme.fg("accent", line));
	const blank = "";
	const shadow = theme.fg("dim", frame.up ? "    ░░░    " : "  ░░░░░░░  ");
	const rows = frame.up ? [...art, blank, shadow] : [blank, ...art, shadow];
	const artWidth = 11;
	const left = Math.max(0, width - artWidth - MARGIN);
	return rows.map((row) => {
		const padded = " ".repeat(left) + (row === blank ? " ".repeat(artWidth) : row) + " ".repeat(MARGIN);
		const clipped = truncateToWidth(padded, width, "");
		return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	});
}

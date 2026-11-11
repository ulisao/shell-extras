import { matchesKey, truncateToWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExplorerModel } from "./explorer-model.ts";
import { fitLine, formatTreeRow, STATUS_STYLE, type ExplorerTheme } from "./explorer-view.ts";
import type { TreeRow } from "./file-tree.ts";
import { iconFor } from "./icons.ts";
import { loadPreview, type PreviewContent } from "./preview.ts";

export interface PreviewState {
	row: TreeRow;
	/** Undefined while the file is loading. */
	content?: PreviewContent;
	scroll: number;
	/** Opened straight from the rail: esc closes instead of returning to the tree. */
	direct: boolean;
}

export interface OverlayState {
	mode: "tree" | "preview";
	/** Path of the selected tree row. */
	selected?: string;
	/** First tree row shown. */
	top: number;
	preview?: PreviewState;
}

const MESSAGES: Record<Exclude<PreviewContent["kind"], "text">, string> = {
	binary: "Binary file — no preview",
	missing: "File not found",
	dir: "Folder — nothing to preview",
};

const blank = (width: number) => " ".repeat(Math.max(0, width));
const exact = (text: string, width: number) => truncateToWidth(text, Math.max(0, width), "…", true);

/** The tree rows that fit under the title row. */
function bodyHeight(height: number): number {
	return Math.max(0, height - 1);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The first tree row actually drawn: `state.top` limited to the last page. */
export function treeTop(state: OverlayState, rowCount: number, height: number): number {
	return clamp(Math.floor(state.top), 0, rowCount - bodyHeight(height));
}

/** The most a preview can scroll for `height` rows. */
export function previewMaxScroll(preview: PreviewState, height: number): number {
	return Math.max(0, (preview.content?.kind === "text" ? preview.content.lines.length : 0) - bodyHeight(height));
}

function renderTree(state: OverlayState, rows: readonly TreeRow[], root: string, theme: ExplorerTheme, width: number, height: number): string[] {
	const hints = theme.fg("muted", "↑↓ move  ←→ fold  ⏎ open  esc close");
	const lines = [fitLine(` ${theme.fg("accent", theme.bold("FILES"))}  ${theme.fg("muted", root)}`, hints, width)];
	const body = bodyHeight(height);
	const top = treeTop(state, rows.length, height);
	for (const row of rows.slice(top, top + body)) lines.push(formatTreeRow(row, theme, width, { selected: row.path === state.selected, indent: 1 }));
	if (rows.length === 0 && body > 0) lines.push(exact(`  ${theme.fg("muted", "(empty)")}`, width));
	return lines;
}

function renderPreview(preview: PreviewState, theme: ExplorerTheme, width: number, height: number): string[] {
	const body = bodyHeight(height);
	const { row, content } = preview;
	const style = row.status ? STATUS_STYLE[row.status] : undefined;
	const badge = style ? theme.fg(style.role, style.badge || "ignored") : "";
	const text = content?.kind === "text" ? content.lines : [];
	const scroll = clamp(Math.floor(preview.scroll), 0, text.length - body);
	const range = text.length ? `${scroll + 1}-${Math.min(text.length, scroll + body)}/${text.length}` : "0-0/0";
	const notes = [content?.source === "HEAD" ? "HEAD" : "", content?.truncated ? "truncated" : "", range].filter(Boolean).join("  ");
	const left = ` ${theme.fg(style?.role ?? "muted", iconFor(row.name, false, false))} ${theme.fg(style?.role ?? "text", theme.bold(row.path))}${badge ? `  ${badge}` : ""}`;
	const lines = [fitLine(left, `${theme.fg("muted", notes)}  ${theme.fg("muted", "esc back")}`, width)];
	if (!content) lines.push(exact(`  ${theme.fg("muted", "Loading…")}`, width));
	else if (content.kind !== "text") lines.push(exact(`  ${theme.fg("muted", MESSAGES[content.kind])}`, width));
	else {
		const gutter = Math.max(3, String(text.length).length);
		for (const [offset, line] of text.slice(scroll, scroll + body).entries()) {
			const number = String(scroll + offset + 1).padStart(gutter);
			lines.push(exact(` ${theme.fg("dim", `${number} │`)} ${line}`, width));
		}
	}
	return lines;
}

/**
 * Draw the overlay: exactly `height` lines of exactly `width` columns, the
 * title row first. Pure; the input handler owns the state.
 */
export function renderOverlay(state: OverlayState, rows: readonly TreeRow[], root: string, theme: ExplorerTheme, width: number, height: number): string[] {
	const rowCount = Math.max(1, Math.floor(height));
	const columns = Math.max(0, Math.floor(width));
	const lines = state.mode === "preview" && state.preview ? renderPreview(state.preview, theme, columns, rowCount) : renderTree(state, rows, root, theme, columns, rowCount);
	const framed = lines.slice(0, rowCount).map((line) => exact(line, columns));
	while (framed.length < rowCount) framed.push(blank(columns));
	return framed;
}

export interface ExplorerOverlayOptions {
	model: ExplorerModel;
	theme: ExplorerTheme;
	/** The terminal rows the frame must fill. */
	rows: () => number;
	requestRender: () => void;
	close: () => void;
	/** Loads a file for the preview; `loadPreview` by default. */
	load?: (root: string, path: string) => Promise<PreviewContent>;
	/** Open straight in preview mode on this row. */
	preview?: TreeRow;
}

const HANDLED_RENDER: TuiMouseEventResult = { handled: true, render: true };

/** The keyboard and mouse explorer: a tree you navigate, and a preview of one file. */
export class ExplorerOverlay implements Component {
	readonly state: OverlayState = { mode: "tree", top: 0 };
	private readonly options: ExplorerOverlayOptions;
	private readonly unsubscribe: () => void;
	private closed = false;

	constructor(options: ExplorerOverlayOptions) {
		this.options = options;
		this.unsubscribe = options.model.onChange(() => options.requestRender());
		const first = options.preview;
		if (first) {
			this.state.selected = first.path;
			this.openPreview(first, true);
		} else {
			this.state.selected = options.model.rows[0]?.path;
		}
	}

	render(width: number): string[] {
		const { model, theme } = this.options;
		return renderOverlay(this.state, model.rows, model.root, theme, width, this.options.rows());
	}

	invalidate(): void {}

	dispose(): void {
		this.unsubscribe();
	}

	handleInput(data: string): void {
		if (this.state.mode === "preview" && this.state.preview) this.previewKey(this.state.preview, data);
		else this.treeKey(data);
		if (!this.closed) this.options.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const height = this.options.rows();
		const preview = this.state.mode === "preview" ? this.state.preview : undefined;
		if (event.type === "wheel") {
			const delta = Math.trunc(event.wheelDelta ?? 0);
			if (preview) preview.scroll = clamp(preview.scroll + delta, 0, previewMaxScroll(preview, height));
			else this.state.top = clamp(treeTop(this.state, this.options.model.rows.length, height) + delta, 0, this.options.model.rows.length - bodyHeight(height));
			return HANDLED_RENDER;
		}
		if (event.type === "click" && event.button === "left" && !preview && event.y >= 1) {
			const rows = this.options.model.rows;
			const row = rows[treeTop(this.state, rows.length, height) + event.y - 1];
			if (row) {
				this.state.selected = row.path;
				this.activate(row);
			}
			return HANDLED_RENDER;
		}
		return { handled: true, render: false };
	}

	private close(): void {
		this.closed = true;
		this.unsubscribe();
		this.options.close();
	}

	private get rows(): readonly TreeRow[] {
		return this.options.model.rows;
	}

	private selectedIndex(): number {
		const index = this.rows.findIndex((row) => row.path === this.state.selected);
		return index < 0 ? 0 : index;
	}

	private select(index: number): void {
		const rows = this.rows;
		if (rows.length === 0) return;
		const next = clamp(index, 0, rows.length - 1);
		this.state.selected = rows[next]!.path;
		const body = bodyHeight(this.options.rows());
		const top = treeTop(this.state, rows.length, this.options.rows());
		if (next < top) this.state.top = next;
		else if (next >= top + body) this.state.top = next - body + 1;
		else this.state.top = top;
	}

	private activate(row: TreeRow): void {
		if (row.dir) this.options.model.toggle(row.path);
		else this.openPreview(row, false);
	}

	private treeKey(data: string): void {
		const rows = this.rows;
		const index = this.selectedIndex();
		const row = rows[index];
		const page = Math.max(1, bodyHeight(this.options.rows()) - 1);
		if (matchesKey(data, "escape") || data === "q") return this.close();
		if (matchesKey(data, "up") || data === "k") this.select(index - 1);
		else if (matchesKey(data, "down") || data === "j") this.select(index + 1);
		else if (matchesKey(data, "pageUp")) this.select(index - page);
		else if (matchesKey(data, "pageDown")) this.select(index + page);
		else if (matchesKey(data, "home")) this.select(0);
		else if (matchesKey(data, "end")) this.select(rows.length - 1);
		else if (!row) return;
		else if (matchesKey(data, "right") || data === "l") {
			if (!row.dir) return;
			if (!row.expanded) this.options.model.toggle(row.path);
			else if (rows[index + 1] && rows[index + 1]!.depth > row.depth) this.select(index + 1);
		} else if (matchesKey(data, "left") || data === "h") {
			if (row.dir && row.expanded) return this.options.model.toggle(row.path);
			const slash = row.path.lastIndexOf("/");
			if (slash > 0) this.select(rows.findIndex((candidate) => candidate.path === row.path.slice(0, slash)));
		} else if (matchesKey(data, "enter")) this.activate(row);
	}

	private previewKey(preview: PreviewState, data: string): void {
		const height = this.options.rows();
		const page = Math.max(1, bodyHeight(height) - 1);
		const max = previewMaxScroll(preview, height);
		const scroll = (to: number) => void (preview.scroll = clamp(to, 0, max));
		if (matchesKey(data, "escape") || data === "q") return this.leavePreview(preview);
		if (matchesKey(data, "up")) scroll(preview.scroll - 1);
		else if (matchesKey(data, "down")) scroll(preview.scroll + 1);
		else if (matchesKey(data, "pageUp")) scroll(preview.scroll - page);
		else if (matchesKey(data, "pageDown")) scroll(preview.scroll + page);
		else if (matchesKey(data, "home")) scroll(0);
		else if (matchesKey(data, "end")) scroll(max);
	}

	private leavePreview(preview: PreviewState): void {
		if (preview.direct) return this.close();
		this.state.mode = "tree";
		this.state.preview = undefined;
		this.select(this.rows.findIndex((row) => row.path === preview.row.path));
	}

	private openPreview(row: TreeRow, direct: boolean): void {
		const preview: PreviewState = { row, scroll: 0, direct };
		this.state.mode = "preview";
		this.state.preview = preview;
		const load = this.options.load ?? loadPreview;
		void load(this.options.model.root, row.path).then(
			(content) => {
				preview.content = content;
				if (!this.closed) this.options.requestRender();
			},
			() => {
				preview.content = { kind: "missing", lines: [], truncated: false, source: "disk" };
				if (!this.closed) this.options.requestRender();
			},
		);
	}
}

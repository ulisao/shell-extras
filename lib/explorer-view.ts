import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TreeRow } from "./file-tree.ts";
import type { FileStatus } from "./git-status.ts";
import { iconFor } from "./icons.ts";

export interface ExplorerTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
	bg?(role: string, text: string): string;
}

/** Color role and right-hand badge per Git status, like VS Code's explorer decorations. */
export const STATUS_STYLE: Readonly<Record<FileStatus, { role: string; badge: string }>> = Object.freeze({
	conflicted: { role: "error", badge: "!" },
	deleted: { role: "error", badge: "D" },
	modified: { role: "warning", badge: "M" },
	renamed: { role: "accent", badge: "R" },
	added: { role: "success", badge: "A" },
	untracked: { role: "success", badge: "U" },
	ignored: { role: "dim", badge: "" },
});

/** Left text, then the right text flush against the edge, exactly `width` columns. */
export function fitLine(left: string, right: string, width: number): string {
	const target = Math.max(0, Math.floor(width));
	const rightWidth = visibleWidth(right);
	if (rightWidth >= target) return truncateToWidth(right, target, "", true);
	const room = target - rightWidth - (right ? 1 : 0);
	const clipped = truncateToWidth(left, room, "…");
	return clipped + " ".repeat(Math.max(0, target - visibleWidth(clipped) - rightWidth)) + right;
}

export interface RowPaint {
	hovered?: boolean;
	selected?: boolean;
	/** Columns before the tree (the rail's panel indent). */
	indent?: number;
}

export function formatTreeRow(row: TreeRow, theme: ExplorerTheme, width: number, paint: RowPaint = {}): string {
	const style = row.status ? STATUS_STYLE[row.status] : undefined;
	const nameRole = style?.role ?? "text";
	const chevron = row.dir ? theme.fg(paint.hovered ? "warning" : "muted", row.expanded ? "▾" : "▸") : " ";
	const iconRole = style?.role ?? (row.dir ? "accent" : "muted");
	const name = theme.fg(nameRole, paint.hovered || paint.selected ? theme.bold(row.name) : row.name);
	const left = `${" ".repeat(paint.indent ?? 2)}${"  ".repeat(row.depth)}${chevron} ${theme.fg(iconRole, iconFor(row.name, row.dir, row.expanded))} ${name}`;
	const badge = style ? (row.dir ? (row.status === "ignored" ? "" : "•") : style.badge) : "";
	const line = fitLine(left, badge ? theme.fg(style!.role, badge) : "", width);
	return paint.selected && theme.bg ? theme.bg("selectedBg", line) : line;
}

export interface ExplorerView {
	collapsed: boolean;
	scrollTop: number;
	/** Body rows available below the header. */
	viewport: number;
	/** Path under the pointer. */
	hover?: string;
	headerHovered?: boolean;
}

export interface ExplorerFrame {
	lines: string[];
	/** The clamped scroll position this frame used. */
	scrollTop: number;
	maxScroll: number;
	/** The rows drawn below the header, in order. */
	shown: TreeRow[];
}

export function renderExplorer(rows: readonly TreeRow[], theme: ExplorerTheme, width: number, view: ExplorerView, info: { changed: number; title?: string }): ExplorerFrame {
	const glyph = theme.fg(view.headerHovered ? "warning" : "muted", view.collapsed ? "▸" : "▾");
	const title = theme.fg(view.headerHovered ? "warning" : "text", theme.bold(info.title ?? "FILES"));
	const count = theme.fg(info.changed ? "warning" : "muted", info.changed ? `${info.changed} changed` : "clean");
	const header = fitLine(`${glyph} ${title}`, count, width);
	if (view.collapsed) return { lines: [header], scrollTop: view.scrollTop, maxScroll: 0, shown: [] };
	const viewport = Math.max(1, Math.floor(view.viewport));
	const maxScroll = Math.max(0, rows.length - viewport);
	const top = Math.min(Math.max(0, Math.floor(view.scrollTop)), maxScroll);
	const clipped = rows.length > viewport && top < maxScroll;
	const shown = rows.slice(top, top + (clipped ? viewport - 1 : viewport));
	const lines = [header, ...shown.map((row) => formatTreeRow(row, theme, width, { hovered: row.path === view.hover }))];
	if (clipped) lines.push(fitLine(`  ${theme.fg("accent", "↓")} ${theme.fg("muted", `${rows.length - top - shown.length} more · scroll`)}`, "", width));
	return { lines, scrollTop: top, maxScroll, shown };
}

/** What a part-local row `y` of a rendered frame points at. */
export function hitExplorer(frame: ExplorerFrame, y: number): { kind: "header" } | { kind: "row"; row: TreeRow } | undefined {
	if (y === 0) return { kind: "header" };
	const row = frame.shown[y - 1];
	return row ? { kind: "row", row } : undefined;
}

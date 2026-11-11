import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { hitExplorer, renderExplorer, STATUS_STYLE } from "../lib/explorer-view.ts";
import { iconFor } from "../lib/icons.ts";
import type { TreeRow } from "../lib/file-tree.ts";

const CODES: Record<string, number> = { text: 30, muted: 31, dim: 32, accent: 33, success: 34, warning: 35, error: 36 };
const theme = {
	fg: (role: string, text: string) => `\x1b[${CODES[role] ?? 39}m${text}\x1b[39m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const painted = (line: string, role: string, text: string) => line.includes(`\x1b[${CODES[role]}m${text}`);

const rows: TreeRow[] = [
	{ path: "node_modules", name: "node_modules", depth: 0, dir: true, expanded: false, status: "ignored" },
	{ path: "src", name: "src", depth: 0, dir: true, expanded: true, status: "modified" },
	{ path: "src/main.ts", name: "main.ts", depth: 1, dir: false, expanded: false, status: "modified" },
	{ path: "src/new.ts", name: "new.ts", depth: 1, dir: false, expanded: false, status: "untracked" },
	{ path: "src/old.ts", name: "old.ts", depth: 1, dir: false, expanded: false, status: "deleted" },
	{ path: "README.md", name: "README.md", depth: 0, dir: false, expanded: false },
];

test("the explorer renders a panel header and one exact-width row per visible path", () => {
	const frame = renderExplorer(rows, theme, 32, { collapsed: false, scrollTop: 0, viewport: 20 }, { changed: 3 });
	const text = frame.lines.map(strip);
	assert.deepEqual(text, [
		"▾ FILES".padEnd(32 - "3 changed".length) + "3 changed",
		`  ▸ ${iconFor("node_modules", true, false)} node_modules`.padEnd(32),
		`  ▾ ${iconFor("src", true, true)} src`.padEnd(31) + "•",
		`      ${iconFor("main.ts", false, false)} main.ts`.padEnd(31) + "M",
		`      ${iconFor("new.ts", false, false)} new.ts`.padEnd(31) + "U",
		`      ${iconFor("old.ts", false, false)} old.ts`.padEnd(31) + "D",
		`    ${iconFor("README.md", false, false)} README.md`.padEnd(32),
	]);
	for (const line of frame.lines) assert.equal(visibleWidth(line), 32);
});

test("status colors follow the git state of each row", () => {
	const frame = renderExplorer(rows, theme, 40, { collapsed: false, scrollTop: 0, viewport: 20 }, { changed: 3 });
	const [, ignored, folder, modified, untracked, deleted, clean] = frame.lines as string[];
	assert.ok(painted(ignored!, "dim", "node_modules"), "ignored paths are dimmed");
	assert.ok(painted(folder!, STATUS_STYLE.modified.role, "src") && painted(folder!, STATUS_STYLE.modified.role, "•"), "folders take their most urgent child status");
	assert.ok(painted(modified!, "warning", "main.ts") && painted(modified!, "warning", "M"));
	assert.ok(painted(untracked!, "success", "new.ts") && painted(untracked!, "success", "U"));
	assert.ok(painted(deleted!, "error", "old.ts") && painted(deleted!, "error", "D"));
	assert.ok(painted(clean!, "text", "README.md"), "tracked clean files use the plain text role");
	assert.deepEqual(Object.fromEntries(Object.entries(STATUS_STYLE).map(([status, style]) => [status, style.badge])), { conflicted: "!", deleted: "D", modified: "M", renamed: "R", added: "A", untracked: "U", ignored: "" });
});

test("a collapsed explorer shows only its header", () => {
	const frame = renderExplorer(rows, theme, 32, { collapsed: true, scrollTop: 0, viewport: 20 }, { changed: 0 });
	assert.deepEqual(frame.lines.map(strip), ["▸ FILES".padEnd(32 - "clean".length) + "clean"]);
	assert.deepEqual(hitExplorer(frame, 0), { kind: "header" });
	assert.equal(hitExplorer(frame, 1), undefined);
});

test("a long tree scrolls inside its viewport and clicks map to the shown rows", () => {
	const many: TreeRow[] = Array.from({ length: 10 }, (_, index) => ({ path: `f${index}.ts`, name: `f${index}.ts`, depth: 0, dir: false, expanded: false }));
	const top = renderExplorer(many, theme, 30, { collapsed: false, scrollTop: 0, viewport: 4 }, { changed: 0 });
	assert.equal(top.maxScroll, 6);
	assert.deepEqual(top.lines.map(strip).slice(1).map((line) => line.trim()), [`${iconFor("f0.ts", false, false)} f0.ts`, `${iconFor("f1.ts", false, false)} f1.ts`, `${iconFor("f2.ts", false, false)} f2.ts`, "↓ 7 more · scroll"]);
	assert.deepEqual(hitExplorer(top, 2), { kind: "row", row: many[1] });
	assert.equal(hitExplorer(top, 4), undefined, "the more row is not a path");
	const end = renderExplorer(many, theme, 30, { collapsed: false, scrollTop: 99, viewport: 4 }, { changed: 0 });
	assert.equal(end.scrollTop, 6, "scrolling clamps to the last page");
	assert.deepEqual(end.lines.map(strip).slice(1).map((line) => line.trim().split(" ").pop()), ["f6.ts", "f7.ts", "f8.ts", "f9.ts"]);
	assert.deepEqual(hitExplorer(end, 4), { kind: "row", row: many[9] });
});

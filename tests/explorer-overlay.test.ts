import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ExplorerModel } from "../lib/explorer-model.ts";
import { ExplorerOverlay, renderOverlay, type OverlayState } from "../lib/explorer-overlay.ts";
import { iconFor } from "../lib/icons.ts";
import type { ListDir, TreeRow } from "../lib/file-tree.ts";
import type { GitRunner } from "../lib/git-status.ts";
import type { PreviewContent } from "../lib/preview.ts";

const CODES: Record<string, number> = { text: 30, muted: 31, dim: 32, accent: 33, success: 34, warning: 35, error: 36 };
const theme = {
	fg: (role: string, text: string) => `\x1b[${CODES[role] ?? 39}m${text}\x1b[39m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
	bg: (role: string, text: string) => `\x1b[7m[${role}]${text}\x1b[27m`,
};
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

const KEY = { up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", pageUp: "\x1b[5~", pageDown: "\x1b[6~", home: "\x1b[H", end: "\x1b[F", enter: "\r", esc: "\x1b" };

const disk: Record<string, { name: string; dir: boolean }[]> = {
	"": [{ name: "src", dir: true }, { name: "docs", dir: true }, { name: "a.ts", dir: false }, { name: "logo.png", dir: false }],
	src: [{ name: "main.ts", dir: false }, { name: "util.ts", dir: false }, { name: "nested", dir: true }],
	"src/nested": [{ name: "deep.ts", dir: false }],
	docs: [{ name: "readme.md", dir: false }],
};
const list: ListDir = (path) => disk[path] ?? [];
const git: GitRunner = async (_cwd, args) => (args[0] === "rev-parse" ? "/repo\n" : [" M src/main.ts", "?? a.ts", " D src/gone.ts", ""].join("\0"));

const text = (lines: string[], source: PreviewContent["source"] = "disk"): PreviewContent => ({ kind: "text", lines, truncated: false, source });
const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`);

interface Harness {
	overlay: ExplorerOverlay;
	model: ExplorerModel;
	closed: number;
	renders: number;
	loads: string[];
	terminal: { rows: number };
	frame(width?: number): string[];
	press(...keys: string[]): void;
}

async function harness(options: { rows?: number; preview?: string; contents?: Record<string, PreviewContent> } = {}): Promise<Harness> {
	const model = new ExplorerModel("/repo", { git, list: () => list });
	await model.refresh();
	const terminal = { rows: options.rows ?? 12 };
	const contents = options.contents ?? {};
	const state = { closed: 0, renders: 0, loads: [] as string[] };
	const overlay = new ExplorerOverlay({
		model,
		theme,
		rows: () => terminal.rows,
		requestRender: () => void state.renders++,
		close: () => void state.closed++,
		load: async (_root, path) => {
			state.loads.push(path);
			return contents[path] ?? text([`content of ${path}`]);
		},
		preview: options.preview ? model.rows.find((row) => row.path === options.preview) : undefined,
	});
	const view: Harness = {
		overlay,
		model,
		terminal,
		get closed() {
			return state.closed;
		},
		get renders() {
			return state.renders;
		},
		loads: state.loads,
		frame: (width = 60) => overlay.render(width).map(strip),
		press: (...keys) => keys.forEach((key) => overlay.handleInput(key)),
	};
	return view;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("S2 tree mode: a title row with the root and key hints, then one exact-width row per path filling the terminal", async () => {
	const view = await harness({ rows: 9 });
	const lines = view.overlay.render(70);
	assert.equal(lines.length, 9, "the frame fills the terminal rows");
	for (const line of lines) assert.equal(visibleWidth(line), 70);
	const plain = lines.map(strip);
	assert.ok(plain[0]!.startsWith(" FILES  /repo"), plain[0]);
	assert.ok(/esc close\s*$/.test(plain[0]!), "key hints sit at the right edge");
	assert.ok(plain[1]!.includes(`▸ ${iconFor("docs", true, false)} docs`));
	assert.ok(plain[2]!.includes("src") && plain[2]!.trimEnd().endsWith("•"), "folders carry the status of their children (S3)");
	assert.ok(plain[3]!.includes("a.ts") && plain[3]!.trimEnd().endsWith("U"), "untracked files show U (S3)");
	assert.equal(plain[5]!.trim(), "", "unused rows are blank but still full width");
	assert.ok(lines[1]!.includes("[selectedBg]"), "the first row starts selected");
});

test("S2 tree mode: up/k/down/j/pageUp/pageDown/home/end move the selection and keep it visible", async () => {
	const view = await harness({ rows: 4 }); // 3 body rows for 4 paths
	const selected = () => strip(view.overlay.render(60).find((line) => line.includes("[selectedBg]"))!);
	assert.ok(selected().includes("docs"));
	view.press("j");
	assert.ok(selected().includes("src"));
	view.press(KEY.down, KEY.down);
	assert.ok(selected().includes("logo.png"), "moving past the last visible row scrolls");
	assert.ok(!view.frame().join("\n").includes("docs"), "the first row scrolled out");
	view.press(KEY.down);
	assert.ok(selected().includes("logo.png"), "down stops at the last row");
	view.press("k");
	assert.ok(selected().includes("a.ts"));
	view.press(KEY.home);
	assert.ok(selected().includes("docs") && view.frame().join("\n").includes("docs"), "home returns to the first row");
	view.press(KEY.end);
	assert.ok(selected().includes("logo.png"));
	view.press(KEY.pageUp);
	assert.ok(selected().includes("src"), "pageUp moves a page: body height minus one is 2 rows");
	view.press(KEY.pageDown);
	assert.ok(selected().includes("logo.png"), "pageDown moves a page");
	view.press(KEY.up, KEY.up, KEY.pageUp);
	assert.ok(selected().includes("docs"), "pageUp stops at the first row");
	view.press(KEY.pageDown);
	assert.ok(selected().includes("a.ts"));
	assert.ok(view.renders >= 8, "every key requests a render");
});

test("S2 tree mode: right/l expand, left/h collapse or jump to the parent, enter toggles a folder", async () => {
	const view = await harness({ rows: 14 });
	const names = () => view.model.rows.map((row) => row.path);
	view.press(KEY.right);
	assert.deepEqual(names().slice(0, 3), ["docs", "docs/readme.md", "src"], "right expands the selected folder");
	view.press(KEY.right);
	assert.equal(view.frame().findIndex((line) => line.includes("readme.md")), 2, "right on an open folder enters it");
	view.press(KEY.left);
	assert.ok(view.frame()[1]!.includes("docs"), "left on a file jumps to its parent folder");
	view.press(KEY.left);
	assert.deepEqual(names().slice(0, 2), ["docs", "src"], "left on an open folder collapses it");
	view.press("l");
	assert.equal(names()[1], "docs/readme.md");
	view.press("h");
	assert.equal(names()[1], "src");
	view.press(KEY.enter);
	assert.equal(names()[1], "docs/readme.md", "enter toggles a folder open");
	view.press(KEY.enter);
	assert.equal(names()[1], "src", "and closed");
	view.press(KEY.left);
	assert.equal(names()[0], "docs", "left on a top-level collapsed folder stays put");
	assert.equal(view.closed, 0);
});

test("S6 enter on a file opens the preview and esc or q returns to the tree with that file selected", async () => {
	const view = await harness({ rows: 14, contents: { "a.ts": text(["const a = 1;", "export default a;"]) } });
	view.press(KEY.end, KEY.up); // a.ts
	view.press(KEY.enter);
	await tick();
	assert.deepEqual(view.loads, ["a.ts"]);
	const preview = view.frame(50);
	assert.ok(preview[0]!.includes(iconFor("a.ts", false, false)) && preview[0]!.includes("a.ts") && preview[0]!.includes("U"), "title: icon, path and status badge");
	assert.ok(preview[0]!.includes("1-2/2"));
	assert.equal(preview[1], "   1 │ const a = 1;".padEnd(50));
	assert.equal(preview[2], "   2 │ export default a;".padEnd(50));
	view.press(KEY.esc);
	assert.ok(view.frame()[0]!.startsWith(" FILES"), "esc goes back to the tree");
	assert.ok(view.overlay.render(60).some((line) => line.includes("[selectedBg]") && line.includes("a.ts")), "with that file selected");
	assert.equal(view.closed, 0);
	view.press(KEY.enter);
	await tick();
	view.press("q");
	assert.ok(view.frame()[0]!.startsWith(" FILES"), "q also goes back");
	view.press("q");
	assert.equal(view.closed, 1, "esc or q in the tree closes the overlay");
	view.press(KEY.esc);
	assert.equal(view.closed, 2);
});

test("S6 an overlay opened straight in preview closes on esc", async () => {
	const view = await harness({ rows: 8, preview: "a.ts" });
	await tick();
	assert.deepEqual(view.loads, ["a.ts"]);
	assert.ok(view.frame()[1]!.includes("content of a.ts"));
	view.press(KEY.esc);
	assert.equal(view.closed, 1);
});

test("S6 preview lines are numbered, truncated to the width without wrapping, and scroll with the keys", async () => {
	const long = "x".repeat(200);
	const view = await harness({ rows: 6, preview: "a.ts", contents: { "a.ts": text([long, ...numbered(120).slice(1)]) } });
	await tick();
	let frame = view.frame(40);
	assert.equal(frame.length, 6);
	for (const line of view.overlay.render(40)) assert.equal(visibleWidth(line), 40);
	assert.ok(frame[0]!.includes("1-5/120"), frame[0]);
	assert.ok(frame[1]!.startsWith("   1 │ xxx") && frame[1]!.length === 40, "long lines are cut, not wrapped");
	assert.equal(frame[2], "   2 │ line 2".padEnd(40));
	view.press(KEY.down, KEY.down);
	assert.ok(view.frame(40)[0]!.includes("3-7/120"));
	view.press(KEY.up);
	assert.ok(view.frame(40)[0]!.includes("2-6/120"));
	view.press(KEY.pageDown);
	assert.ok(view.frame(40)[0]!.includes("6-10/120"), "a page is the body height minus one");
	view.press(KEY.pageUp);
	assert.ok(view.frame(40)[0]!.includes("2-6/120"));
	view.press(KEY.end);
	frame = view.frame(40);
	assert.ok(frame[0]!.includes("116-120/120"));
	assert.equal(frame[5], " 120 │ line 120".padEnd(40));
	view.press(KEY.down);
	assert.ok(view.frame(40)[0]!.includes("116-120/120"), "scrolling stops at the end");
	view.press(KEY.home);
	assert.ok(view.frame(40)[0]!.includes("1-5/120"));
});

test("S3 a deleted file previews its last commit and says so", async () => {
	const model = new ExplorerModel("/repo", { git, list: () => list });
	await model.refresh();
	model.toggle("src");
	const overlay = new ExplorerOverlay({
		model,
		theme,
		rows: () => 8,
		requestRender() {},
		close() {},
		load: async () => text(["old"], "HEAD"),
		preview: model.rows.find((row) => row.path === "src/gone.ts"),
	});
	await tick();
	const title = strip(overlay.render(70)[0]!);
	assert.ok(title.includes("src/gone.ts") && title.includes("D") && title.includes("HEAD"), title);
	assert.ok(strip(overlay.render(70)[1]!).includes("1 │ old"));
});

test("S6 binary, missing and folder previews are a single message line", async () => {
	for (const [kind, message] of [["binary", "Binary file"], ["missing", "File not found"], ["dir", "Folder"]] as const) {
		const view = await harness({ rows: 6, preview: "a.ts", contents: { "a.ts": { kind, lines: [], truncated: false, source: "disk" } } });
		await tick();
		const frame = view.frame(40);
		assert.ok(frame[1]!.includes(message), `${kind}: ${frame[1]}`);
		assert.equal(frame.slice(2).join("").trim(), "", `${kind}: nothing else`);
		assert.equal(frame.length, 6);
		view.press(KEY.down, KEY.pageDown, KEY.end);
		assert.ok(view.frame(40)[1]!.includes(message), "scrolling a message is harmless");
	}
});

test("S6 the mouse wheel scrolls the tree and the preview", async () => {
	const view = await harness({ rows: 4 });
	const wheel = (delta: number) => view.overlay.handleMouse({ type: "wheel", button: "none", wheelDelta: delta, x: 3, y: 2, screenX: 3, screenY: 2, width: 60, height: 4, shift: false, alt: false, ctrl: false });
	assert.deepEqual(wheel(1), { handled: true, render: true });
	assert.ok(!view.frame().join("\n").includes("docs"), "wheel down scrolls the tree");
	wheel(-5);
	assert.ok(view.frame()[1]!.includes("docs"), "wheel up scrolls back and clamps at the top");
	wheel(99);
	assert.ok(view.frame()[3]!.includes("logo.png"), "wheel down clamps at the end");
	const preview = await harness({ rows: 4, preview: "a.ts", contents: { "a.ts": text(numbered(30)) } });
	await tick();
	preview.overlay.handleMouse({ type: "wheel", button: "none", wheelDelta: 2, x: 3, y: 2, screenX: 3, screenY: 2, width: 60, height: 4, shift: false, alt: false, ctrl: false });
	assert.ok(preview.frame()[0]!.includes("3-5/30"));
});

test("S6 a left click on a tree row selects it and activates it in the same click", async () => {
	const view = await harness({ rows: 14 });
	const click = (y: number, button: "left" | "right" = "left") => view.overlay.handleMouse({ type: "click", button, x: 4, y, screenX: 4, screenY: y, width: 60, height: 14, shift: false, alt: false, ctrl: false });
	assert.deepEqual(click(2), { handled: true, render: true });
	assert.ok(view.model.expanded.has("src"), "clicking a folder toggles it");
	assert.ok(view.overlay.render(60).some((line) => line.includes("[selectedBg]") && strip(line).includes("src")));
	click(0);
	assert.equal(view.loads.length, 0, "the title row is not a path");
	click(3, "right");
	assert.ok(view.model.expanded.has("src") && view.loads.length === 0, "only the left button activates");
	const fileY = view.frame().findIndex((line) => line.includes("a.ts"));
	click(fileY);
	await tick();
	assert.deepEqual(view.loads, ["a.ts"], "clicking a file opens its preview");
	assert.ok(view.frame()[0]!.includes("a.ts"));
	click(1);
	assert.ok(view.frame()[0]!.includes("a.ts"), "a click inside the preview changes nothing");
});

test("every rendered line of either mode is exactly width columns and the frame fills the rows", async () => {
	const rows: TreeRow[] = Array.from({ length: 30 }, (_, index) => ({ path: `f${index}.ts`, name: `f${index}.ts`, depth: index % 3, dir: false, expanded: false, status: index % 2 ? "modified" : undefined }));
	const state: OverlayState = { mode: "tree", selected: "f3.ts", top: 2 };
	for (const [width, height] of [[1, 1], [10, 3], [40, 12], [200, 50]] as const) {
		const tree = renderOverlay(state, rows, "/r", theme, width, height);
		assert.equal(tree.length, height);
		for (const line of tree) assert.equal(visibleWidth(line), width, `tree ${width}x${height}`);
		const preview = renderOverlay({ ...state, mode: "preview", preview: { row: rows[0]!, content: text(numbered(50)), scroll: 4, direct: false } }, rows, "/r", theme, width, height);
		assert.equal(preview.length, height);
		for (const line of preview) assert.equal(visibleWidth(line), width, `preview ${width}x${height}`);
	}
});

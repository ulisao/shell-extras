import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import fileExplorer from "../extensions/file-explorer.ts";

const SIDEBAR = Symbol.for("gentle-pi.experimental-sidebar.state");
const KEY = "shell-extras.files";
const theme = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
	bg: (_role: string, text: string) => text,
};
const OVERLAY_OPTIONS = { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" };

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition: () => boolean, what: string, ms = 4000): Promise<void> {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

type Handler = (event: unknown, ctx: any) => unknown;

/** A temp Git repo: tracked.ts committed, new.ts untracked, src/ with two files, extra files optional. */
function makeRepo(t: TestContext, extra = 0): string {
	const root = mkdtempSync(join(tmpdir(), "shell-extras-ext-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "test");
	writeFileSync(join(root, "tracked.ts"), "export const tracked = 1;\n");
	git("add", ".");
	git("commit", "-q", "-m", "base");
	writeFileSync(join(root, "new.ts"), "export const fresh = 1;\n");
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "a.ts"), "a\n");
	writeFileSync(join(root, "src", "b.ts"), "b\n");
	for (let index = 0; index < extra; index++) writeFileSync(join(root, `extra${String(index).padStart(2, "0")}.ts`), "x\n");
	return root;
}

interface Fixture {
	root: string;
	handlers: Map<string, Handler>;
	commands: Map<string, { description?: string; handler: (args: string, ctx: any) => Promise<void> }>;
	widgets: Map<string, { factory: unknown; options: unknown }>;
	customs: Array<{ options: any; done: unknown[]; component?: any; tui: { renders: Array<boolean | undefined> } }>;
	notices: string[];
	ctx: any;
	renders: Array<boolean | undefined>;
	tui: any;
	fire(event: string): Promise<void>;
	mount(tui?: any): { bottom: any; part: any; state: any };
}

function fixture(t: TestContext, options: { mode?: string; extra?: number; env?: Record<string, string> } = {}): Fixture {
	const env = { SHELL_EXTRAS_FILES_POLL_MS: "0", ...(options.env ?? {}) };
	Object.assign(process.env, env);
	t.after(() => {
		for (const name of Object.keys(env)) delete process.env[name];
	});
	const root = makeRepo(t, options.extra);
	const handlers = new Map<string, Handler>();
	const commands: Fixture["commands"] = new Map();
	const widgets: Fixture["widgets"] = new Map();
	const customs: Fixture["customs"] = [];
	const notices: string[] = [];
	const renders: Array<boolean | undefined> = [];
	const tui = { terminal: { rows: 40, columns: 160 }, requestRender: (force?: boolean) => void renders.push(force) };
	const ctx = {
		mode: options.mode ?? "tui",
		cwd: root,
		ui: {
			setWidget: (key: string, factory: unknown, widgetOptions?: unknown) => {
				if (factory === undefined) widgets.delete(key);
				else widgets.set(key, { factory, options: widgetOptions });
			},
			notify: (message: string) => void notices.push(message),
			custom: (factory: any, customOptions: any) =>
				new Promise((resolve) => {
					const overlayTui = { terminal: { rows: 20, columns: 100 }, renders: [] as Array<boolean | undefined>, requestRender(force?: boolean) { this.renders.push(force); } };
					const record: Fixture["customs"][number] = { options: customOptions, done: [], tui: overlayTui };
					customs.push(record);
					Promise.resolve(factory(overlayTui, theme, {}, (value: unknown) => (record.done.push(value), resolve(value)))).then((component) => (record.component = component));
				}),
		},
	};
	const pi = {
		on: (event: string, handler: Handler) => void handlers.set(event, handler),
		registerCommand: (name: string, command: any) => void commands.set(name, command),
	};
	fileExplorer(pi as any);
	const view: Fixture = {
		root,
		handlers,
		commands,
		widgets,
		customs,
		notices,
		ctx,
		renders,
		tui,
		fire: async (event) => void (await handlers.get(event)?.({ type: event }, ctx)),
		mount: (mountTui = tui) => {
			const bottom = (widgets.get(KEY)!.factory as any)(mountTui, theme);
			const state = mountTui.terminal?.[SIDEBAR];
			return { bottom, part: state?.parts.get(KEY), state };
		},
	};
	t.after(async () => {
		await view.fire("session_shutdown");
		// A refresh still running keeps the directory busy on Windows for a moment.
		await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	});
	return view;
}

const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const mouse = (partial: Record<string, unknown>) => ({ type: "click", button: "left", x: 3, y: 0, screenX: 3, screenY: 0, width: 60, height: 20, shift: false, alt: false, ctrl: false, ...partial });
const lines = (part: any, width = 60): string[] => part.render(width).map(strip);

test("S7 the package registers /files and, outside the TUI, adds no widget", async (t) => {
	const view = fixture(t, { mode: "print" });
	assert.equal(view.commands.get("files")?.description, "Browse the repository files with their Git status");
	assert.ok(view.handlers.has("session_start") && view.handlers.has("session_shutdown") && view.handlers.has("turn_end") && view.handlers.has("agent_end"));
	await view.fire("session_start");
	assert.equal(view.widgets.size, 0);
});

test("S7 in the TUI a below-editor widget registers the rail part with the section hook contract", async (t) => {
	const view = fixture(t, { env: { SHELL_EXTRAS_FILES_ORDER: "70" } });
	await view.fire("session_start");
	assert.deepEqual(view.widgets.get(KEY)?.options, { placement: "belowEditor" });
	const { bottom, part, state } = view.mount();
	assert.deepEqual(bottom.render(80), [], "the bottom widget draws nothing");
	assert.equal(typeof bottom.dispose, "function");
	assert.deepEqual(part.section, { order: 70 });
	assert.equal(part.surface, "panel");
	for (const method of ["digest", "render", "invalidate", "handleMouse"]) assert.equal(typeof part[method], "function", method);
	assert.equal(state.active, false, "a freshly created shared state is inactive");
	assert.ok(state.parts instanceof Map);
});

test("S7 the order defaults to 50, and an existing shared state is reused", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const existing = { active: true, parts: new Map([["other", { id: 1 }]]) };
	(view.tui.terminal as any)[SIDEBAR] = existing;
	const { part, state } = view.mount();
	assert.equal(state, existing);
	assert.deepEqual(part.section, { order: 50 });
	assert.deepEqual([...existing.parts.keys()], ["other", KEY]);
});

test("S7 a TUI without a terminal gets the widget but no rail part", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const bottom = (view.widgets.get(KEY)!.factory as any)({ requestRender() {} }, theme);
	assert.deepEqual(bottom.render(80), []);
	bottom.dispose();
});

test("S7 dispose removes only the part this widget registered", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const first = view.mount();
	first.bottom.dispose();
	assert.equal(first.state.parts.has(KEY), false, "its own part is removed");
	const second = view.mount();
	const replacement = { replaced: true };
	second.state.parts.set(KEY, replacement);
	second.bottom.dispose();
	assert.equal(second.state.parts.get(KEY), replacement, "a part registered by someone else stays");
});

test("S2-S4 the rail part renders the tree of the repository with its Git status", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const { part } = view.mount();
	await until(() => lines(part).some((line) => line.includes("new.ts")), "the first refresh");
	const out = lines(part);
	assert.ok(/^▾ FILES\s+3 changed$/.test(out[0]!), out[0]);
	assert.ok(out.some((line) => line.includes("src") && line.trimEnd().endsWith("•")));
	assert.ok(out.some((line) => line.includes("new.ts") && line.trimEnd().endsWith("U")));
	assert.ok(out.some((line) => line.includes("tracked.ts") && !/[A-Z]$/.test(line.trimEnd())));
	for (const line of part.render(45)) assert.equal(visibleWidth(line), 45);
	assert.ok(view.renders.length > 0, "the model asked the TUI to repaint when the first refresh landed");
});

test("S3 the rail viewport is 45% of the terminal rows (at least 5) minus the header", async (t) => {
	const view = fixture(t, { extra: 40 });
	await view.fire("session_start");
	const { part } = view.mount();
	await until(() => lines(part).length > 10, "the first refresh");
	assert.equal(part.render(60).length, 18, "40 rows: floor(40*0.45)=18 body+header lines");
	view.tui.terminal.rows = 8;
	assert.equal(part.render(60).length, 5, "tiny terminals still get 5 lines");
});

test("the digest covers version, collapsed, scrollTop, hover, header hover and viewport size", async (t) => {
	const view = fixture(t, { extra: 40 });
	await view.fire("session_start");
	const { part, state } = view.mount();
	await until(() => lines(part).length > 10, "the first refresh");
	part.render(60);
	const digests = new Set([part.digest()]);
	const distinct = (what: string) => {
		const before = digests.size;
		digests.add(part.digest());
		assert.equal(digests.size, before + 1, `${what} changes the digest`);
	};
	part.handleMouse(mouse({ type: "wheel", button: "none", y: 3, wheelDelta: 2 }));
	part.render(60);
	distinct("scrolling");
	part.handleMouse(mouse({ type: "move", button: "none", y: 0 }));
	distinct("header hover");
	part.handleMouse(mouse({ type: "move", button: "none", y: 2 }));
	distinct("row hover");
	view.tui.terminal.rows = 60;
	distinct("the viewport size");
	part.handleMouse(mouse({ type: "click", y: 0 }));
	distinct("collapsing");
	part.handleMouse(mouse({ type: "click", y: 0 }));
	part.handleMouse(mouse({ type: "wheel", button: "none", y: 3, wheelDelta: -10 }));
	part.render(60);
	const folder = lines(part).findIndex((line) => line.includes("src"));
	const before = part.digest();
	part.handleMouse(mouse({ type: "click", y: folder }));
	assert.notEqual(part.digest(), before, "the model version changes the digest");
	assert.equal(state.parts.get(KEY), part);
});

test("S2 a left click on the header collapses and expands the section, other buttons do nothing", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const { part } = view.mount();
	await until(() => lines(part).length > 3, "the first refresh");
	assert.equal(part.handleMouse(mouse({ y: 0, button: "right" })), undefined);
	assert.ok(lines(part).length > 1);
	const before = view.renders.length;
	assert.deepEqual(part.handleMouse(mouse({ y: 0 })), { handled: true, render: true });
	assert.equal(lines(part).length, 1, "collapsed: only the header");
	assert.ok(view.renders.length > before, "a state change requests a render");
	part.handleMouse(mouse({ y: 0 }));
	assert.ok(lines(part).length > 1);
});

test("S2 a click on a folder row toggles it", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const { part } = view.mount();
	await until(() => lines(part).some((line) => line.includes("src")), "the first refresh");
	const y = lines(part).findIndex((line) => line.includes("src"));
	assert.deepEqual(part.handleMouse(mouse({ y })), { handled: true, render: true });
	assert.ok(lines(part).some((line) => line.includes("a.ts")), "the folder opened");
	part.handleMouse(mouse({ y }));
	assert.ok(!lines(part).some((line) => line.includes("a.ts")), "and closed");
});

test("S6 a click on a file row opens the overlay in preview mode and closing repaints fully", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const { part } = view.mount();
	await until(() => lines(part).some((line) => line.includes("new.ts")), "the first refresh");
	const y = lines(part).findIndex((line) => line.includes("new.ts"));
	assert.deepEqual(part.handleMouse(mouse({ y })), { handled: true, render: true });
	await until(() => view.customs[0]?.component !== undefined, "the overlay");
	const record = view.customs[0]!;
	assert.deepEqual(record.options, { overlay: true, overlayOptions: OVERLAY_OPTIONS });
	await until(() => strip(record.component.render(60).join("\n")).includes("1 │ export const fresh = 1;"), "the preview content");
	const title = strip(record.component.render(60)[0]);
	assert.ok(title.includes("new.ts") && title.includes("U"), title);
	assert.equal(record.component.render(60).length, 20, "the overlay fills the terminal rows");
	record.component.handleInput("\x1b");
	assert.deepEqual(record.done, [null], "done(null)");
	assert.deepEqual(record.tui.renders.at(-1), true, "then a forced full repaint");
	await tick();
	part.handleMouse(mouse({ y }));
	await until(() => view.customs.length === 2, "the overlay can open again after closing");
});

test("S6 /files opens the keyboard explorer in tree mode", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	await tick();
	const done = view.commands.get("files")!.handler("", view.ctx);
	await until(() => view.customs[0]?.component !== undefined, "the overlay");
	const record = view.customs[0]!;
	assert.deepEqual(record.options, { overlay: true, overlayOptions: OVERLAY_OPTIONS });
	await until(() => strip(record.component.render(80).join("\n")).includes("tracked.ts"), "the tree");
	assert.ok(strip(record.component.render(80)[0]).startsWith(" FILES"));
	record.component.handleInput("q");
	assert.deepEqual(record.done, [null]);
	await done;
});

test("S2 the wheel scrolls the rail only when the rows exceed the viewport", async (t) => {
	const few = fixture(t);
	await few.fire("session_start");
	const small = few.mount();
	await until(() => lines(small.part).length > 3, "the first refresh");
	assert.equal(small.part.handleMouse(mouse({ type: "wheel", button: "none", y: 2, wheelDelta: 3 })), undefined, "everything fits: the rail scrolls instead");

	const many = fixture(t, { extra: 40 });
	await many.fire("session_start");
	const { part } = many.mount();
	await until(() => lines(part).length > 10, "the first refresh");
	assert.equal(lines(part)[1]!.includes("src"), true);
	assert.deepEqual(part.handleMouse(mouse({ type: "wheel", button: "none", y: 2, wheelDelta: 4 })), { handled: true, render: true });
	assert.equal(lines(part)[1]!.includes("src"), false, "the viewport moved down");
	part.handleMouse(mouse({ type: "wheel", button: "none", y: 2, wheelDelta: -50 }));
	assert.equal(lines(part)[1]!.includes("src"), true, "and back, clamped at the top");
	part.handleMouse(mouse({ type: "wheel", button: "none", y: 2, wheelDelta: 500 }));
	assert.ok(lines(part).at(-1)!.includes("tracked.ts"), "clamped at the end");
});

test("hover goes through the shared state.hover contract and the previous owner is cleared", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const { part, state } = view.mount();
	await until(() => lines(part).length > 3, "the first refresh");
	let cleared = 0;
	const other = { owner: "someone else", clear: () => void cleared++ };
	state.hover = other;
	const before = view.renders.length;
	part.handleMouse(mouse({ type: "move", button: "none", y: 2 }));
	assert.equal(cleared, 1, "the previous owner's clear ran");
	assert.equal(state.hover.owner, part);
	assert.notEqual(state.hover, other);
	assert.ok(view.renders.length > before, "hover requests a render");
	assert.ok(lines(part).length > 0);
	part.handleMouse(mouse({ type: "move", button: "none", y: 3 }));
	assert.equal(cleared, 1, "the owner is not cleared again by its own moves");
	const hovered = part.digest();
	state.hover.clear();
	assert.notEqual(part.digest(), hovered, "clear resets hover");
	assert.ok(view.renders.length > before + 1, "and requests a render");
});

test("refresh happens on turn_end and agent_end", async (t) => {
	const view = fixture(t);
	await view.fire("session_start");
	const { part } = view.mount();
	await until(() => lines(part).some((line) => line.includes("new.ts")), "the first refresh");
	writeFileSync(join(view.root, "late.ts"), "x\n");
	await view.fire("turn_end");
	await until(() => lines(part).some((line) => line.includes("late.ts")), "turn_end to refresh");
	writeFileSync(join(view.root, "later.ts"), "x\n");
	await view.fire("agent_end");
	await until(() => lines(part).some((line) => line.includes("later.ts")), "agent_end to refresh");
});

test("polling refreshes only while the rail is visible or the overlay is open, and stops on shutdown", async (t) => {
	const view = fixture(t, { env: { SHELL_EXTRAS_FILES_POLL_MS: "25" } });
	await view.fire("session_start");
	const { part, state } = view.mount();
	await until(() => lines(part).some((line) => line.includes("new.ts")), "the first refresh");
	writeFileSync(join(view.root, "polled.ts"), "x\n");
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.ok(!lines(part).some((line) => line.includes("polled.ts")), "a hidden rail does not poll");
	state.active = true;
	state.ownsHost = () => false;
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.ok(!lines(part).some((line) => line.includes("polled.ts")), "an active rail that does not own the host does not poll");
	state.ownsHost = () => true;
	await until(() => lines(part).some((line) => line.includes("polled.ts")), "a visible rail to poll");
	state.active = false;
	await view.fire("session_shutdown");
	assert.equal(view.widgets.size, 0, "shutdown removes the widget");
	await new Promise((resolve) => setTimeout(resolve, 400)); // let a run already in flight finish
	writeFileSync(join(view.root, "after.ts"), "x\n");
	state.active = true;
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.ok(!lines(part).some((line) => line.includes("after.ts")), "the timer stopped");
	const y = lines(part).findIndex((line) => line.includes("new.ts"));
	part.handleMouse(mouse({ y }));
	await tick();
	assert.equal(view.customs.length, 0, "the context was dropped: a late click opens nothing");
});

test("an open overlay keeps the model polling even when the rail is hidden", async (t) => {
	const view = fixture(t, { env: { SHELL_EXTRAS_FILES_POLL_MS: "25" } });
	await view.fire("session_start");
	const { part } = view.mount();
	void view.commands.get("files")!.handler("", view.ctx);
	await until(() => view.customs[0]?.component !== undefined, "the overlay");
	writeFileSync(join(view.root, "while-open.ts"), "x\n");
	await until(() => lines(part).some((line) => line.includes("while-open.ts")), "polling while the overlay is open");
	assert.ok(strip(view.customs[0]!.component.render(80).join("\n")).includes("while-open.ts"));
	view.customs[0]!.component.handleInput("q");
});

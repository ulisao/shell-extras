import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { registerTabWidget } from "../lib/widget-extension.ts";

const SIDEBAR = Symbol.for("gentle-pi.experimental-sidebar.state");
const HOST = Symbol.for("shell-extras.tabs.host");
const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };

function fixture(t: TestContext, mode = "tui", pollMs = 0) {
	const home = mkdtempSync(join(tmpdir(), "shell-extras-home-"));
	process.env.SHELL_EXTRAS_HOME = home;
	t.after(() => {
		delete process.env.SHELL_EXTRAS_HOME;
		rmSync(home, { recursive: true, force: true });
	});
	const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
	const widgets = new Map<string, any>();
	const ctx = { mode, cwd: "/repo", ui: { setWidget: (key: string, factory: unknown) => (factory === undefined ? widgets.delete(key) : widgets.set(key, factory)) } };
	const pi = { on: (event: string, handler: any) => void handlers.set(event, handler) };
	const refreshes: string[] = [];
	const disposed: string[] = [];
	const control = registerTabWidget(pi as any, {
		key: "k",
		id: "demo",
		label: "Demo",
		order: 30,
		pollMs,
		create: ({ ctx: created }) => ({
			widget: { render: () => [`cwd ${created.cwd}`], digest: () => "d" },
			refresh: () => void refreshes.push("refresh"),
			dispose: () => void disposed.push("dispose"),
		}),
	});
	const tui = { terminal: { rows: 30, columns: 160 }, requestRender() {} };
	const fire = (event: string) => handlers.get(event)?.({ type: event }, ctx);
	return { handlers, widgets, tui, refreshes, disposed, fire, control, mount: () => widgets.get("k")(tui, theme) };
}

test("S3 a tab widget mounts into the shared EXTRAS host and refreshes once", (t) => {
	const f = fixture(t);
	f.fire("session_start");
	const bottom = f.mount();
	assert.deepEqual(bottom.render(80), []);
	const state = (f.tui.terminal as any)[SIDEBAR];
	assert.deepEqual(state[HOST].widget("demo").render(40), ["cwd /repo"]);
	assert.deepEqual(f.refreshes, ["refresh"]);
	f.fire("agent_end");
	assert.deepEqual(f.refreshes, ["refresh", "refresh"]);
	bottom.dispose();
	assert.deepEqual(f.disposed, ["dispose"]);
	assert.equal(state.parts.has("shell-extras.tabs"), false);
	f.fire("session_shutdown");
	assert.equal(f.widgets.has("k"), false);
});

test("S3 outside the TUI no widget is mounted", (t) => {
	const f = fixture(t, "print");
	f.fire("session_start");
	assert.equal(f.widgets.size, 0);
});

test("S3 a tab is visible only while the rail shows it", (t) => {
	const f = fixture(t);
	f.fire("session_start");
	f.mount();
	const state = (f.tui.terminal as any)[SIDEBAR];
	assert.equal(f.control.visible(), false);
	state.active = true;
	state.ownsHost = () => true;
	assert.equal(f.control.visible(), true);
	f.fire("session_shutdown");
});

test("S3 switching to a tab refreshes it", (t) => {
	const f = fixture(t);
	f.fire("session_start");
	f.mount();
	const state = (f.tui.terminal as any)[SIDEBAR];
	state[HOST].add({ id: "other", label: "Other", order: 1, widget: { render: () => [] } });
	state[HOST].select("other");
	f.refreshes.length = 0;
	state[HOST].select("demo");
	assert.deepEqual(f.refreshes, ["refresh"]);
	f.fire("session_shutdown");
});

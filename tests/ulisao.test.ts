import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import ulisao from "../extensions/ulisao.ts";
import { ULISAO_FRAMES, ulisaoFrame } from "../lib/ulisao.ts";

const SIDEBAR = Symbol.for("gentle-pi.experimental-sidebar.state");
const KEY = "shell-extras.ulisao";
const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

test("S1 every frame is a dotted sphere of the same height, right-aligned within the width", () => {
	const heights = new Set<number>();
	for (let index = 0; index < ULISAO_FRAMES; index++) {
		const lines = ulisaoFrame(index, theme, 30).map(strip);
		heights.add(lines.length);
		for (const line of lines) assert.equal(visibleWidth(line), 30);
		assert.ok(lines.join("").match(/[⠁-⣿]/g)!.length > 40, "it is drawn with Braille dots");
		assert.ok(lines.every((line) => line.slice(0, 11).trim() === ""), "right-aligned: only the right 19 columns are drawn");
		assert.notEqual(lines.at(-1)!.trim(), "", "the last row is never blank, so the host keeps the height");
	}
	assert.equal(heights.size, 1, "frames never change the rail height");
	assert.ok(ULISAO_FRAMES >= 24, "a smooth turn");
});

test("S1 the sphere turns: frames differ, and the rim is iridescent", () => {
	const frames = new Set(Array.from({ length: ULISAO_FRAMES }, (_, index) => ulisaoFrame(index, theme, 30).join("\n")));
	assert.ok(frames.size >= 24);
	const colors = new Set(ulisaoFrame(0, theme, 30).join("").match(/\[38;2;[0-9;]+m/g));
	assert.ok(colors.size >= 5, "several colors: a violet core and a shimmering rim");
	assert.deepEqual(ulisaoFrame(ULISAO_FRAMES, theme, 30), ulisaoFrame(0, theme, 30), "the animation loops");
});

test("S1 a narrow rail clips the bot without exceeding the width", () => {
	for (const line of ulisaoFrame(0, theme, 6)) assert.ok(visibleWidth(line) <= 6);
});

function fixture(t: TestContext, env: Record<string, string> = {}) {
	Object.assign(process.env, env);
	t.after(() => {
		for (const name of Object.keys(env)) delete process.env[name];
	});
	const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
	const widgets = new Map<string, any>();
	const ctx = { mode: "tui", ui: { setWidget: (key: string, factory: unknown) => (factory === undefined ? widgets.delete(key) : widgets.set(key, factory)) } };
	ulisao({ on: (event: string, handler: any) => void handlers.set(event, handler) } as any);
	const renders: number[] = [];
	const tui = { terminal: { rows: 30, columns: 160 }, requestRender: () => void renders.push(1) };
	const fire = (event: string) => handlers.get(event)?.({ type: event }, ctx);
	return { widgets, tui, renders, fire };
}

test("S1 the icon is a decorative rail part pinned to the bottom", (t) => {
	const f = fixture(t);
	f.fire("session_start");
	const bottom = f.widgets.get(KEY)(f.tui, theme);
	const state = (f.tui.terminal as any)[SIDEBAR];
	const part = state.parts.get(KEY);
	assert.deepEqual(part.section, { order: 1000, anchor: "bottom" });
	assert.equal(part.handleMouse, undefined, "pure UI: no clicks");
	assert.deepEqual(part.render(30), ulisaoFrame(0, theme, 30));
	assert.deepEqual(bottom.render(80), []);
	bottom.dispose();
	assert.equal(state.parts.has(KEY), false);
	f.fire("session_shutdown");
	assert.equal(f.widgets.has(KEY), false);
});

test("S1 the animation advances only while the rail is shown", async (t) => {
	const f = fixture(t, { SHELL_EXTRAS_ULISAO_MS: "5" });
	f.fire("session_start");
	const bottom = f.widgets.get(KEY)(f.tui, theme);
	const state = (f.tui.terminal as any)[SIDEBAR];
	const part = state.parts.get(KEY);
	const first = part.digest();
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(part.digest(), first, "an inactive rail does not animate");
	state.active = true;
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.notEqual(part.digest(), first);
	assert.ok(f.renders.length > 0);
	bottom.dispose();
	f.fire("session_shutdown");
});

test("S1 SHELL_EXTRAS_ULISAO=0 turns it off", (t) => {
	const f = fixture(t, { SHELL_EXTRAS_ULISAO: "0" });
	f.fire("session_start");
	assert.equal(f.widgets.size, 0);
});

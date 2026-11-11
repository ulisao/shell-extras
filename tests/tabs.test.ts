import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TABS_PART_KEY, tabsHost, type RailWidget } from "../lib/tabs.ts";
import { Settings } from "../lib/settings.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text, bg: (_role: string, text: string) => text };
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const mouse = (partial: Record<string, unknown>) => ({ type: "click", button: "left", x: 0, y: 0, screenX: 0, screenY: 0, width: 48, height: 20, ...partial }) as any;

function settings(t: TestContext): { store: Settings; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "shell-extras-tabs-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "settings.json");
	return { store: new Settings(file), file };
}

function widget(name: string, events: unknown[] = []): RailWidget {
	return { render: () => [`${name} body`], digest: () => name, handleMouse: (event) => (events.push({ name, type: event.type, y: event.y }), { handled: true, render: true }) };
}

function host(t: TestContext) {
	const state = { parts: new Map<string, unknown>() };
	const renders: number[] = [];
	const { store, file } = settings(t);
	const tabs = tabsHost(state, { theme, requestRender: () => void renders.push(1), settings: store });
	return { state, tabs, renders, store, file };
}

test("S3 the host registers one rail section only while it has tabs", (t) => {
	const { state, tabs } = host(t);
	assert.equal(state.parts.has(TABS_PART_KEY), false);
	const files = widget("files");
	tabs.add({ id: "files", label: "Files", order: 10, widget: files });
	const part = state.parts.get(TABS_PART_KEY) as any;
	assert.deepEqual(part.section, { order: 50 });
	tabs.remove("files", files);
	assert.equal(state.parts.has(TABS_PART_KEY), false);
});

test("S3 the same sidebar state always yields the same host", (t) => {
	const { state, tabs, store } = host(t);
	assert.equal(tabsHost(state, { theme, requestRender() {}, settings: store }), tabs);
});

test("S3 the section shows a header, the tab bar on top and only the active tab's content", (t) => {
	const { state, tabs } = host(t);
	tabs.add({ id: "git", label: "Git", order: 20, widget: widget("git") });
	tabs.add({ id: "files", label: "Files", order: 10, widget: widget("files") });
	const lines = (state.parts.get(TABS_PART_KEY) as any).render(48).map(strip);
	assert.match(lines[0], /^▾ EXTRAS/);
	assert.equal(lines[1].trim(), "[ Files ]  Git");
	assert.deepEqual(lines.slice(2), ["files body"]);
	assert.ok(lines.every((line: string) => visibleWidth(line) <= 48));
});

test("S3 a click on a tab switches the content and the choice is saved", (t) => {
	const { state, tabs, file, store } = host(t);
	tabs.add({ id: "files", label: "Files", order: 10, widget: widget("files") });
	tabs.add({ id: "git", label: "Git", order: 20, widget: widget("git") });
	const part = state.parts.get(TABS_PART_KEY) as any;
	const bar = strip(part.render(48)[1]);
	const result = part.handleMouse(mouse({ y: 1, x: bar.indexOf("Git") }));
	assert.deepEqual(result, { handled: true, render: true });
	assert.deepEqual(part.render(48).map(strip).slice(2), ["git body"]);
	assert.equal(JSON.parse(readFileSync(file, "utf8")).activeTab, "git");
	assert.equal(store.get("activeTab"), "git");
});

test("S3 a click between tabs does nothing", (t) => {
	const { state, tabs } = host(t);
	tabs.add({ id: "files", label: "Files", order: 10, widget: widget("files") });
	tabs.add({ id: "git", label: "Git", order: 20, widget: widget("git") });
	const part = state.parts.get(TABS_PART_KEY) as any;
	const bar = strip(part.render(48)[1]);
	assert.equal(part.handleMouse(mouse({ y: 1, x: bar.indexOf("]") + 1 })), undefined);
	assert.deepEqual(part.render(48).map(strip).slice(2), ["files body"]);
});

test("S3 the saved tab is restored by a new host", (t) => {
	const { store } = settings(t);
	store.set("activeTab", "git");
	const state = { parts: new Map<string, unknown>() };
	const tabs = tabsHost(state, { theme, requestRender() {}, settings: store });
	tabs.add({ id: "files", label: "Files", order: 10, widget: widget("files") });
	tabs.add({ id: "git", label: "Git", order: 20, widget: widget("git") });
	assert.deepEqual((state.parts.get(TABS_PART_KEY) as any).render(48).map(strip).slice(2), ["git body"]);
	assert.equal(tabs.isActive("git"), true);
	assert.equal(tabs.isActive("files"), false);
});

test("S3 a click on the header folds the section", (t) => {
	const { state, tabs } = host(t);
	tabs.add({ id: "files", label: "Files", order: 10, widget: widget("files") });
	const part = state.parts.get(TABS_PART_KEY) as any;
	part.handleMouse(mouse({ y: 0 }));
	assert.deepEqual(part.render(48).map(strip).map((line: string) => line.slice(0, 8)), ["▸ EXTRAS"]);
	part.handleMouse(mouse({ y: 0 }));
	assert.equal(part.render(48).length, 3);
});

test("S3 mouse events below the tab bar reach the active widget with widget-local rows", (t) => {
	const { state, tabs } = host(t);
	const events: unknown[] = [];
	tabs.add({ id: "files", label: "Files", order: 10, widget: widget("files", events) });
	const part = state.parts.get(TABS_PART_KEY) as any;
	part.render(48);
	part.handleMouse(mouse({ y: 2 }));
	part.handleMouse(mouse({ type: "wheel", y: 2, wheelDelta: 1 }));
	assert.deepEqual(events, [{ name: "files", type: "click", y: 0 }, { name: "files", type: "wheel", y: 0 }]);
});

test("S3 the digest follows the active widget", (t) => {
	const { state, tabs } = host(t);
	let value = "a";
	tabs.add({ id: "files", label: "Files", order: 10, widget: { render: () => [], digest: () => value } });
	const part = state.parts.get(TABS_PART_KEY) as any;
	const before = part.digest();
	value = "b";
	assert.notEqual(part.digest(), before);
});

test("S3 removing the active tab falls back to the first one", (t) => {
	const { state, tabs } = host(t);
	const git = widget("git");
	tabs.add({ id: "files", label: "Files", order: 10, widget: widget("files") });
	tabs.add({ id: "git", label: "Git", order: 20, widget: git });
	tabs.select("git");
	tabs.remove("git", git);
	assert.deepEqual((state.parts.get(TABS_PART_KEY) as any).render(48).map(strip).slice(1).map((line: string) => line.trimEnd()), ["  [ Files ]", "files body"]);
});

test("settings survive a corrupt file", (t) => {
	const { file } = settings(t);
	const store = new Settings(file);
	store.set("x", 1);
	writeFileSync(file, "{not json");
	assert.equal(new Settings(file).get("x"), undefined);
});

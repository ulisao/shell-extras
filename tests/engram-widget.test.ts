import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createEngramWidget, EngramModel, RECALL_PROMPT, relativeTime, renderEngram } from "../lib/engram-widget.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const click = (y: number) => ({ type: "click", button: "left", x: 3, y }) as any;
const MIN = 60_000;

function store() {
	const values = new Map<string, unknown>();
	return { get: (key: string) => values.get(key) as any, set: (key: string, value: unknown) => void values.set(key, value), values };
}

test("S5 relativeTime reads like a person", () => {
	assert.equal(relativeTime(0, 10_000), "just now");
	assert.equal(relativeTime(0, 5 * MIN), "5 min ago");
	assert.equal(relativeTime(0, 3 * 60 * MIN), "3 h ago");
	assert.equal(relativeTime(0, 50 * 60 * MIN), "2 d ago");
});

test("S5 only successful Engram save tools count as a save, and the time persists", () => {
	const settings = store();
	let now = 1000;
	const model = new EngramModel(settings, () => now, () => true, () => {});
	assert.equal(model.record("read", false), false);
	assert.equal(model.record("mem_save", true), false, "a failed save is not a save");
	assert.equal(model.record("mem_search", false), false);
	assert.equal(model.record("mem_save", false), true);
	assert.deepEqual(settings.values.get("engramLastSave"), { at: 1000, tool: "mem_save" });
	now = 2000;
	for (const tool of ["mem_update", "mem_session_summary", "mem_capture_passive"]) assert.equal(model.record(tool, false), true, tool);
	assert.equal(new EngramModel(settings, () => now, () => true, () => {}).lastSave?.tool, "mem_capture_passive");
});

test("S5 renderEngram shows the last save and the recordar ahora button", () => {
	const frame = renderEngram({ lastSave: { at: 0, tool: "mem_save" }, now: 5 * MIN, requested: false }, theme, 40);
	const lines = frame.lines.map(strip);
	assert.match(lines.join("\n"), /last saved\s+5 min ago/);
	assert.match(lines.join("\n"), /mem_save/);
	const button = lines.findIndex((line) => /⟳ recordar ahora/.test(line));
	assert.equal(frame.actions[button], "recall");
	for (const line of frame.lines) assert.ok(visibleWidth(line) <= 40);
	assert.match(renderEngram({ now: 0, requested: false }, theme, 40).lines.map(strip).join("\n"), /never/);
	assert.match(renderEngram({ now: 0, requested: true }, theme, 40).lines.map(strip).join("\n"), /pedido enviado/);
});

test("S5 a click on recordar ahora asks the agent, as a follow-up while it is busy", () => {
	const sent: Array<{ text: string; options?: unknown }> = [];
	let idle = true;
	let now = 0;
	const model = new EngramModel(store(), () => now, () => idle, (text, options) => void sent.push({ text, options }));
	const widget = createEngramWidget(model, theme);
	const lines = widget.render(40).map(strip);
	const button = lines.findIndex((line) => /⟳ recordar ahora/.test(line));
	assert.deepEqual(widget.handleMouse!(click(button)), { handled: true, render: true });
	idle = false;
	now = 20_000;
	widget.handleMouse!(click(button));
	assert.deepEqual(sent, [{ text: RECALL_PROMPT, options: undefined }, { text: RECALL_PROMPT, options: { deliverAs: "followUp" } }]);
	assert.match(widget.render(40).map(strip).join("\n"), /pedido enviado/);
	assert.equal(widget.handleMouse!(click(0)), undefined);
});

test("S5 a second click within 10 seconds is ignored", () => {
	const sent: string[] = [];
	const model = new EngramModel(store(), () => 0, () => true, (text) => void sent.push(text));
	model.recall();
	model.recall();
	assert.equal(sent.length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { cpuPercent, createSystemWidget, Pomodoro, renderSystem, SystemModel } from "../lib/system-widget.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const click = (y: number) => ({ type: "click", button: "left", x: 3, y }) as any;
const MIN = 60_000;

test("S4 cpuPercent compares two samples of per-core times", () => {
	const before = [{ times: { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 } }];
	const after = [{ times: { user: 200, nice: 0, sys: 200, idle: 1000, irq: 0 } }];
	assert.equal(cpuPercent(before, after), 50);
	assert.equal(cpuPercent(after, after), 0);
});

test("S4 the pomodoro runs 25 minutes of focus, then 5 of break, and notifies each change", () => {
	let now = 0;
	const notices: string[] = [];
	const pomodoro = new Pomodoro(() => now, (message) => void notices.push(message));
	assert.deepEqual(pomodoro.view(), { phase: "focus", remaining: 25 * MIN, running: false });
	pomodoro.toggle();
	now = 10 * MIN;
	assert.deepEqual(pomodoro.view(), { phase: "focus", remaining: 15 * MIN, running: true });
	pomodoro.toggle();
	now = 20 * MIN;
	assert.equal(pomodoro.view().remaining, 15 * MIN, "paused time does not count");
	pomodoro.toggle();
	now = 35 * MIN;
	pomodoro.tick();
	assert.deepEqual(pomodoro.view(), { phase: "break", remaining: 5 * MIN, running: true });
	assert.deepEqual(notices, ["Pomodoro: focus done, take a 5 minute break"]);
	now = 40 * MIN;
	pomodoro.tick();
	assert.equal(pomodoro.view().phase, "focus");
	assert.equal(notices.at(-1), "Pomodoro: break over, back to focus");
	pomodoro.reset();
	assert.deepEqual(pomodoro.view(), { phase: "focus", remaining: 25 * MIN, running: false });
});

test("S4 renderSystem shows clock, CPU, RAM and the pomodoro controls within the width", () => {
	const frame = renderSystem({ now: new Date(2026, 10, 11, 9, 5), cpu: 37, memUsed: 6 * 2 ** 30, memTotal: 16 * 2 ** 30, pomodoro: { phase: "focus", remaining: 90_000, running: true } }, theme, 40);
	const lines = frame.lines.map(strip);
	assert.match(lines[0]!, /09:05/);
	assert.ok(lines.some((line) => /CPU/.test(line) && /37%/.test(line)));
	assert.ok(lines.some((line) => /RAM/.test(line) && /6\.0\/16\.0 GB/.test(line)));
	assert.ok(lines.some((line) => /focus/.test(line) && /01:30/.test(line)));
	const pause = lines.findIndex((line) => /⏸ pause/.test(line));
	assert.equal(frame.actions[pause], "toggle");
	assert.equal(frame.actions[lines.findIndex((line) => /↺ reset/.test(line))], "reset");
	for (const line of frame.lines) assert.ok(visibleWidth(line) <= 40);
	assert.match(renderSystem({ now: new Date(), cpu: 0, memUsed: 0, memTotal: 1, pomodoro: { phase: "focus", remaining: 1, running: false } }, theme, 40).lines.map(strip).join("\n"), /▶ start/);
});

test("S4 the widget starts and resets the pomodoro on click, and its digest ticks each minute or each second while running", () => {
	let now = 0;
	const model = new SystemModel({ now: () => now, cpus: () => [{ times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 } }], mem: () => ({ total: 4, free: 2 }), notify() {} });
	const widget = createSystemWidget(model, theme);
	const lines = widget.render(40).map(strip);
	const d0 = widget.digest!();
	now = 1000;
	assert.equal(widget.digest!(), d0, "idle: same minute, same digest");
	now = MIN;
	assert.notEqual(widget.digest!(), d0);
	widget.handleMouse!(click(lines.findIndex((line) => /▶ start/.test(line))));
	assert.equal(model.pomodoro.view().running, true);
	const d1 = widget.digest!();
	now = MIN + 1000;
	assert.notEqual(widget.digest!(), d1, "running: changes every second");
	const after = widget.render(40).map(strip);
	widget.handleMouse!(click(after.findIndex((line) => /↺ reset/.test(line))));
	assert.equal(model.pomodoro.view().running, false);
	assert.equal(widget.handleMouse!(click(0)), undefined);
});

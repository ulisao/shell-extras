import { cpus as osCpus, freemem, totalmem } from "node:os";
import type { ExplorerTheme } from "./explorer-view.ts";
import { fitLine } from "./explorer-view.ts";
import type { RailWidget } from "./tabs.ts";

export interface CpuSample {
	times: { user: number; nice: number; sys: number; idle: number; irq: number };
}

/** Busy share of all cores between two `os.cpus()` samples, 0-100. */
export function cpuPercent(before: readonly CpuSample[], after: readonly CpuSample[]): number {
	let busy = 0;
	let total = 0;
	after.forEach((core, index) => {
		const previous = before[index];
		if (!previous) return;
		const delta = (key: keyof CpuSample["times"]) => core.times[key] - previous.times[key];
		const idle = delta("idle");
		const all = delta("user") + delta("nice") + delta("sys") + delta("irq") + idle;
		busy += all - idle;
		total += all;
	});
	return total > 0 ? Math.round((busy / total) * 100) : 0;
}

const FOCUS_MS = 25 * 60_000;
const BREAK_MS = 5 * 60_000;

export interface PomodoroView {
	phase: "focus" | "break";
	remaining: number;
	running: boolean;
}

/** A 25/5 pomodoro driven by an injectable clock; `tick()` switches phases and notifies. */
export class Pomodoro {
	private phase: "focus" | "break" = "focus";
	private remainingAtStart = FOCUS_MS;
	private startedAt: number | undefined;
	private readonly now: () => number;
	private readonly notify: (message: string) => void;

	constructor(now: () => number, notify: (message: string) => void) {
		this.now = now;
		this.notify = notify;
	}

	view(): PomodoroView {
		const elapsed = this.startedAt === undefined ? 0 : this.now() - this.startedAt;
		return { phase: this.phase, remaining: Math.max(0, this.remainingAtStart - elapsed), running: this.startedAt !== undefined };
	}

	toggle(): void {
		if (this.startedAt === undefined) this.startedAt = this.now();
		else {
			this.remainingAtStart = this.view().remaining;
			this.startedAt = undefined;
		}
	}

	reset(): void {
		this.phase = "focus";
		this.remainingAtStart = FOCUS_MS;
		this.startedAt = undefined;
	}

	/** Advances to the next phase once the current one ran out. */
	tick(): void {
		if (this.startedAt === undefined || this.view().remaining > 0) return;
		const endedAt = this.startedAt + this.remainingAtStart;
		this.phase = this.phase === "focus" ? "break" : "focus";
		this.remainingAtStart = this.phase === "focus" ? FOCUS_MS : BREAK_MS;
		this.startedAt = endedAt;
		this.notify(this.phase === "break" ? "Pomodoro: focus done, take a 5 minute break" : "Pomodoro: break over, back to focus");
	}
}

export interface SystemInfo {
	now: Date;
	cpu: number;
	memUsed: number;
	memTotal: number;
	pomodoro: PomodoroView;
}

export type SystemAction = "toggle" | "reset";

const pad = (value: number) => String(value).padStart(2, "0");
const GB = 2 ** 30;

function meter(percent: number, size: number): string {
	const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * size);
	return "█".repeat(filled) + "░".repeat(size - filled);
}

function role(percent: number): string {
	return percent >= 90 ? "error" : percent >= 70 ? "warning" : "success";
}

export function renderSystem(info: SystemInfo, theme: ExplorerTheme, width: number): { lines: string[]; actions: Array<SystemAction | undefined> } {
	const lines: string[] = [];
	const actions: Array<SystemAction | undefined> = [];
	const push = (line: string, action?: SystemAction) => {
		lines.push(line);
		actions.push(action);
	};
	const { now } = info;
	push(fitLine(`  ${theme.fg("accent", "")} ${theme.bold(`${pad(now.getHours())}:${pad(now.getMinutes())}`)}`, theme.fg("muted", `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`), width));
	const size = Math.max(4, Math.min(16, width - 26));
	const mem = info.memTotal > 0 ? Math.round((info.memUsed / info.memTotal) * 100) : 0;
	push(fitLine(`  CPU ${theme.fg(role(info.cpu), meter(info.cpu, size))}`, `${info.cpu}%`, width));
	push(fitLine(`  RAM ${theme.fg(role(mem), meter(mem, size))}`, `${(info.memUsed / GB).toFixed(1)}/${(info.memTotal / GB).toFixed(1)} GB`, width));
	const { phase, remaining, running } = info.pomodoro;
	const seconds = Math.ceil(remaining / 1000);
	push(fitLine(`  ${theme.fg(phase === "focus" ? "warning" : "success", "")} ${theme.bold(phase)}`, theme.bold(`${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`), width));
	push(fitLine(`    ${theme.fg("accent", running ? "⏸ pause" : "▶ start")}`, "", width), "toggle");
	push(fitLine(`    ${theme.fg("muted", "↺ reset")}`, "", width), "reset");
	return { lines, actions };
}

export interface SystemSources {
	now: () => number;
	cpus: () => CpuSample[];
	mem: () => { total: number; free: number };
	notify: (message: string) => void;
}

export class SystemModel {
	readonly pomodoro: Pomodoro;
	readonly sources: SystemSources;
	cpu = 0;
	version = 0;
	private sample: CpuSample[];

	constructor(sources: Partial<SystemSources> = {}) {
		this.sources = { now: Date.now, cpus: osCpus, mem: () => ({ total: totalmem(), free: freemem() }), notify() {}, ...sources };
		this.pomodoro = new Pomodoro(this.sources.now, this.sources.notify);
		this.sample = this.sources.cpus();
	}

	refresh(): void {
		const next = this.sources.cpus();
		this.cpu = cpuPercent(this.sample, next);
		this.sample = next;
		this.pomodoro.tick();
		this.version++;
	}

	info(): SystemInfo {
		const mem = this.sources.mem();
		return { now: new Date(this.sources.now()), cpu: this.cpu, memUsed: mem.total - mem.free, memTotal: mem.total, pomodoro: this.pomodoro.view() };
	}
}

export function createSystemWidget(model: SystemModel, theme: ExplorerTheme): RailWidget {
	let actions: Array<SystemAction | undefined> = [];
	return {
		render(width) {
			model.pomodoro.tick();
			const frame = renderSystem(model.info(), theme, width);
			actions = frame.actions;
			return frame.lines;
		},
		digest() {
			const view = model.pomodoro.view();
			const clock = Math.floor(model.sources.now() / (view.running ? 1000 : 60_000));
			return [model.version, clock, view.running, view.phase, view.remaining > 0 ? "" : "done"].join("|");
		},
		summary() {
			const view = model.pomodoro.view();
			if (!view.running) return `CPU ${model.cpu}%`;
			const seconds = Math.ceil(view.remaining / 1000);
			return `${view.phase} ${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
		},
		handleMouse(event) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			const action = actions[event.y];
			if (!action) return undefined;
			if (action === "toggle") model.pomodoro.toggle();
			else model.pomodoro.reset();
			return { handled: true, render: true };
		},
	};
}

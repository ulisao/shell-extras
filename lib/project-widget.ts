import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExplorerTheme } from "./explorer-view.ts";
import { fitLine } from "./explorer-view.ts";
import { runCommand, type Runner } from "./git-widget.ts";
import type { RailWidget } from "./tabs.ts";

export interface PortInfo {
	port: number;
	pid: number;
	process?: string;
}

export interface Container {
	name: string;
	status: string;
	ports: string;
}

export interface ProjectInfo {
	odd?: { name: string; done: number; total: number };
	scripts: string[];
	runner: string;
	ports: PortInfo[];
	docker: { status: "ok" | "unavailable" | "loading"; containers: Container[] };
}

export type ProjectAction = { kind: "script"; name: string } | { kind: "port"; port: number };

/** The package manager the lock file asks for. */
export function scriptRunner(files: readonly string[]): string {
	if (files.includes("pnpm-lock.yaml")) return "pnpm";
	if (files.includes("yarn.lock")) return "yarn";
	if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
	return "npm";
}

/** Listening TCP ports from `netstat -ano -p tcp` (Windows), one entry per port, sorted. */
export function parseNetstat(text: string): Array<{ port: number; pid: number }> {
	const ports = new Map<number, number>();
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
		if (match && !ports.has(Number(match[1]))) ports.set(Number(match[1]), Number(match[2]));
	}
	return [...ports].sort((a, b) => a[0] - b[0]).map(([port, pid]) => ({ port, pid }));
}

/** PID → image name from `tasklist /fo csv /nh`. */
export function parseTasklist(text: string): Map<number, string> {
	const names = new Map<number, string>();
	for (const line of text.split(/\r?\n/)) {
		const match = /^"([^"]*)","(\d+)"/.exec(line);
		if (match) names.set(Number(match[2]), match[1]!);
	}
	return names;
}

/** `docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"`. */
export function parseDockerPs(text: string): Container[] {
	return text
		.split(/\r?\n/)
		.filter((line) => line.trim() !== "")
		.map((line) => {
			const [name = "", status = "", ports = ""] = line.split("\t");
			return { name, status, ports };
		});
}

/** Task checkboxes of an ODD feature document. */
export function parseOddProgress(markdown: string): { done: number; total: number } {
	let done = 0;
	let total = 0;
	for (const line of markdown.split(/\r?\n/)) {
		const match = /^\s*- \[([ xX])\]/.exec(line);
		if (!match) continue;
		total++;
		if (match[1] !== " ") done++;
	}
	return { done, total };
}

/** The command that runs a script in its own terminal tab (Windows Terminal) or console window. */
export function launchCommand(cwd: string, runner: string, script: string, windowsTerminal: boolean): { command: string; args: string[] } {
	const line = `${runner} run ${script}`;
	return windowsTerminal
		? { command: "wt.exe", args: ["-w", "0", "nt", "--title", script, "-d", cwd, "cmd", "/k", line] }
		: { command: "cmd.exe", args: ["/c", "start", script, "/d", cwd, "cmd", "/k", line] };
}

const DEV_PROCESSES = new Set(["node", "bun", "deno", "python", "python3", "pythonw", "ruby", "java", "php", "dotnet", "go", "air", "caddy", "nginx", "httpd", "postgres", "mysqld", "redis-server", "mongod"]);
const MAX_PORTS = 6;
const MAX_SCRIPTS = 8;

function section(title: string, theme: ExplorerTheme, width: number): string {
	return fitLine(`  ${theme.fg("muted", theme.bold(title))}`, "", width);
}

function bar(done: number, total: number, size: number): string {
	const filled = total > 0 ? Math.round((done / total) * size) : 0;
	return "█".repeat(filled) + "░".repeat(size - filled);
}

/** The Project tab; `actions[row]` is what a click on that row does. */
export function renderProject(info: ProjectInfo, theme: ExplorerTheme, width: number): { lines: string[]; actions: Array<ProjectAction | undefined> } {
	const lines: string[] = [];
	const actions: Array<ProjectAction | undefined> = [];
	const push = (line: string, action?: ProjectAction) => {
		lines.push(line);
		actions.push(action);
	};
	if (info.odd) {
		const { name, done, total } = info.odd;
		push(fitLine(`  ${theme.fg("accent", "")} ${theme.bold(name)}`, theme.fg(done === total ? "success" : "warning", `${done}/${total}`), width));
		push(fitLine(`    ${theme.fg(done === total ? "success" : "accent", bar(done, total, Math.max(4, Math.min(30, width - 8))))}`, "", width));
	}
	push(section(`SCRIPTS · ${info.runner}`, theme, width));
	if (!info.scripts.length) push(fitLine(`    ${theme.fg("muted", "no package.json scripts")}`, "", width));
	for (const name of info.scripts.slice(0, MAX_SCRIPTS)) push(fitLine(`    ${theme.fg("success", "▶")} ${name}`, "", width), { kind: "script", name });
	push(section("PORTS", theme, width));
	if (!info.ports.length) push(fitLine(`    ${theme.fg("muted", "no dev servers listening")}`, "", width));
	for (const port of info.ports.slice(0, MAX_PORTS)) push(fitLine(`    ${theme.fg("accent", "󰖟")} :${port.port}`, theme.fg("muted", (port.process ?? String(port.pid)).replace(/\.exe$/i, "")), width), { kind: "port", port: port.port });
	push(section("DOCKER", theme, width));
	if (info.docker.status === "unavailable") push(fitLine(`    ${theme.fg("muted", "docker not running")}`, "", width));
	else if (info.docker.status === "loading") push(fitLine(`    ${theme.fg("muted", "…")}`, "", width));
	else if (!info.docker.containers.length) push(fitLine(`    ${theme.fg("muted", "no containers running")}`, "", width));
	for (const container of info.docker.containers) push(fitLine(`    ${theme.fg("success", "●")} ${container.name}`, theme.fg("muted", container.status), width));
	return { lines, actions };
}

export type ActionRunner = (action: ProjectAction, info: ProjectInfo) => void;

function readJson(file: string): any {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

export class ProjectModel {
	info: ProjectInfo = { scripts: [], runner: "npm", ports: [], docker: { status: "loading", containers: [] } };
	version = 0;
	private listeners = new Set<() => void>();
	readonly cwd: string;
	private readonly run: Runner;
	readonly perform: ActionRunner;

	constructor(cwd: string, run: Runner = runCommand, perform: ActionRunner = (action, info) => performAction(cwd, action, info)) {
		this.cwd = cwd;
		this.run = run;
		this.perform = perform;
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private local(): Pick<ProjectInfo, "odd" | "scripts" | "runner"> {
		let files: string[] = [];
		try {
			files = readdirSync(this.cwd);
		} catch {
			// An unreadable cwd shows no scripts.
		}
		const scripts = Object.keys(readJson(join(this.cwd, "package.json"))?.scripts ?? {});
		let odd: ProjectInfo["odd"];
		try {
			const dir = join(this.cwd, "odd", "tasks");
			const newest = readdirSync(dir)
				.filter((name) => name.endsWith(".md"))
				.map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs }))
				.sort((a, b) => b.time - a.time)[0];
			if (newest) odd = { name: basename(newest.name, ".md"), ...parseOddProgress(readFileSync(join(dir, newest.name), "utf8")) };
		} catch {
			odd = undefined;
		}
		return { odd, scripts, runner: scriptRunner(files) };
	}

	private async ports(): Promise<PortInfo[]> {
		if (process.platform !== "win32" && this.run === runCommand) return [];
		try {
			const listening = parseNetstat(await this.run("netstat", ["-ano", "-p", "tcp"], this.cwd));
			const names = parseTasklist(await this.run("tasklist", ["/fo", "csv", "/nh"], this.cwd));
			return listening
				.map((entry) => ({ ...entry, process: names.get(entry.pid) }))
				.filter((entry) => entry.process !== undefined && DEV_PROCESSES.has(entry.process.toLowerCase().replace(/\.exe$/, "")));
		} catch {
			return [];
		}
	}

	private async docker(): Promise<ProjectInfo["docker"]> {
		try {
			return { status: "ok", containers: parseDockerPs(await this.run("docker", ["ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"], this.cwd)) };
		} catch {
			return { status: "unavailable", containers: [] };
		}
	}

	async refresh(): Promise<void> {
		const [ports, docker] = await Promise.all([this.ports(), this.docker()]);
		this.info = { ...this.local(), ports, docker };
		this.version++;
		for (const listener of this.listeners) listener();
	}
}

function detached(command: string, args: string[], cwd: string, onError?: () => void): void {
	try {
		const child = spawn(command, args, { cwd, detached: true, stdio: "ignore", windowsHide: false });
		child.on("error", () => onError?.());
		child.unref();
	} catch {
		onError?.();
	}
}

/** Runs a script in a new terminal tab, or opens a port in the browser. Best effort, Windows first. */
export function performAction(cwd: string, action: ProjectAction, info: ProjectInfo): void {
	if (action.kind === "port") {
		const url = `http://localhost:${action.port}`;
		if (process.platform === "win32") detached("cmd.exe", ["/c", "start", "", url], cwd);
		else detached(process.platform === "darwin" ? "open" : "xdg-open", [url], cwd);
		return;
	}
	if (process.platform !== "win32") {
		detached(info.runner, ["run", action.name], cwd);
		return;
	}
	const terminal = launchCommand(cwd, info.runner, action.name, true);
	detached(terminal.command, terminal.args, cwd, () => {
		const fallback = launchCommand(cwd, info.runner, action.name, false);
		detached(fallback.command, fallback.args, cwd);
	});
}

export function createProjectWidget(model: ProjectModel, theme: ExplorerTheme): RailWidget {
	let actions: Array<ProjectAction | undefined> = [];
	return {
		render(width) {
			const frame = renderProject(model.info, theme, width);
			actions = frame.actions;
			return frame.lines;
		},
		digest: () => String(model.version),
		summary: () => (model.info.odd ? `${model.info.odd.name} ${model.info.odd.done}/${model.info.odd.total}` : "Project"),
		handleMouse(event) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			const action = actions[event.y];
			if (!action) return undefined;
			model.perform(action, model.info);
			return { handled: true, render: false };
		},
	};
}

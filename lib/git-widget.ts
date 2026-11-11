import { execFile } from "node:child_process";
import type { ExplorerTheme } from "./explorer-view.ts";
import { fitLine } from "./explorer-view.ts";
import type { RailWidget } from "./tabs.ts";

export interface BranchInfo {
	head: string;
	upstream: string | undefined;
	ahead: number;
	behind: number;
	/** Changed, staged, untracked or conflicted entries. */
	changes: number;
}

export interface PrInfo {
	number: number;
	title: string;
	state: "open" | "draft" | "merged" | "closed";
	url: string;
	checks: { pass: number; fail: number; pending: number };
}

export interface GitInfo {
	branch?: BranchInfo;
	pr?: PrInfo;
	/** "unavailable" when gh is missing or failed to start; "none" when the branch has no PR. */
	prStatus: "ok" | "none" | "unavailable" | "loading";
}

/** Parses `git status --porcelain=v2 --branch`. */
export function parseBranch(text: string): BranchInfo {
	const info: BranchInfo = { head: "", upstream: undefined, ahead: 0, behind: 0, changes: 0 };
	for (const line of text.split(/\r?\n/)) {
		if (line.startsWith("# branch.head ")) info.head = line.slice(14).trim();
		else if (line.startsWith("# branch.upstream ")) info.upstream = line.slice(18).trim();
		else if (line.startsWith("# branch.ab ")) {
			const match = /\+(\d+) -(\d+)/.exec(line);
			if (match) {
				info.ahead = Number(match[1]);
				info.behind = Number(match[2]);
			}
		} else if (line && !line.startsWith("#")) info.changes++;
	}
	return info;
}

const PASSING = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const FAILING = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/** Parses `gh pr view --json number,title,state,isDraft,url,statusCheckRollup`. */
export function parsePr(json: string): PrInfo | undefined {
	let data: any;
	try {
		data = JSON.parse(json);
	} catch {
		return undefined;
	}
	if (!data || typeof data.number !== "number") return undefined;
	const checks = { pass: 0, fail: 0, pending: 0 };
	for (const check of Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : []) {
		const outcome = String(check?.__typename === "StatusContext" ? check.state : check?.status === "COMPLETED" ? check.conclusion : "PENDING").toUpperCase();
		if (PASSING.has(outcome)) checks.pass++;
		else if (FAILING.has(outcome)) checks.fail++;
		else checks.pending++;
	}
	const raw = String(data.state ?? "").toUpperCase();
	const state = raw === "MERGED" ? "merged" : raw === "CLOSED" ? "closed" : data.isDraft ? "draft" : "open";
	return { number: data.number, title: String(data.title ?? ""), state, url: String(data.url ?? ""), checks };
}

const STATE_ROLE: Record<PrInfo["state"], string> = { open: "success", draft: "muted", merged: "accent", closed: "error" };

/** The Git tab: branch and sync, working tree, PR, CI. Row 2 is the PR row (clickable). */
export function renderGit(info: GitInfo, theme: ExplorerTheme, width: number): string[] {
	const branch = info.branch;
	if (!branch) return [fitLine(`  ${theme.fg("muted", "not a Git repository")}`, "", width)];
	const sync = branch.upstream ? `${theme.fg(branch.ahead ? "warning" : "muted", `↑${branch.ahead}`)} ${theme.fg(branch.behind ? "warning" : "muted", `↓${branch.behind}`)}` : theme.fg("muted", "no upstream");
	const lines = [fitLine(`  ${theme.fg("accent", "")} ${theme.bold(branch.head)}`, sync, width)];
	lines.push(fitLine(`  ${theme.fg("muted", "")} ${branch.changes ? theme.fg("warning", `${branch.changes} changed`) : theme.fg("success", "clean")}`, "", width));
	if (info.pr) {
		const pr = info.pr;
		lines.push(fitLine(`  ${theme.fg("accent", "")} #${pr.number} ${pr.title}`, theme.fg(STATE_ROLE[pr.state], pr.state), width));
		const { pass, fail, pending } = pr.checks;
		lines.push(fitLine(`  CI  ${theme.fg("success", `✓ ${pass}`)}  ${theme.fg(fail ? "error" : "muted", `✗ ${fail}`)}  ${theme.fg(pending ? "warning" : "muted", `◌ ${pending}`)}`, "", width));
	} else {
		const text = info.prStatus === "unavailable" ? "gh unavailable" : info.prStatus === "loading" ? "checking pull request…" : "no pull request";
		lines.push(fitLine(`  ${theme.fg("muted", ` ${text}`)}`, "", width));
	}
	return lines;
}

export type Runner = (command: string, args: string[], cwd: string) => Promise<string>;

export const runCommand: Runner = (command, args, cwd) =>
	new Promise((resolve, reject) => {
		execFile(command, args, { cwd, windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
	});

const GH_INTERVAL_MS = 60_000;
const PR_FIELDS = "number,title,state,isDraft,url,statusCheckRollup";

export class GitWidgetModel {
	info: GitInfo = { prStatus: "loading" };
	version = 0;
	private listeners = new Set<() => void>();
	private lastGh = Number.NEGATIVE_INFINITY;
	private lastHead: string | undefined;

	private readonly cwd: string;
	private readonly run: Runner;
	private readonly now: () => number;

	constructor(cwd: string, run: Runner = runCommand, now: () => number = Date.now) {
		this.cwd = cwd;
		this.run = run;
		this.now = now;
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		this.version++;
		for (const listener of this.listeners) listener();
	}

	async refresh(): Promise<void> {
		let branch: BranchInfo | undefined;
		try {
			branch = parseBranch(await this.run("git", ["status", "--porcelain=v2", "--branch"], this.cwd));
		} catch {
			branch = undefined;
		}
		const headChanged = branch?.head !== this.lastHead;
		this.lastHead = branch?.head;
		this.info = { ...this.info, branch };
		if (!branch) this.info = { branch, prStatus: "none" };
		else if (headChanged || this.now() - this.lastGh >= GH_INTERVAL_MS) {
			this.lastGh = this.now();
			try {
				const pr = parsePr(await this.run("gh", ["pr", "view", "--json", PR_FIELDS], this.cwd));
				this.info = { ...this.info, pr, prStatus: pr ? "ok" : "none" };
			} catch (error) {
				const missing = (error as { code?: unknown })?.code === "ENOENT";
				this.info = { ...this.info, pr: undefined, prStatus: missing ? "unavailable" : "none" };
			}
		}
		this.emit();
	}

	async openPr(): Promise<void> {
		if (!this.info.pr) return;
		try {
			await this.run("gh", ["pr", "view", "--web"], this.cwd);
		} catch {
			// Opening the browser is best effort.
		}
	}
}

/** The Git tab widget; a click on the PR row opens the pull request in the browser. */
export function createGitWidget(model: GitWidgetModel, theme: ExplorerTheme): RailWidget {
	return {
		render: (width) => renderGit(model.info, theme, width),
		digest: () => String(model.version),
		summary: () => (model.info.branch ? model.info.branch.head : "Git"),
		handleMouse(event) {
			if (event.type !== "click" || event.button !== "left" || event.y !== 2 || !model.info.pr) return undefined;
			void model.openPr();
			return { handled: true, render: false };
		},
	};
}

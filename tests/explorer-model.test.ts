import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExplorerModel } from "../lib/explorer-model.ts";
import type { GitRunner } from "../lib/git-status.ts";
import type { ListDir } from "../lib/file-tree.ts";

const disk: Record<string, { name: string; dir: boolean }[]> = {
	"": [{ name: "src", dir: true }, { name: "a.ts", dir: false }, { name: "dist", dir: true }],
	src: [{ name: "main.ts", dir: false }],
};
const list: ListDir = (path) => disk[path] ?? [];

/** A git runner answering rev-parse and status from a mutable status text. */
function fakeGit(state: { status: string; calls: string[][] }): GitRunner {
	return async (_cwd, args) => {
		state.calls.push(args);
		if (args[0] === "rev-parse") return "/repo\n";
		return state.status;
	};
}

test("S2 the model roots at the git root, lists rows, counts changes and ignores ignored entries (S4)", async () => {
	const state = { status: [" M a.ts", "?? src/new.ts", "!! dist/", ""].join("\0"), calls: [] as string[][] };
	const model = new ExplorerModel("/repo/sub", { git: fakeGit(state), list: () => list });
	assert.equal(model.root, "/repo/sub", "before the first refresh the root is the cwd");
	await model.refresh();
	assert.equal(model.root, "/repo");
	assert.deepEqual(model.rows.map((row) => [row.path, row.status]), [["dist", "ignored"], ["src", "untracked"], ["a.ts", "modified"]]);
	assert.equal(model.changed, 2, "the ignored entry is not a change");
});

test("S2 outside git the root is the cwd and a git failure leaves an empty snapshot without throwing", async () => {
	const failing: GitRunner = async () => {
		throw new Error("git is not installed");
	};
	const model = new ExplorerModel("/plain", { git: failing, list: () => list });
	await model.refresh();
	assert.equal(model.root, "/plain");
	assert.equal(model.snapshot.files.size, 0);
	assert.equal(model.changed, 0);
	assert.deepEqual(model.rows.map((row) => row.path), ["dist", "src", "a.ts"], "the tree still lists the disk");
});

test("S2 toggle expands and collapses a folder recomputing rows only, and bumps the version", async () => {
	const state = { status: "", calls: [] as string[][] };
	const model = new ExplorerModel("/repo", { git: fakeGit(state), list: () => list });
	await model.refresh();
	const callsBefore = state.calls.length;
	const before = model.version;
	model.toggle("src");
	assert.deepEqual(model.rows.map((row) => row.path), ["dist", "src", "src/main.ts", "a.ts"]);
	assert.ok(model.expanded.has("src"));
	assert.ok(model.version > before);
	assert.equal(state.calls.length, callsBefore, "toggle never runs git");
	const opened = model.version;
	model.toggle("src");
	assert.deepEqual(model.rows.map((row) => row.path), ["dist", "src", "a.ts"]);
	assert.ok(model.version > opened);
});

test("version only moves when what is shown changes, and listeners hear about it", async () => {
	const state = { status: " M a.ts\0", calls: [] as string[][] };
	const model = new ExplorerModel("/repo", { git: fakeGit(state), list: () => list });
	let heard = 0;
	model.onChange(() => heard++);
	await model.refresh();
	const first = model.version;
	assert.ok(first > 0);
	assert.equal(heard, 1);
	await model.refresh();
	assert.equal(model.version, first, "an identical refresh is not a change");
	assert.equal(heard, 1);
	state.status = " M a.ts\0?? src/new.ts\0";
	await model.refresh();
	assert.ok(model.version > first);
	assert.equal(heard, 2);
});

test("concurrent refreshes share one run and a call during a run schedules exactly one follow-up", async () => {
	let statusRuns = 0;
	const waiters: Array<() => void> = [];
	const git: GitRunner = async (_cwd, args) => {
		if (args[0] === "rev-parse") return "/repo\n";
		statusRuns++;
		await new Promise<void>((resolve) => waiters.push(resolve));
		return "";
	};
	const model = new ExplorerModel("/repo", { git, list: () => list });
	const all = [model.refresh(), model.refresh(), model.refresh()];
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(statusRuns, 1, "three concurrent calls start one run");
	all.push(model.refresh(), model.refresh(), model.refresh());
	waiters.shift()!();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(statusRuns, 2, "exactly one follow-up, however many calls arrived");
	waiters.shift()!();
	await Promise.all(all);
	assert.equal(statusRuns, 2);
	const later = model.refresh();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(statusRuns, 3, "a call after the run finished starts a new run");
	waiters.shift()!();
	await later;
});

test("S2-S4 a real repository drives the model: root, status, ignored and changed count", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "shell-extras-model-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "test");
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, "build"));
	writeFileSync(join(root, ".gitignore"), "build/\n");
	writeFileSync(join(root, "src", "a.ts"), "one\n");
	git("add", ".");
	git("commit", "-q", "-m", "base");
	writeFileSync(join(root, "src", "a.ts"), "two\n");
	writeFileSync(join(root, "build", "out.js"), "x\n");
	const model = new ExplorerModel(join(root, "src"));
	await model.refresh();
	assert.equal(model.root.replace(/\\/g, "/").toLowerCase(), root.replace(/\\/g, "/").toLowerCase());
	assert.deepEqual(model.rows.map((row) => [row.path, row.status]), [["build", "ignored"], ["src", "modified"], [".gitignore", undefined]]);
	assert.equal(model.changed, 1);
});

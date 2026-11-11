import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GitWidgetModel, parseBranch, parsePr, renderGit } from "../lib/git-widget.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

test("S4 parseBranch reads the branch, upstream, ahead/behind and changes from porcelain v2", () => {
	const text = ["# branch.oid abc", "# branch.head feat/x", "# branch.upstream origin/feat/x", "# branch.ab +2 -1", "1 .M N... 1 1 1 a b f.ts", "? new.ts"].join("\n");
	assert.deepEqual(parseBranch(text), { head: "feat/x", upstream: "origin/feat/x", ahead: 2, behind: 1, changes: 2 });
});

test("S4 parseBranch handles a detached head and no upstream", () => {
	assert.deepEqual(parseBranch("# branch.oid abcdef1234\n# branch.head (detached)\n"), { head: "(detached)", upstream: undefined, ahead: 0, behind: 0, changes: 0 });
});

test("S4 parsePr summarizes the PR and its checks", () => {
	const json = JSON.stringify({
		number: 12,
		title: "Add tabs",
		state: "OPEN",
		isDraft: false,
		url: "https://github.com/o/r/pull/12",
		statusCheckRollup: [
			{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
			{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
			{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
			{ __typename: "StatusContext", state: "SUCCESS" },
			{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
		],
	});
	assert.deepEqual(parsePr(json), { number: 12, title: "Add tabs", state: "open", url: "https://github.com/o/r/pull/12", checks: { pass: 3, fail: 1, pending: 1 } });
});

test("S4 parsePr reports drafts and rejects junk", () => {
	assert.equal(parsePr(JSON.stringify({ number: 1, title: "t", state: "OPEN", isDraft: true, url: "u", statusCheckRollup: [] }))?.state, "draft");
	assert.equal(parsePr("not json"), undefined);
});

test("S4 renderGit shows branch, sync, PR and CI rows within the width", () => {
	const lines = renderGit(
		{ branch: { head: "feat/sidebar-widgets", upstream: "origin/feat/sidebar-widgets", ahead: 2, behind: 0, changes: 3 }, pr: { number: 12, title: "Add tabs", state: "open", url: "u", checks: { pass: 4, fail: 1, pending: 0 } }, prStatus: "ok" },
		theme,
		40,
	).map(strip);
	assert.match(lines[0]!, /feat\/sidebar-widgets/);
	assert.match(lines[0]!, /↑2 ↓0$/);
	assert.match(lines[1]!, /3 changed/);
	assert.match(lines[2]!, /#12 Add tabs/);
	assert.match(lines[2]!, /open$/);
	assert.match(lines[3]!, /CI\s+✓ 4\s+✗ 1\s+◌ 0/);
	for (const line of lines) assert.ok(visibleWidth(line) <= 40);
});

test("S4 renderGit explains a missing upstream, PR or gh", () => {
	const none = renderGit({ branch: { head: "main", upstream: undefined, ahead: 0, behind: 0, changes: 0 }, prStatus: "none" }, theme, 40).map(strip);
	assert.match(none[0]!, /no upstream$/);
	assert.match(none[1]!, /clean/);
	assert.match(none[2]!, /no pull request/);
	const missing = renderGit({ branch: { head: "main", upstream: undefined, ahead: 0, behind: 0, changes: 0 }, prStatus: "unavailable" }, theme, 40).map(strip);
	assert.match(missing[2]!, /gh unavailable/);
	assert.deepEqual(renderGit({ prStatus: "none" }, theme, 40).map(strip).map((line) => line.trim()), ["not a Git repository"]);
});

test("S4 the model runs git and gh in the cwd and a click on the PR row opens it", async () => {
	const calls: string[] = [];
	const run = async (command: string, args: string[], cwd: string) => {
		calls.push(`${cwd}> ${command} ${args.join(" ")}`);
		if (command === "git") return "# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -3\n";
		if (args[0] === "pr" && args[1] === "view" && args.includes("--json")) return JSON.stringify({ number: 7, title: "Fix", state: "OPEN", isDraft: false, url: "https://x/7", statusCheckRollup: [] });
		return "";
	};
	const model = new GitWidgetModel("/repo", run, () => 0);
	let changes = 0;
	model.onChange(() => changes++);
	await model.refresh();
	assert.equal(model.info.branch?.behind, 3);
	assert.equal(model.info.pr?.number, 7);
	assert.ok(changes > 0);
	await model.openPr();
	assert.deepEqual(calls, ["/repo> git status --porcelain=v2 --branch", "/repo> gh pr view --json number,title,state,isDraft,url,statusCheckRollup", "/repo> gh pr view --web"]);
});

test("S4 the model asks gh at most once a minute", async () => {
	let gh = 0;
	let now = 0;
	const run = async (command: string) => (command === "gh" ? (gh++, "") : "# branch.head main\n");
	const model = new GitWidgetModel("/repo", run, () => now);
	await model.refresh();
	await model.refresh();
	assert.equal(gh, 1);
	now = 61_000;
	await model.refresh();
	assert.equal(gh, 2);
});

test("S4 a failing gh marks the PR row unavailable", async () => {
	const run = async (command: string) => {
		if (command === "gh") throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
		return "# branch.head main\n";
	};
	const model = new GitWidgetModel("/repo", run, () => 0);
	await model.refresh();
	assert.equal(model.info.prStatus, "unavailable");
});

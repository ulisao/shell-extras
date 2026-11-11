import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSnapshot, EMPTY_SNAPSHOT, findGitRoot, parsePorcelainZ, readGitSnapshot, statusOf } from "../lib/git-status.ts";
import { diskLister, visibleRows, type ListDir } from "../lib/file-tree.ts";

test("porcelain codes map to explorer statuses and renames skip their origin field", () => {
	const text = ["?? new.ts", " M edited.ts", "M  staged.ts", "A  added.ts", " D gone.ts", "R  moved.ts", "old.ts", "UU clash.ts", "!! dist/", "!! debug.log", "MM both.ts", ""].join("\0");
	assert.deepEqual([...parsePorcelainZ(text)], [
		["new.ts", "untracked"],
		["edited.ts", "modified"],
		["staged.ts", "modified"],
		["added.ts", "added"],
		["gone.ts", "deleted"],
		["moved.ts", "renamed"],
		["clash.ts", "conflicted"],
		["dist/", "ignored"],
		["debug.log", "ignored"],
		["both.ts", "modified"],
	]);
});

test("folders show their most urgent child, ignored folders and their contents stay ignored", () => {
	const snapshot = buildSnapshot(new Map([
		["src/a/new.ts", "untracked"],
		["src/a/edited.ts", "modified"],
		["src/b/clash.ts", "conflicted"],
		["dist/", "ignored"],
		["src/debug.log", "ignored"],
	] as const));
	assert.equal(statusOf(snapshot, "src", true), "conflicted");
	assert.equal(statusOf(snapshot, "src/a", true), "modified");
	assert.equal(statusOf(snapshot, "src/a/new.ts", false), "untracked");
	assert.equal(statusOf(snapshot, "dist", true), "ignored");
	assert.equal(statusOf(snapshot, "dist/deep/file.js", false), "ignored");
	assert.equal(statusOf(snapshot, "src/debug.log", false), "ignored");
	assert.equal(statusOf(snapshot, "README.md", false), undefined, "tracked and clean");
	assert.equal(statusOf(snapshot, "docs", true), undefined);
});

test("visible rows list folders first, expand only opened folders, hide .git and keep deleted paths", () => {
	const disk: Record<string, { name: string; dir: boolean }[]> = {
		"": [{ name: "b.ts", dir: false }, { name: ".git", dir: true }, { name: "src", dir: true }, { name: "A.md", dir: false }, { name: "node_modules", dir: true }],
		src: [{ name: "main.ts", dir: false }, { name: "lib", dir: true }],
		"src/lib": [{ name: "util.ts", dir: false }],
	};
	const list: ListDir = (path) => disk[path] ?? [];
	const snapshot = buildSnapshot(new Map([["src/main.ts", "modified"], ["node_modules/", "ignored"], ["src/old.ts", "deleted"], ["gone/x.ts", "deleted"]] as const));
	const collapsed = visibleRows(list, snapshot, new Set());
	assert.deepEqual(collapsed.map((row) => [row.path, row.depth, row.dir, row.expanded, row.status]), [
		["gone", 0, true, false, "deleted"],
		["node_modules", 0, true, false, "ignored"],
		["src", 0, true, false, "deleted"],
		["A.md", 0, false, false, undefined],
		["b.ts", 0, false, false, undefined],
	]);
	const open = visibleRows(list, snapshot, new Set(["src", "src/lib"]));
	assert.deepEqual(open.map((row) => row.path), ["gone", "node_modules", "src", "src/lib", "src/lib/util.ts", "src/main.ts", "src/old.ts", "A.md", "b.ts"]);
	assert.equal(open.find((row) => row.path === "src/old.ts")?.status, "deleted");
	assert.equal(open.find((row) => row.path === "src/main.ts")?.status, "modified");
	assert.equal(visibleRows(list, EMPTY_SNAPSHOT, new Set(["missing"])).length, 4, "an expanded folder that no longer exists is harmless");
});

test("a real repository reports new, edited, staged, deleted and ignored paths", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "shell-extras-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "test");
	git("config", "core.autocrlf", "false");
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), "node_modules/\n");
	writeFileSync(join(root, "src", "edited.ts"), "one\n");
	writeFileSync(join(root, "src", "removed.ts"), "one\n");
	writeFileSync(join(root, "clean.ts"), "one\n");
	git("add", ".");
	git("commit", "-q", "-m", "base");
	writeFileSync(join(root, "src", "edited.ts"), "two\n");
	unlinkSync(join(root, "src", "removed.ts"));
	writeFileSync(join(root, "src", "new.ts"), "new\n");
	writeFileSync(join(root, "staged.ts"), "staged\n");
	writeFileSync(join(root, "node_modules", "pkg", "index.js"), "x\n");
	git("add", "staged.ts");
	const found = await findGitRoot(join(root, "src"));
	assert.ok(found);
	const snapshot = await readGitSnapshot(found!);
	assert.deepEqual([...snapshot.files].sort(), [
		["node_modules/", "ignored"],
		["src/edited.ts", "modified"],
		["src/new.ts", "untracked"],
		["src/removed.ts", "deleted"],
		["staged.ts", "added"],
	]);
	const rows = visibleRows(diskLister(found!), snapshot, new Set(["src"]));
	assert.deepEqual(rows.map((row) => [row.path, row.status]), [
		["node_modules", "ignored"],
		["src", "deleted"],
		["src/edited.ts", "modified"],
		["src/new.ts", "untracked"],
		["src/removed.ts", "deleted"],
		[".gitignore", undefined],
		["clean.ts", undefined],
		["staged.ts", "added"],
	]);
	assert.equal(await findGitRoot(tmpdir()), undefined, "outside Git there is no root");
});

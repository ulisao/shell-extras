import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "patch-claude-version.mjs");

function tree(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "shell-extras-patch-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const pnpm = join(root, "node_modules", ".pnpm", "@earendil-works+pi-ai@1.4.0_x", "node_modules", "@earendil-works", "pi-ai", "dist", "api");
	const bundle = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "chunks");
	mkdirSync(pnpm, { recursive: true });
	mkdirSync(bundle, { recursive: true });
	const a = join(pnpm, "anthropic-messages.js");
	const b = join(bundle, "anthropic-messages-ABC.js");
	const c = join(bundle, "other.js");
	writeFileSync(a, 'const claudeCodeVersion = "2.1.280";\nuse(claudeCodeVersion);\n');
	writeFileSync(b, 'x();var claudeCodeVersion="2.1.280",y=1;');
	writeFileSync(c, 'const claudeCodeVersion = "2.1.400";\n');
	return { root, a, b, c };
}

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

test("the patch raises every older pinned Claude Code version, keeps a backup, and leaves newer ones", (t) => {
	const { root, a, b, c } = tree(t);
	const result = run("--version", "2.1.322", root);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(readFileSync(a, "utf8"), 'const claudeCodeVersion = "2.1.322";\nuse(claudeCodeVersion);\n');
	assert.equal(readFileSync(b, "utf8"), 'x();var claudeCodeVersion="2.1.322",y=1;');
	assert.equal(readFileSync(c, "utf8"), 'const claudeCodeVersion = "2.1.400";\n', "a newer version stays");
	assert.equal(readFileSync(`${a}.bak-2.1.280`, "utf8"), 'const claudeCodeVersion = "2.1.280";\nuse(claudeCodeVersion);\n');
	assert.equal(existsSync(`${c}.bak-2.1.400`), false);
	assert.match(result.stdout, /patched 2 file\(s\) to 2\.1\.322/);
});

test("the patch is idempotent", (t) => {
	const { root } = tree(t);
	run("--version", "2.1.322", root);
	const again = run("--version", "2.1.322", root);
	assert.equal(again.status, 0);
	assert.match(again.stdout, /patched 0 file\(s\)/);
});

test("--dry-run reports without writing", (t) => {
	const { root, a } = tree(t);
	const result = run("--dry-run", "--version", "2.1.322", root);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /would patch .*anthropic-messages\.js \(2\.1\.280 -> 2\.1\.322\)/);
	assert.match(readFileSync(a, "utf8"), /2\.1\.280/);
});

test("a bad version or a missing root fails with a message and changes nothing", (t) => {
	const { root, a } = tree(t);
	const bad = run("--version", "latest", root);
	assert.equal(bad.status, 2);
	assert.match(bad.stderr, /--version must look like 2\.1\.322/);
	const missing = run("--version", "2.1.322", join(root, "nope"));
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /no pinned Claude Code version found/);
	assert.match(readFileSync(a, "utf8"), /2\.1\.280/);
});

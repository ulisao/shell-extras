#!/usr/bin/env node
// Raises the Claude Code version that pi-ai pins in its Anthropic client
// (`claudeCodeVersion = "2.1.280"`), so newer models such as claude-fable-5-2
// stop failing with "claude_code_version_too_old". Every changed file keeps a
// `.bak-<old version>` copy. Re-run it after updating Gentle Shell or after
// `pnpm install` in the fork.
//
// Usage: node scripts/patch-claude-version.mjs [--version X.Y.Z] [--dry-run] [root ...]
// Roots default to the active Gentle Shell install and the sibling ../gentle-shell fork.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PIN = /(claudeCodeVersion\s*=\s*")(\d+\.\d+\.\d+)(")/g;
const PACKAGES = ["pi-ai", "pi-coding-agent"];

function compare(a, b) {
	const x = a.split(".").map(Number);
	const y = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
	return 0;
}

function installedClaudeVersion() {
	try {
		return /(\d+\.\d+\.\d+)/.exec(execSync("claude --version", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))?.[1];
	} catch {
		return undefined;
	}
}

function defaultRoots() {
	const roots = [];
	const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
	const prefix = join(local, "gentle-shell");
	try {
		const current = readFileSync(join(prefix, "current"), "utf8").trim();
		if (current) roots.push(join(prefix, "versions", current));
	} catch {
		// No bundled Gentle Shell install here.
	}
	const fork = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "gentle-shell");
	if (existsSync(join(fork, "node_modules"))) roots.push(fork);
	return roots;
}

/** Every dist folder of pi-ai / pi-coding-agent under a root, flat or pnpm layout. */
function distDirs(root) {
	const modules = join(root, "node_modules");
	const scopes = [join(modules, "@earendil-works")];
	try {
		for (const entry of readdirSync(join(modules, ".pnpm"))) if (entry.startsWith("@earendil-works+")) scopes.push(join(modules, ".pnpm", entry, "node_modules", "@earendil-works"));
	} catch {
		// Not a pnpm layout.
	}
	const dirs = new Set();
	for (const scope of scopes) for (const name of PACKAGES) {
		const dist = join(scope, name, "dist");
		try {
			if (statSync(dist).isDirectory()) dirs.add(realpathSync(dist));
		} catch {
			// Package not present.
		}
	}
	return [...dirs];
}

function* jsFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* jsFiles(path);
		else if (/\.(c|m)?js$/.test(entry.name)) yield path;
	}
}

function main(argv) {
	let target;
	let dryRun = false;
	const roots = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--version") target = argv[++i];
		else if (argv[i] === "--dry-run") dryRun = true;
		else roots.push(resolve(argv[i]));
	}
	target ??= installedClaudeVersion() ?? "2.1.322";
	if (!/^\d+\.\d+\.\d+$/.test(target)) {
		console.error(`--version must look like 2.1.322, got "${target}"`);
		return 2;
	}
	const searched = roots.length ? roots : defaultRoots();
	let found = 0;
	let patched = 0;
	for (const root of searched) for (const dist of distDirs(root)) for (const file of jsFiles(dist)) {
		const source = readFileSync(file, "utf8");
		if (!source.includes("claudeCodeVersion")) continue;
		let old;
		const next = source.replace(PIN, (match, head, version, tail) => {
			found++;
			if (compare(version, target) >= 0) return match;
			old = version;
			return `${head}${target}${tail}`;
		});
		if (!old) continue;
		patched++;
		if (dryRun) {
			console.log(`would patch ${file} (${old} -> ${target})`);
			continue;
		}
		const backup = `${file}.bak-${old}`;
		if (!existsSync(backup)) copyFileSync(file, backup);
		writeFileSync(file, next);
		console.log(`patched ${file} (${old} -> ${target})`);
	}
	if (!found) {
		console.error(`no pinned Claude Code version found under: ${searched.join(", ") || "(no roots)"}`);
		return 1;
	}
	console.log(`${dryRun ? "would patch" : "patched"} ${patched} file(s) to ${target}`);
	return 0;
}

process.exitCode = main(process.argv.slice(2));

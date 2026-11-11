import { execFile } from "node:child_process";

/** Git state of one path, most urgent first in STATUS_PRIORITY. */
export type FileStatus = "conflicted" | "deleted" | "modified" | "renamed" | "added" | "untracked" | "ignored";

/** Higher wins when a folder summarizes its children. Ignored never colors a parent. */
export const STATUS_PRIORITY: Readonly<Record<FileStatus, number>> = Object.freeze({
	conflicted: 6,
	deleted: 5,
	modified: 4,
	renamed: 3,
	added: 2,
	untracked: 1,
	ignored: 0,
});

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function statusFromCode(code: string): FileStatus {
	if (code === "??") return "untracked";
	if (code === "!!") return "ignored";
	if (CONFLICT_CODES.has(code)) return "conflicted";
	// The index column wins over the worktree column, like VS Code's decorations.
	for (const letter of [code[0], code[1]]) {
		switch (letter) {
			case "A":
			case "C":
				return "added";
			case "D":
				return "deleted";
			case "R":
				return "renamed";
			case "M":
			case "T":
				return "modified";
		}
	}
	return "modified";
}

/**
 * Parse `git status --porcelain=v1 -z` output. Keys are repository-relative
 * POSIX paths; a directory reported as a whole (an ignored folder) keeps its
 * trailing slash. A rename's second NUL field (its origin) is skipped.
 */
export function parsePorcelainZ(text: string): Map<string, FileStatus> {
	const statuses = new Map<string, FileStatus>();
	const fields = text.split("\0");
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index]!;
		if (field.length < 4) continue;
		const code = field.slice(0, 2);
		statuses.set(field.slice(3), statusFromCode(code));
		if (code[0] === "R" || code[0] === "C") index++;
	}
	return statuses;
}

/** A Git status snapshot with folder summaries precomputed. */
export interface GitSnapshot {
	/** Status of each reported path (ignored folders keep their trailing slash). */
	files: ReadonlyMap<string, FileStatus>;
	/** Most urgent non-ignored status among each folder's descendants. */
	folders: ReadonlyMap<string, FileStatus>;
	/** Ignored folders, without the trailing slash. */
	ignoredFolders: readonly string[];
}

export const EMPTY_SNAPSHOT: GitSnapshot = { files: new Map(), folders: new Map(), ignoredFolders: [] };

export function buildSnapshot(files: ReadonlyMap<string, FileStatus>): GitSnapshot {
	const folders = new Map<string, FileStatus>();
	const ignoredFolders: string[] = [];
	for (const [path, status] of files) {
		if (status === "ignored") {
			if (path.endsWith("/")) ignoredFolders.push(path.slice(0, -1));
			continue;
		}
		const segments = path.replace(/\/$/, "").split("/");
		for (let depth = 1; depth < segments.length; depth++) {
			const folder = segments.slice(0, depth).join("/");
			const current = folders.get(folder);
			if (!current || STATUS_PRIORITY[status] > STATUS_PRIORITY[current]) folders.set(folder, status);
		}
	}
	return { files, folders, ignoredFolders };
}

function insideIgnored(snapshot: GitSnapshot, path: string): boolean {
	return snapshot.ignoredFolders.some((folder) => path === folder || path.startsWith(`${folder}/`));
}

/** The status to paint for a path; undefined means tracked and clean. */
export function statusOf(snapshot: GitSnapshot, path: string, dir: boolean): FileStatus | undefined {
	if (insideIgnored(snapshot, path)) return "ignored";
	if (dir) return snapshot.files.get(`${path}/`) ?? snapshot.folders.get(path);
	return snapshot.files.get(path);
}

export type GitRunner = (cwd: string, args: string[]) => Promise<string>;

export const runGit: GitRunner = (cwd, args) =>
	new Promise((resolve, reject) => {
		execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});

/** The Git worktree root that contains `cwd`, or undefined outside Git. */
export async function findGitRoot(cwd: string, git: GitRunner = runGit): Promise<string | undefined> {
	try {
		const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
		return root || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Read the worktree status. `--ignored=matching` reports an ignored folder
 * once instead of every file inside it, so node_modules stays one entry.
 */
export async function readGitSnapshot(root: string, git: GitRunner = runGit): Promise<GitSnapshot> {
	const output = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
	return buildSnapshot(parsePorcelainZ(output));
}

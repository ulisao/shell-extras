import { readdirSync } from "node:fs";
import { join } from "node:path";
import { statusOf, type FileStatus, type GitSnapshot } from "./git-status.ts";

export interface TreeEntry {
	name: string;
	dir: boolean;
}

/** Lists one folder, given its repository-relative POSIX path ("" is the root). */
export type ListDir = (path: string) => TreeEntry[];

export interface TreeRow {
	/** Repository-relative POSIX path. */
	path: string;
	name: string;
	depth: number;
	dir: boolean;
	expanded: boolean;
	/** Undefined when the path is tracked and clean. */
	status?: FileStatus;
}

const HIDDEN = new Set([".git"]);

/** A ListDir over the real file system; unreadable folders list as empty. */
export function diskLister(root: string): ListDir {
	return (path) => {
		try {
			return readdirSync(join(root, ...path.split("/").filter(Boolean)), { withFileTypes: true }).map((entry) => ({ name: entry.name, dir: entry.isDirectory() }));
		} catch {
			return [];
		}
	};
}

function childPath(parent: string, name: string): string {
	return parent ? `${parent}/${name}` : name;
}

/** Deleted paths no longer exist on disk, but the explorer still shows them where they were. */
function deletedChildren(snapshot: GitSnapshot, parent: string): TreeEntry[] {
	const prefix = parent ? `${parent}/` : "";
	const found = new Map<string, boolean>();
	for (const [path, status] of snapshot.files) {
		if (status !== "deleted" || !path.startsWith(prefix)) continue;
		const rest = path.slice(prefix.length).split("/");
		const name = rest[0]!;
		found.set(name, (found.get(name) ?? false) || rest.length > 1);
	}
	return [...found].map(([name, dir]) => ({ name, dir }));
}

function compareEntries(a: TreeEntry, b: TreeEntry): number {
	if (a.dir !== b.dir) return a.dir ? -1 : 1;
	const left = a.name.toLowerCase();
	const right = b.name.toLowerCase();
	return left < right ? -1 : left > right ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * The rows an explorer shows: the root's entries, plus the entries of every
 * expanded folder under them, folders first, then by case-insensitive name.
 */
export function visibleRows(list: ListDir, snapshot: GitSnapshot, expanded: ReadonlySet<string>): TreeRow[] {
	const rows: TreeRow[] = [];
	const walk = (parent: string, depth: number) => {
		const entries = new Map<string, TreeEntry>();
		for (const entry of list(parent)) if (!HIDDEN.has(entry.name)) entries.set(entry.name, entry);
		for (const entry of deletedChildren(snapshot, parent)) if (!entries.has(entry.name)) entries.set(entry.name, entry);
		for (const entry of [...entries.values()].sort(compareEntries)) {
			const path = childPath(parent, entry.name);
			const open = entry.dir && expanded.has(path);
			rows.push({ path, name: entry.name, depth, dir: entry.dir, expanded: open, status: statusOf(snapshot, path, entry.dir) });
			if (open) walk(path, depth + 1);
		}
	};
	walk("", 0);
	return rows;
}

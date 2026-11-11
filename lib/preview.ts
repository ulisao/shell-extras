import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { runGit, type GitRunner } from "./git-status.ts";

export interface PreviewContent {
	kind: "text" | "binary" | "missing" | "dir";
	lines: string[];
	/** True when only the first `maxBytes` were read. */
	truncated: boolean;
	/** Where the bytes came from: the worktree, or HEAD for a deleted file. */
	source: "disk" | "HEAD";
}

const MAX_BYTES = 512 * 1024;

/**
 * Make file text safe to paint: tabs become two spaces and every other control
 * character (escape sequences included) is dropped, so a file can never move
 * the cursor or recolor the terminal.
 */
export function sanitizeLine(line: string): string {
	return line.replace(/\t/g, "  ").replace(/[\x00-\x08\x0b-\x1f\x7f\u0080-\u009f]/g, "");
}

function decode(bytes: Buffer, truncated: boolean, source: PreviewContent["source"]): PreviewContent {
	if (bytes.subarray(0, 8000).includes(0)) return { kind: "binary", lines: [], truncated: false, source };
	const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
	const lines = text.split(/\r?\n/).map(sanitizeLine);
	if (lines.length > 1 && lines[lines.length - 1] === "" && !truncated) lines.pop();
	return { kind: "text", lines, truncated, source };
}

/** Load a repository-relative path for the preview overlay. */
export async function loadPreview(root: string, path: string, git: GitRunner = runGit, maxBytes = MAX_BYTES): Promise<PreviewContent> {
	const absolute = join(root, ...path.split("/"));
	try {
		const info = await stat(absolute);
		if (info.isDirectory()) return { kind: "dir", lines: [], truncated: false, source: "disk" };
		const handle = await open(absolute, "r");
		try {
			const size = Math.min(info.size, maxBytes);
			const buffer = Buffer.alloc(size);
			const { bytesRead } = await handle.read(buffer, 0, size, 0);
			return decode(buffer.subarray(0, bytesRead), info.size > maxBytes, "disk");
		} finally {
			await handle.close();
		}
	} catch {
		// A deleted file still has its last committed content.
		try {
			const text = await git(root, ["show", `HEAD:${path}`]);
			const bytes = Buffer.from(text, "utf8");
			return decode(bytes.subarray(0, maxBytes), bytes.length > maxBytes, "HEAD");
		} catch {
			return { kind: "missing", lines: [], truncated: false, source: "disk" };
		}
	}
}

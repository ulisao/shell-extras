import { diskLister, visibleRows, type ListDir, type TreeRow } from "./file-tree.ts";
import { EMPTY_SNAPSHOT, findGitRoot, readGitSnapshot, runGit, type GitRunner, type GitSnapshot } from "./git-status.ts";

export interface ExplorerModelOptions {
	git?: GitRunner;
	/** Builds the folder lister for a root; the real file system by default. */
	list?: (root: string) => ListDir;
}

/**
 * What the explorer shows: the tree of the Git root (or cwd outside Git),
 * its Git status and which folders are open. The rail and the overlay both
 * read this one model.
 */
export class ExplorerModel {
	/** The Git root once the first refresh resolved it; the cwd until then. */
	root: string;
	snapshot: GitSnapshot = EMPTY_SNAPSHOT;
	readonly expanded = new Set<string>();
	rows: TreeRow[] = [];
	/** Non-ignored entries in the Git status. */
	changed = 0;
	/** Moves up whenever the rows, the status or the root change. */
	version = 0;

	private readonly git: GitRunner;
	private readonly makeLister: (root: string) => ListDir;
	private rootResolved = false;
	private signature = "";
	private running?: Promise<void>;
	private again = false;
	private readonly listeners = new Set<() => void>();

	constructor(cwd: string, options: ExplorerModelOptions = {}) {
		this.root = cwd;
		this.git = options.git ?? runGit;
		this.makeLister = options.list ?? diskLister;
	}

	/** Call `listener` after every version bump. Returns the unsubscribe function. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Open or close a folder. Recomputes the rows from disk only, never runs Git. */
	toggle(path: string): void {
		if (!this.expanded.delete(path)) this.expanded.add(path);
		this.rows = visibleRows(this.makeLister(this.root), this.snapshot, this.expanded);
		this.signature = this.signatureOf();
		this.bump();
	}

	/**
	 * Re-read Git and the disk. Concurrent calls share one in-flight run; calls
	 * that arrive during it schedule exactly one follow-up run, so the last
	 * caller always sees state read after its call. Never rejects.
	 */
	refresh(): Promise<void> {
		if (this.running) {
			this.again = true;
			return this.running;
		}
		const run = this.drain().finally(() => {
			if (this.running === run) this.running = undefined;
		});
		this.running = run;
		return run;
	}

	private async drain(): Promise<void> {
		do {
			this.again = false;
			try {
				await this.readOnce();
			} catch {
				// A failed read keeps what is shown; the next refresh tries again.
			}
		} while (this.again);
	}

	private async readOnce(): Promise<void> {
		if (!this.rootResolved) {
			this.root = (await findGitRoot(this.root, this.git)) ?? this.root;
			this.rootResolved = true;
		}
		let snapshot = EMPTY_SNAPSHOT;
		try {
			snapshot = await readGitSnapshot(this.root, this.git);
		} catch {
			snapshot = EMPTY_SNAPSHOT;
		}
		this.snapshot = snapshot;
		this.changed = [...snapshot.files.values()].filter((status) => status !== "ignored").length;
		this.rows = visibleRows(this.makeLister(this.root), snapshot, this.expanded);
		const signature = this.signatureOf();
		if (signature !== this.signature) {
			this.signature = signature;
			this.bump();
		}
	}

	private signatureOf(): string {
		const rows = this.rows.map((row) => `${row.path}|${row.dir ? 1 : 0}|${row.expanded ? 1 : 0}|${row.status ?? ""}`);
		return [this.root, String(this.changed), ...rows].join("\n");
	}

	private bump(): void {
		this.version++;
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// A broken subscriber must not stop the others.
			}
		}
	}
}

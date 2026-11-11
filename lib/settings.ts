import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where shell-extras keeps its own state; `SHELL_EXTRAS_HOME` overrides it (tests). */
export function extrasHome(): string {
	return process.env.SHELL_EXTRAS_HOME || join(homedir(), ".gentle-shell", "shell-extras");
}

/**
 * A tiny JSON key/value file. Gentle Shell's visual settings reject unknown
 * keys, so the package keeps its choices here. A missing or corrupt file
 * reads as empty; a failed write keeps the value in memory only.
 */
export class Settings {
	private values: Record<string, unknown>;
	readonly file: string;

	constructor(file: string = join(extrasHome(), "settings.json")) {
		this.file = file;
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8"));
			this.values = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		} catch {
			this.values = {};
		}
	}

	get<T = unknown>(key: string): T | undefined {
		return this.values[key] as T | undefined;
	}

	set(key: string, value: unknown): void {
		this.values = { ...this.values, [key]: value };
		try {
			mkdirSync(dirname(this.file), { recursive: true });
			writeFileSync(this.file, `${JSON.stringify(this.values, null, "\t")}\n`);
		} catch {
			// Settings are a convenience; the session keeps working without them.
		}
	}
}

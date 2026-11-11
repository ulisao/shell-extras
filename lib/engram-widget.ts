import type { ExplorerTheme } from "./explorer-view.ts";
import { fitLine } from "./explorer-view.ts";
import type { RailWidget } from "./tabs.ts";

/** Engram tools that write memory. */
export const SAVE_TOOLS = new Set(["mem_save", "mem_update", "mem_session_summary", "mem_capture_passive"]);

export const RECALL_PROMPT =
	"Save a session summary to Engram now with mem_session_summary (Goal, Discoveries, Accomplished, Next Steps, Relevant Files). This was requested manually from the sidebar.";

const REQUEST_SHOWN_MS = 10_000;

export interface LastSave {
	at: number;
	tool: string;
}

export function relativeTime(at: number, now: number): string {
	const minutes = Math.floor((now - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return `${Math.floor(hours / 24)} d ago`;
}

export function renderEngram(info: { lastSave?: LastSave; now: number; requested: boolean }, theme: ExplorerTheme, width: number): { lines: string[]; actions: Array<"recall" | undefined> } {
	const last = info.lastSave;
	const lines = [
		fitLine(`  ${theme.fg("accent", "󰆼")} last saved`, last ? theme.bold(relativeTime(last.at, info.now)) : theme.fg("muted", "never"), width),
		fitLine(`    ${theme.fg("muted", last ? `${last.tool} · ${new Date(last.at).toLocaleTimeString()}` : "no Engram save seen yet")}`, "", width),
		info.requested ? fitLine(`    ${theme.fg("success", "✓ pedido enviado")}`, "", width) : fitLine(`    ${theme.fg("accent", theme.bold("⟳ recordar ahora"))}`, "", width),
	];
	return { lines, actions: [undefined, undefined, "recall"] };
}

interface Store {
	get<T>(key: string): T | undefined;
	set(key: string, value: unknown): void;
}

export type SendUserMessage = (text: string, options?: { deliverAs: "followUp" }) => void;

export class EngramModel {
	lastSave: LastSave | undefined;
	requestedAt: number | undefined;
	version = 0;
	readonly now: () => number;
	private readonly settings: Store;
	private readonly isIdle: () => boolean;
	private readonly send: SendUserMessage;

	constructor(settings: Store, now: () => number, isIdle: () => boolean, send: SendUserMessage) {
		this.settings = settings;
		this.now = now;
		this.isIdle = isIdle;
		this.send = send;
		const saved = settings.get<LastSave>("engramLastSave");
		this.lastSave = saved && typeof saved.at === "number" && typeof saved.tool === "string" ? saved : undefined;
	}

	/** Records a finished tool call; true when it was a successful Engram save. */
	record(toolName: string, isError: boolean): boolean {
		if (isError || !SAVE_TOOLS.has(toolName)) return false;
		this.lastSave = { at: this.now(), tool: toolName };
		this.settings.set("engramLastSave", this.lastSave);
		this.version++;
		return true;
	}

	requested(): boolean {
		return this.requestedAt !== undefined && this.now() - this.requestedAt < REQUEST_SHOWN_MS;
	}

	/** Asks the agent to save a session summary; a follow-up while it is busy. */
	recall(): void {
		if (this.requested()) return;
		this.requestedAt = this.now();
		this.version++;
		if (this.isIdle()) this.send(RECALL_PROMPT);
		else this.send(RECALL_PROMPT, { deliverAs: "followUp" });
	}
}

export function createEngramWidget(model: EngramModel, theme: ExplorerTheme): RailWidget {
	let actions: Array<"recall" | undefined> = [];
	return {
		render(width) {
			const frame = renderEngram({ lastSave: model.lastSave, now: model.now(), requested: model.requested() }, theme, width);
			actions = frame.actions;
			return frame.lines;
		},
		digest: () => [model.version, Math.floor(model.now() / 60_000), model.requested()].join("|"),
		summary: () => (model.lastSave ? `saved ${relativeTime(model.lastSave.at, model.now())}` : "Engram"),
		handleMouse(event) {
			if (event.type !== "click" || event.button !== "left" || actions[event.y] !== "recall") return undefined;
			model.recall();
			return { handled: true, render: true };
		},
	};
}

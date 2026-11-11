import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExplorerTheme } from "./explorer-view.ts";
import { fitLine } from "./explorer-view.ts";
import type { RailWidget } from "./tabs.ts";

const API = "https://api.spotify.com/v1";

export interface Player {
	playing: boolean;
	progress: number;
	duration: number;
	track: string;
	artists: string;
	device: string;
	volume: number | undefined;
	shuffle: boolean;
	repeat: "off" | "context" | "track";
}

export interface SpotifyState {
	status: "ok" | "logged-out" | "error" | "loading";
	player?: Player;
	error?: string;
}

export type SpotifyAction = "previous" | "toggle" | "next" | "shuffle" | "repeat" | "volumeDown" | "volumeUp";

export function parsePlayer(data: any): Player | undefined {
	if (!data || !data.item) return undefined;
	const repeat = data.repeat_state === "track" || data.repeat_state === "context" ? data.repeat_state : "off";
	return {
		playing: Boolean(data.is_playing),
		progress: Number(data.progress_ms ?? 0),
		duration: Number(data.item.duration_ms ?? 0),
		track: String(data.item.name ?? ""),
		artists: Array.isArray(data.item.artists) ? data.item.artists.map((artist: any) => artist?.name).filter(Boolean).join(", ") : String(data.item.show?.name ?? ""),
		device: String(data.device?.name ?? ""),
		volume: typeof data.device?.volume_percent === "number" ? data.device.volume_percent : undefined,
		shuffle: Boolean(data.shuffle_state),
		repeat,
	};
}

export function formatTime(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface Span {
	row: number;
	start: number;
	end: number;
	action: SpotifyAction;
}

function meter(value: number, total: number, size: number): string {
	const filled = total > 0 ? Math.round((Math.min(value, total) / total) * size) : 0;
	return "━".repeat(filled) + "─".repeat(size - filled);
}

/** The Spotify tab; `spans` are the clickable controls (row and columns). */
export function renderSpotify(state: SpotifyState, theme: ExplorerTheme, width: number): { lines: string[]; spans: Span[] } {
	const lines: string[] = [];
	const spans: Span[] = [];
	if (state.status === "logged-out") {
		lines.push(fitLine(`  ${theme.fg("muted", "not connected")}`, "", width));
		lines.push(fitLine(`  ${theme.fg("accent", "/spotify login <client-id>")}`, "", width));
		return { lines, spans };
	}
	if (state.status === "error") lines.push(fitLine(`  ${theme.fg("error", `✗ ${state.error ?? "Spotify error"}`)}`, "", width));
	const player = state.player;
	if (!player) {
		lines.push(fitLine(`  ${theme.fg("muted", state.status === "loading" ? "…" : "nothing playing")}`, "", width));
		return { lines, spans };
	}
	const offset = lines.length;
	lines.push(fitLine(`  ${theme.fg("success", "♫")} ${theme.bold(player.track)}`, "", width));
	lines.push(fitLine(`    ${theme.fg("muted", player.artists)}`, theme.fg("dim", player.device), width));
	const time = `${formatTime(player.progress)} / ${formatTime(player.duration)}`;
	const size = Math.max(4, width - visibleWidth(time) - 7);
	lines.push(fitLine(`    ${theme.fg("accent", meter(player.progress, player.duration, size))}`, theme.fg("muted", time), width));
	// Controls: fixed columns so clicks map without parsing escape codes.
	const controls: Array<{ label: string; action: SpotifyAction; role: string }> = [
		{ label: "⏮", action: "previous", role: "text" },
		{ label: player.playing ? "⏸" : "▶", action: "toggle", role: "accent" },
		{ label: "⏭", action: "next", role: "text" },
		{ label: "🔀", action: "shuffle", role: player.shuffle ? "success" : "muted" },
		{ label: player.repeat === "track" ? "🔂" : "🔁", action: "repeat", role: player.repeat === "off" ? "muted" : "success" },
	];
	let text = "    ";
	let column = 4;
	for (const control of controls) {
		const size = visibleWidth(control.label);
		spans.push({ row: offset + 3, start: column, end: column + size, action: control.action });
		text += theme.fg(control.role, control.label) + "   ";
		column += size + 3;
	}
	lines.push(fitLine(text.trimEnd(), "", width));
	if (player.volume !== undefined) {
		const row = offset + 4;
		const label = `${player.volume}%`;
		spans.push({ row, start: 4, end: 7, action: "volumeDown" });
		const bar = meter(player.volume, 100, 10);
		const plus = 4 + 3 + 1 + 10 + 1;
		spans.push({ row, start: plus, end: plus + 3, action: "volumeUp" });
		lines.push(fitLine(`    ${theme.fg("accent", "[-]")} ${theme.fg("muted", bar)} ${theme.fg("accent", "[+]")}`, label, width));
	}
	return { lines, spans };
}

type TokenSource = () => Promise<string | undefined>;
const VOLUME_STEP = 10;
const NEXT_REPEAT: Record<Player["repeat"], Player["repeat"]> = { off: "context", context: "track", track: "off" };

export class SpotifyModel {
	state: SpotifyState = { status: "loading" };
	version = 0;
	/** When the last player snapshot was taken, to move progress on between polls. */
	private polledAt = 0;
	private listeners = new Set<() => void>();
	private readonly token: TokenSource;
	private readonly fetcher: typeof fetch;
	readonly now: () => number;

	constructor(token: TokenSource, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
		this.token = token;
		this.fetcher = fetcher;
		this.now = now;
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private set(state: SpotifyState): void {
		this.state = state;
		this.version++;
		for (const listener of this.listeners) listener();
	}

	/** The player with its progress moved on since the last poll. */
	live(): SpotifyState {
		const player = this.state.player;
		if (!player?.playing) return this.state;
		return { ...this.state, player: { ...player, progress: Math.min(player.duration, player.progress + (this.now() - this.polledAt)) } };
	}

	private async request(method: string, path: string): Promise<Response | undefined> {
		const token = await this.token();
		if (!token) {
			this.set({ status: "logged-out" });
			return undefined;
		}
		return this.fetcher(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
	}

	private async fail(response: Response): Promise<void> {
		let message = `Spotify answered ${response.status}`;
		try {
			const body = (await response.json()) as { error?: { message?: string } };
			if (body?.error?.message) message = body.error.message;
		} catch {
			// Keep the status message.
		}
		this.set({ ...this.state, status: "error", error: message });
	}

	async refresh(): Promise<void> {
		try {
			const response = await this.request("GET", "/me/player");
			if (!response) return;
			if (response.status === 204) {
				this.polledAt = this.now();
				this.set({ status: "ok", player: undefined });
				return;
			}
			if (!response.ok) return this.fail(response);
			const player = parsePlayer(await response.json());
			this.polledAt = this.now();
			this.set({ status: "ok", player });
		} catch (error) {
			this.set({ ...this.state, status: "error", error: (error as Error).message });
		}
	}

	async control(action: SpotifyAction): Promise<void> {
		const player = this.live().player;
		const volume = player?.volume ?? 50;
		const route: Record<SpotifyAction, [string, string]> = {
			previous: ["POST", "/me/player/previous"],
			next: ["POST", "/me/player/next"],
			toggle: ["PUT", player?.playing === false ? "/me/player/play" : "/me/player/pause"],
			shuffle: ["PUT", `/me/player/shuffle?state=${!(player?.shuffle ?? false)}`],
			repeat: ["PUT", `/me/player/repeat?state=${NEXT_REPEAT[player?.repeat ?? "off"]}`],
			volumeUp: ["PUT", `/me/player/volume?volume_percent=${Math.min(100, volume + VOLUME_STEP)}`],
			volumeDown: ["PUT", `/me/player/volume?volume_percent=${Math.max(0, volume - VOLUME_STEP)}`],
		};
		try {
			const response = await this.request(...route[action]);
			if (!response) return;
			if (!response.ok) return this.fail(response);
		} catch (error) {
			this.set({ ...this.state, status: "error", error: (error as Error).message });
		}
	}
}

export function createSpotifyWidget(model: SpotifyModel, theme: ExplorerTheme, afterControl: () => void = () => undefined): RailWidget {
	let spans: Span[] = [];
	return {
		render(width) {
			const frame = renderSpotify(model.live(), theme, width);
			spans = frame.spans;
			return frame.lines;
		},
		digest: () => [model.version, model.state.player?.playing ? Math.floor(model.now() / 1000) : ""].join("|"),
		summary: () => (model.state.player ? `${model.state.player.playing ? "▶" : "⏸"} ${model.state.player.track}` : "Spotify"),
		handleMouse(event) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			const span = spans.find((candidate) => candidate.row === event.y && event.x >= candidate.start && event.x < candidate.end + 1);
			if (!span) return undefined;
			void model.control(span.action).then(afterControl);
			return { handled: true, render: true };
		},
	};
}

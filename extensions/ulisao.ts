import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ULISAO_FRAMES, ulisaoFrame } from "../lib/ulisao.ts";
import { numberFromEnv } from "../lib/widget-extension.ts";

const PART_KEY = "shell-extras.ulisao";
const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

interface SharedState {
	active?: boolean;
	parts: Map<string, unknown>;
}

/**
 * The Ulisao bot floating at the bottom of the fullscreen rail. Pure UI: a
 * bottom-anchored section (gentle-shell `section.anchor`) with no mouse
 * handling, animated only while the rail is on screen.
 */
export default function ulisao(pi: ExtensionAPI): void {
	let current: ExtensionContext | undefined;

	pi.on("session_start", (_event, ctx) => {
		current = ctx;
		if (ctx.mode !== "tui" || process.env.SHELL_EXTRAS_ULISAO === "0") return;
		ctx.ui.setWidget(
			PART_KEY,
			(tui, theme) => {
				const terminal = (tui as { terminal?: object }).terminal;
				let state: SharedState | undefined;
				let timer: ReturnType<typeof setInterval> | undefined;
				let frame = 0;
				const part = {
					section: { order: 1000, anchor: "bottom" as const },
					digest: () => String(frame),
					render: (width: number) => ulisaoFrame(frame, theme, width),
					invalidate() {},
				};
				if (terminal) {
					const holder = terminal as unknown as Record<symbol, SharedState | undefined>;
					state = holder[SIDEBAR_STATE] ??= { active: false, parts: new Map() };
					state.parts.set(PART_KEY, part);
					timer = setInterval(() => {
						if (!state?.active) return;
						frame = (frame + 1) % ULISAO_FRAMES;
						tui.requestRender();
					}, Math.max(5, numberFromEnv("SHELL_EXTRAS_ULISAO_MS", 400)));
					timer.unref?.();
				}
				return {
					render: () => [],
					invalidate() {},
					dispose() {
						if (timer) clearInterval(timer);
						if (state?.parts.get(PART_KEY) === part) state.parts.delete(PART_KEY);
					},
				};
			},
			{ placement: "belowEditor" },
		);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		try {
			if ((current ?? ctx).mode === "tui") (current ?? ctx).ui.setWidget(PART_KEY, undefined);
		} catch {
			// The UI may already be gone while shutting down.
		}
		current = undefined;
	});
}

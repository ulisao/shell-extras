import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ExplorerModel } from "../lib/explorer-model.ts";
import { ExplorerOverlay } from "../lib/explorer-overlay.ts";
import { createRailPart, type SidebarState } from "../lib/explorer-rail.ts";
import type { TreeRow } from "../lib/file-tree.ts";

const PART_KEY = "shell-extras.files";
const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
const OVERLAY_OPTIONS = { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" } as const;

function numberFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? value : fallback;
}

/**
 * A file explorer for the Gentle Shell fullscreen rail. The rail section talks
 * to the host only through the shared sidebar state (the `section` opt-in);
 * `/files` opens the same tree as a keyboard-navigable overlay.
 */
export default function fileExplorer(pi: ExtensionAPI): void {
	let current: ExtensionContext | undefined;
	let model: ExplorerModel | undefined;
	let sidebar: SidebarState | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let overlayOpen = false;

	const stopPolling = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	};

	const railVisible = () => Boolean(sidebar?.active && sidebar.ownsHost?.());

	const startPolling = () => {
		const interval = numberFromEnv("SHELL_EXTRAS_FILES_POLL_MS", 3000);
		if (!(interval > 0)) return;
		timer = setInterval(() => {
			if (overlayOpen || railVisible()) void model?.refresh();
		}, interval);
		timer.unref();
	};

	async function openOverlay(ctx: ExtensionContext, row?: TreeRow): Promise<void> {
		if (!model || overlayOpen) return;
		const shared = model;
		overlayOpen = true;
		void shared.refresh();
		try {
			await ctx.ui.custom<null>(
				(tui, theme, _keybindings, done) => {
					const close = () => {
						done(null);
						tui.requestRender(true);
					};
					return new ExplorerOverlay({ model: shared, theme, rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close, preview: row });
				},
				{ overlay: true, overlayOptions: OVERLAY_OPTIONS },
			);
		} catch {
			// The overlay is a convenience; a failed paint must not break the session.
		} finally {
			overlayOpen = false;
		}
	}

	pi.on("session_start", (_event, ctx) => {
		stopPolling();
		current = ctx;
		const shared = new ExplorerModel(ctx.cwd);
		model = shared;
		void shared.refresh();
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			PART_KEY,
			(tui, theme) => {
				const terminal = (tui as { terminal?: { rows: number } }).terminal;
				let rail: ReturnType<typeof createRailPart> | undefined;
				let state: SidebarState | undefined;
				if (terminal) {
					const holder = terminal as unknown as Record<symbol, SidebarState | undefined>;
					state = holder[SIDEBAR_STATE] ??= { active: false, parts: new Map() };
					rail = createRailPart({
						model: shared,
						theme,
						state,
						rows: () => terminal.rows,
						requestRender: () => tui.requestRender(),
						order: numberFromEnv("SHELL_EXTRAS_FILES_ORDER", 50),
						openPreview: (row) => {
							if (current) void openOverlay(current, row);
						},
					});
					state.parts.set(PART_KEY, rail);
					sidebar = state;
				}
				return {
					render: () => [],
					invalidate() {},
					dispose() {
						rail?.dispose();
						if (state && state.parts.get(PART_KEY) === rail) state.parts.delete(PART_KEY);
						if (sidebar === state) sidebar = undefined;
					},
				};
			},
			{ placement: "belowEditor" },
		);
		startPolling();
	});

	pi.on("turn_end", () => void model?.refresh());
	pi.on("agent_end", () => void model?.refresh());

	pi.on("session_shutdown", (_event, ctx) => {
		stopPolling();
		try {
			if ((current ?? ctx).mode === "tui") (current ?? ctx).ui.setWidget(PART_KEY, undefined);
		} catch {
			// The UI may already be gone while shutting down.
		}
		current = undefined;
		model = undefined;
	});

	pi.registerCommand("files", {
		description: "Browse the repository files with their Git status",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/files needs the interactive terminal UI", "warning");
				return;
			}
			model ??= new ExplorerModel(ctx.cwd);
			await openOverlay(ctx, undefined);
		},
	});
}

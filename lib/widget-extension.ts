import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExplorerTheme } from "./explorer-view.ts";
import { Settings } from "./settings.ts";
import { tabsHost, type RailWidget, type TabsHost } from "./tabs.ts";

const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

interface SharedState {
	active?: boolean;
	ownsHost?: () => boolean;
	hover?: { owner: unknown; clear(): void };
	parts: Map<string, unknown>;
}

/** What one tab needs from the session while it is mounted. */
export interface TabContext {
	ctx: ExtensionContext;
	theme: ExplorerTheme;
	requestRender: () => void;
	/** Terminal rows, for widgets that size themselves. */
	rows: () => number;
}

export interface TabInstance {
	widget: RailWidget;
	/** Called on mount, on every poll while the tab is visible, and after each agent turn. */
	refresh?(): void | Promise<void>;
	dispose?(): void;
}

export interface TabWidgetSpec {
	/** Widget key for `ctx.ui.setWidget`, unique per package. */
	key: string;
	id: string;
	label: string;
	order: number;
	/** Poll interval while the tab is on screen; 0 disables polling. */
	pollMs: number;
	create(tab: TabContext): TabInstance;
}

export function numberFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? value : fallback;
}

/**
 * Wires one tab of the EXTRAS section into a Pi extension: it mounts the
 * widget through a blank below-editor widget (which hands us the TUI), adds
 * the tab to the shared host, polls only while the tab is visible, and
 * cleans up on shutdown. Outside the TUI it does nothing.
 */
export function registerTabWidget(pi: ExtensionAPI, spec: TabWidgetSpec): { visible(): boolean; refresh(): void } {
	let current: ExtensionContext | undefined;
	let instance: TabInstance | undefined;
	let state: SharedState | undefined;
	let host: TabsHost | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;

	const visible = () => Boolean(state?.active && state.ownsHost?.() && host?.isActive(spec.id) && host.expanded());
	const refresh = () => {
		try {
			void Promise.resolve(instance?.refresh?.()).catch(() => undefined);
		} catch {
			// A failed refresh keeps the last frame.
		}
	};
	const stop = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	};

	pi.on("session_start", (_event, ctx) => {
		stop();
		current = ctx;
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			spec.key,
			(tui, theme) => {
				const terminal = (tui as { terminal?: { rows: number } }).terminal;
				let mounted: TabInstance | undefined;
				let mountedHost: TabsHost | undefined;
				if (terminal && current) {
					const holder = terminal as unknown as Record<symbol, SharedState | undefined>;
					const shared = (holder[SIDEBAR_STATE] ??= { active: false, parts: new Map() });
					const requestRender = () => tui.requestRender();
					mounted = spec.create({ ctx: current, theme, requestRender, rows: () => terminal.rows });
					mountedHost = tabsHost(shared, { theme, requestRender, settings: new Settings(), order: numberFromEnv("SHELL_EXTRAS_ORDER", 50) });
					mountedHost.add({ id: spec.id, label: spec.label, order: spec.order, widget: mounted.widget, onShow: refresh });
					instance = mounted;
					state = shared;
					host = mountedHost;
					refresh();
				}
				return {
					render: () => [],
					invalidate() {},
					dispose() {
						if (mounted) {
							mountedHost?.remove(spec.id, mounted.widget);
							mounted.dispose?.();
						}
						if (instance === mounted) {
							instance = undefined;
							state = undefined;
							host = undefined;
						}
					},
				};
			},
			{ placement: "belowEditor" },
		);
		if (spec.pollMs > 0) {
			timer = setInterval(() => {
				if (visible()) refresh();
			}, spec.pollMs);
			timer.unref?.();
		}
	});

	pi.on("agent_end", () => refresh());

	pi.on("session_shutdown", (_event, ctx) => {
		stop();
		try {
			if ((current ?? ctx).mode === "tui") (current ?? ctx).ui.setWidget(spec.key, undefined);
		} catch {
			// The UI may already be gone while shutting down.
		}
		current = undefined;
	});

	return { visible, refresh };
}

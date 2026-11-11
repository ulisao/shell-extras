import { truncateToWidth, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExplorerTheme } from "./explorer-view.ts";
import { fitLine } from "./explorer-view.ts";
import type { Settings } from "./settings.ts";

/** What a tab shows: lines for the rail width, plus optional mouse handling on its own rows. */
export interface RailWidget {
	render(width: number): string[];
	/** Cheap digest of what the widget paints; the rail re-renders only when it changes. */
	digest?(): string;
	/** Receives events with `y` relative to the widget's own lines. */
	handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined;
	/** Short text on the right of the section header while this tab is active. */
	summary?(): string;
}

export interface Tab {
	id: string;
	label: string;
	order: number;
	widget: RailWidget;
	/** Called when the user switches to this tab, so it can fetch fresh data. */
	onShow?(): void;
}

export interface TabsSidebarState {
	parts: Map<string, unknown>;
	hover?: { owner: unknown; clear(): void };
}

export interface TabsHostOptions {
	theme: ExplorerTheme;
	requestRender: () => void;
	settings: Settings;
	/** Rail order of the whole section (default 50, above the built-in Todos). */
	order?: number;
}

export interface TabsHost {
	add(tab: Tab): void;
	/** Removes the tab only while it still holds this widget. */
	remove(id: string, widget: RailWidget): void;
	select(id: string): void;
	isActive(id: string): boolean;
	/** The widget a tab holds, if the tab exists. */
	widget(id: string): RailWidget | undefined;
	/** True while the section shows a body (not folded). */
	expanded(): boolean;
}

export const TABS_PART_KEY = "shell-extras.tabs";
const HOST = Symbol.for("shell-extras.tabs.host");
const HANDLED: TuiMouseEventResult = { handled: true, render: true };
/** Rows above the active widget: the header and the tab bar. */
const CHROME_ROWS = 2;
const INDENT = 2;
const GAP = 2;

interface TabSpan {
	id: string;
	start: number;
	end: number;
}

/**
 * The tab bar: `  [ Files ]  Git  Music`. The active tab is painted with the
 * selection background and framed so it reads even without colors.
 */
export function renderTabBar(tabs: readonly Tab[], active: string | undefined, theme: ExplorerTheme, width: number, hover?: string): { line: string; spans: TabSpan[] } {
	const spans: TabSpan[] = [];
	let text = " ".repeat(INDENT);
	let column = INDENT;
	for (const [index, tab] of tabs.entries()) {
		if (index > 0) {
			text += " ".repeat(GAP);
			column += GAP;
		}
		const isActive = tab.id === active;
		const label = isActive ? `[ ${tab.label} ]` : tab.label;
		const size = visibleWidth(label);
		if (column + size > width) break;
		const painted = isActive
			? (theme.bg ? theme.bg("selectedBg", theme.fg("accent", theme.bold(label))) : theme.fg("accent", theme.bold(label)))
			: theme.fg(tab.id === hover ? "warning" : "muted", label);
		spans.push({ id: tab.id, start: column, end: column + size });
		text += painted;
		column += size;
	}
	const line = truncateToWidth(text, width, "");
	return { line: line + " ".repeat(Math.max(0, width - visibleWidth(line))), spans };
}

/**
 * One rail section, "EXTRAS", holding every shell-extras widget as a tab.
 * Extensions share it through the sidebar state, so each adds its own tabs
 * without knowing about the others.
 */
export function tabsHost(state: TabsSidebarState, options: TabsHostOptions): TabsHost {
	const holder = state as unknown as Record<symbol, TabsHost | undefined>;
	const existing = holder[HOST];
	if (existing) return existing;

	const { theme, settings } = options;
	const tabs: Tab[] = [];
	let activeId = settings.get<string>("activeTab");
	let collapsed = settings.get<boolean>("tabsCollapsed") === true;
	let headerHovered = false;
	let hoverTab: string | undefined;
	let spans: TabSpan[] = [];

	const active = (): Tab | undefined => tabs.find((tab) => tab.id === activeId) ?? tabs[0];
	const clearHover = () => {
		if (!headerHovered && hoverTab === undefined) return;
		headerHovered = false;
		hoverTab = undefined;
		options.requestRender();
	};

	const part = {
		section: { order: options.order ?? 50 },
		surface: "panel" as const,
		digest(): string {
			const current = active();
			return [tabs.map((tab) => tab.id).join(","), current?.id ?? "", collapsed, headerHovered, hoverTab ?? "", current?.widget.digest?.() ?? String(Date.now()), current?.widget.summary?.() ?? ""].join("|");
		},
		render(renderWidth: number): string[] {
			const current = active();
			if (!current) return [];
			const glyph = theme.fg(headerHovered ? "warning" : "muted", collapsed ? "▸" : "▾");
			const title = theme.fg(headerHovered ? "warning" : "text", theme.bold("EXTRAS"));
			const header = fitLine(`${glyph} ${title}`, theme.fg("muted", current.widget.summary?.() ?? current.label), renderWidth);
			if (collapsed) return [header];
			const bar = renderTabBar(tabs, current.id, theme, renderWidth, hoverTab);
			spans = bar.spans;
			return [header, bar.line, ...current.widget.render(renderWidth).map((line) => truncateToWidth(line, renderWidth, ""))];
		},
		invalidate(): void {},
		handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
			const current = active();
			if (!current) return undefined;
			if (event.y >= CHROME_ROWS) {
				if (collapsed) return undefined;
				return current.widget.handleMouse?.({ ...event, y: event.y - CHROME_ROWS });
			}
			if (event.type === "wheel") return undefined;
			const tabAt = event.y === 1 ? spans.find((span) => event.x >= span.start && event.x < span.end) : undefined;
			if (event.type === "move") {
				if (state.hover?.owner !== part) {
					const previous = state.hover;
					state.hover = { owner: part, clear: clearHover };
					previous?.clear();
				}
				const nextHeader = event.y === 0;
				const nextTab = tabAt?.id;
				if (nextHeader !== headerHovered || nextTab !== hoverTab) {
					headerHovered = nextHeader;
					hoverTab = nextTab;
					options.requestRender();
				}
				return undefined;
			}
			if (event.type !== "click" || event.button !== "left") return undefined;
			if (event.y === 0) {
				collapsed = !collapsed;
				settings.set("tabsCollapsed", collapsed);
				options.requestRender();
				return HANDLED;
			}
			if (!tabAt) return undefined;
			host.select(tabAt.id);
			return HANDLED;
		},
	};

	const host: TabsHost = {
		add(tab) {
			const index = tabs.findIndex((candidate) => candidate.id === tab.id);
			if (index >= 0) tabs.splice(index, 1);
			tabs.push(tab);
			tabs.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
			state.parts.set(TABS_PART_KEY, part);
			options.requestRender();
		},
		remove(id, widget) {
			const index = tabs.findIndex((tab) => tab.id === id && tab.widget === widget);
			if (index < 0) return;
			tabs.splice(index, 1);
			if (tabs.length === 0) {
				if (state.parts.get(TABS_PART_KEY) === part) state.parts.delete(TABS_PART_KEY);
				if (state.hover?.owner === part) state.hover = undefined;
				delete holder[HOST];
			}
			options.requestRender();
		},
		select(id) {
			if (!tabs.some((tab) => tab.id === id) || active()?.id === id) return;
			activeId = id;
			settings.set("activeTab", id);
			tabs.find((tab) => tab.id === id)?.onShow?.();
			options.requestRender();
		},
		isActive: (id) => active()?.id === id,
		widget: (id) => tabs.find((tab) => tab.id === id)?.widget,
		expanded: () => !collapsed,
	};
	holder[HOST] = host;
	return host;
}

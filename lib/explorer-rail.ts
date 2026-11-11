import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExplorerModel } from "./explorer-model.ts";
import { hitExplorer, renderExplorer, type ExplorerFrame, type ExplorerTheme } from "./explorer-view.ts";
import type { TreeRow } from "./file-tree.ts";

/** The shared hover contract: whoever owns the pointer, and how to drop its highlight. */
export interface SharedHover {
	owner: unknown;
	clear(): void;
}

/** The slice of the shared sidebar state this part uses. */
export interface SidebarState {
	active?: boolean;
	ownsHost?: () => boolean;
	hover?: SharedHover;
	parts: Map<string, unknown>;
}

export interface RailPartOptions {
	model: ExplorerModel;
	theme: ExplorerTheme;
	state: SidebarState;
	/** Terminal rows, read on every render and digest. */
	rows: () => number;
	requestRender: () => void;
	order: number;
	openPreview: (row: TreeRow) => void;
}

/** The rail section's body (below the header) is 45% of the terminal, at least 5 lines. */
export function railViewport(terminalRows: number): number {
	return Math.max(5, Math.floor(terminalRows * 0.45)) - 1;
}

const HANDLED_RENDER: TuiMouseEventResult = { handled: true, render: true };

export function createRailPart(options: RailPartOptions) {
	const { model, theme, state } = options;
	let collapsed = false;
	let scrollTop = 0;
	let hover: string | undefined;
	let headerHovered = false;
	let frame: ExplorerFrame | undefined;
	const unsubscribe = model.onChange(() => options.requestRender());

	const viewport = () => railViewport(options.rows());
	const draw = (width: number): ExplorerFrame =>
		renderExplorer(model.rows, theme, width, { collapsed, scrollTop, viewport: viewport(), hover, headerHovered }, { changed: model.changed });

	const clearHover = () => {
		if (hover === undefined && !headerHovered) return;
		hover = undefined;
		headerHovered = false;
		options.requestRender();
	};

	const claimHover = () => {
		if (state.hover?.owner === part) return;
		const previous = state.hover;
		state.hover = { owner: part, clear: clearHover };
		previous?.clear();
	};

	const part = {
		section: { order: options.order },
		surface: "panel" as const,
		digest: () => [model.version, collapsed, scrollTop, hover ?? "", headerHovered, viewport()].join("|"),
		render(width: number): string[] {
			frame = draw(width);
			scrollTop = frame.scrollTop;
			return frame.lines;
		},
		invalidate(): void {},
		handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
			const current = frame ?? draw(event.width || 80);
			if (event.type === "wheel") {
				const maxScroll = model.rows.length - viewport();
				if (collapsed || maxScroll <= 0) return undefined;
				scrollTop = Math.min(Math.max(0, scrollTop + Math.trunc(event.wheelDelta ?? 0)), maxScroll);
				options.requestRender();
				return HANDLED_RENDER;
			}
			if (event.type === "move") {
				claimHover();
				const hit = hitExplorer(current, event.y);
				const nextHover = hit?.kind === "row" ? hit.row.path : undefined;
				const nextHeader = hit?.kind === "header";
				if (nextHover !== hover || nextHeader !== headerHovered) {
					hover = nextHover;
					headerHovered = nextHeader;
					options.requestRender();
				}
				return undefined;
			}
			if (event.type !== "click" || event.button !== "left") return undefined;
			const hit = hitExplorer(current, event.y);
			if (!hit) return undefined;
			if (hit.kind === "header") collapsed = !collapsed;
			else if (hit.row.dir) model.toggle(hit.row.path);
			else options.openPreview(hit.row);
			options.requestRender();
			return HANDLED_RENDER;
		},
		dispose(): void {
			unsubscribe();
			if (state.hover?.owner === part) state.hover = undefined;
		},
	};
	return part;
}

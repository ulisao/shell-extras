import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEngramWidget, EngramModel } from "../lib/engram-widget.ts";
import { Settings } from "../lib/settings.ts";
import { registerTabWidget } from "../lib/widget-extension.ts";

/** The Engram tab: when memory was last saved, and a button that asks the agent to save a summary now. */
export default function engramTab(pi: ExtensionAPI): void {
	let ctx: ExtensionContext | undefined;
	let render: (() => void) | undefined;
	const model = new EngramModel(
		new Settings(),
		Date.now,
		() => ctx?.isIdle() ?? true,
		(text, options) => {
			try {
				if (options) pi.sendUserMessage(text, options);
				else pi.sendUserMessage(text);
			} catch (error) {
				ctx?.ui.notify(`Could not ask for an Engram save: ${(error as Error).message}`, "error");
			}
		},
	);

	pi.on("session_start", (_event, started) => {
		ctx = started;
	});
	pi.on("tool_execution_end", (event) => {
		if (model.record(event.toolName, event.isError)) render?.();
	});

	registerTabWidget(pi, {
		key: "shell-extras.engram",
		id: "engram",
		label: "Mem",
		order: 60,
		pollMs: 0,
		create({ theme, requestRender }) {
			render = requestRender;
			return {
				widget: createEngramWidget(model, theme),
				dispose: () => {
					if (render === requestRender) render = undefined;
				},
			};
		},
	});
}

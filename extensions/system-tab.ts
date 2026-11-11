import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSystemWidget, SystemModel } from "../lib/system-widget.ts";
import { numberFromEnv, registerTabWidget } from "../lib/widget-extension.ts";

/** The System tab: clock, CPU and RAM, and a 25/5 pomodoro. */
export default function systemTab(pi: ExtensionAPI): void {
	registerTabWidget(pi, {
		key: "shell-extras.system",
		id: "system",
		label: "Sys",
		order: 40,
		pollMs: numberFromEnv("SHELL_EXTRAS_SYSTEM_POLL_MS", 2000),
		create({ ctx, theme, requestRender }) {
			const model = new SystemModel({ notify: (message) => ctx.ui.notify(message, "info") });
			// The pomodoro keeps time (and notifies) even while another tab is shown.
			const ticker = setInterval(() => {
				if (!model.pomodoro.view().running) return;
				model.pomodoro.tick();
				requestRender();
			}, 1000);
			ticker.unref?.();
			return {
				widget: createSystemWidget(model, theme),
				refresh: () => {
					model.refresh();
					requestRender();
				},
				dispose: () => clearInterval(ticker),
			};
		},
	});
}

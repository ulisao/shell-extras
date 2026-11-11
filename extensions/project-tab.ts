import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createProjectWidget, ProjectModel } from "../lib/project-widget.ts";
import { numberFromEnv, registerTabWidget } from "../lib/widget-extension.ts";

/** The Project tab: ODD feature progress, package.json scripts, listening dev ports and Docker containers. */
export default function projectTab(pi: ExtensionAPI): void {
	registerTabWidget(pi, {
		key: "shell-extras.project",
		id: "project",
		label: "Proj",
		order: 30,
		pollMs: numberFromEnv("SHELL_EXTRAS_PROJECT_POLL_MS", 10000),
		create({ ctx, theme, requestRender }) {
			const model = new ProjectModel(ctx.cwd);
			const unsubscribe = model.onChange(requestRender);
			return { widget: createProjectWidget(model, theme), refresh: () => model.refresh(), dispose: unsubscribe };
		},
	});
}

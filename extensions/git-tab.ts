import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createGitWidget, GitWidgetModel } from "../lib/git-widget.ts";
import { numberFromEnv, registerTabWidget } from "../lib/widget-extension.ts";

/** The Git tab: branch, ahead/behind, working tree, and the branch's PR with its CI checks (via gh). */
export default function gitTab(pi: ExtensionAPI): void {
	registerTabWidget(pi, {
		key: "shell-extras.git",
		id: "git",
		label: "Git",
		order: 20,
		pollMs: numberFromEnv("SHELL_EXTRAS_GIT_POLL_MS", 5000),
		create({ ctx, theme, requestRender }) {
			const model = new GitWidgetModel(ctx.cwd);
			const unsubscribe = model.onChange(requestRender);
			return { widget: createGitWidget(model, theme), refresh: () => model.refresh(), dispose: unsubscribe };
		},
	});
}

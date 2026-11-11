import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createProjectWidget, launchCommand, ProjectModel, parseDockerPs, parseNetstat, parseOddProgress, parseTasklist, renderProject, scriptRunner } from "../lib/project-widget.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

function project(t: TestContext): string {
	const root = mkdtempSync(join(tmpdir(), "shell-extras-project-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { dev: "vite", test: "node --test" } }));
	mkdirSync(join(root, "odd", "tasks"), { recursive: true });
	writeFileSync(join(root, "odd", "tasks", "old.md"), "- [x] T1\n");
	writeFileSync(join(root, "odd", "tasks", "feature.md"), "# F\n- [x] T1 a\n- [ ] T2 b\n- [x] T3 c\n  - [ ] not a task line? still counted\n");
	utimesSync(join(root, "odd", "tasks", "old.md"), new Date(2020, 0, 1), new Date(2020, 0, 1));
	return root;
}

test("S4 the runner follows the lock file", () => {
	assert.equal(scriptRunner(["pnpm-lock.yaml", "package.json"]), "pnpm");
	assert.equal(scriptRunner(["yarn.lock"]), "yarn");
	assert.equal(scriptRunner(["bun.lockb"]), "bun");
	assert.equal(scriptRunner(["package.json"]), "npm");
});

test("S4 parseNetstat keeps listening TCP ports with their PID, once per port", () => {
	const text = [
		"  Proto  Local Address          Foreign Address        State           PID",
		"  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       4242",
		"  TCP    [::]:5173              [::]:0                 LISTENING       4242",
		"  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       77",
		"  TCP    127.0.0.1:50000        127.0.0.1:3000         ESTABLISHED     77",
	].join("\r\n");
	assert.deepEqual(parseNetstat(text), [{ port: 3000, pid: 77 }, { port: 5173, pid: 4242 }]);
});

test("S4 parseTasklist maps PIDs to image names", () => {
	assert.deepEqual(parseTasklist('"node.exe","4242","Console","1","50,000 K"\r\n"python.exe","77","Console","1","9 K"\r\n'), new Map([[4242, "node.exe"], [77, "python.exe"]]));
});

test("S4 parseDockerPs reads name, status and ports", () => {
	assert.deepEqual(parseDockerPs("db\tUp 2 hours\t0.0.0.0:5432->5432/tcp\nweb\tUp 5 minutes\t\n"), [
		{ name: "db", status: "Up 2 hours", ports: "0.0.0.0:5432->5432/tcp" },
		{ name: "web", status: "Up 5 minutes", ports: "" },
	]);
});

test("S4 parseOddProgress counts task checkboxes", () => {
	assert.deepEqual(parseOddProgress("- [x] T1\n- [ ] T2\n- [X] T3\nnot - [x]\n"), { done: 2, total: 3 });
});

test("S4 renderProject shows ODD progress, scripts, ports and containers, each with its action", () => {
	const frame = renderProject(
		{
			odd: { name: "sidebar-widgets", done: 3, total: 9 },
			scripts: ["dev", "test"],
			runner: "pnpm",
			ports: [{ port: 5173, pid: 1, process: "node.exe" }],
			docker: { status: "ok", containers: [{ name: "db", status: "Up 2 hours", ports: "5432" }] },
		},
		theme,
		40,
	);
	const lines = frame.lines.map(strip);
	assert.match(lines[0]!, /sidebar-widgets/);
	assert.match(lines[0]!, /3\/9$/);
	assert.ok(lines.some((line) => /▶ dev/.test(line)));
	assert.ok(lines.some((line) => /:5173/.test(line) && /node/.test(line)));
	assert.ok(lines.some((line) => /db/.test(line) && /Up 2 hours/.test(line)));
	const dev = lines.findIndex((line) => /▶ dev/.test(line));
	assert.deepEqual(frame.actions[dev], { kind: "script", name: "dev" });
	const port = lines.findIndex((line) => /:5173/.test(line));
	assert.deepEqual(frame.actions[port], { kind: "port", port: 5173 });
	for (const line of frame.lines) assert.ok(visibleWidth(line) <= 40);
});

test("S4 renderProject explains what is missing", () => {
	const lines = renderProject({ scripts: [], runner: "npm", ports: [], docker: { status: "unavailable", containers: [] } }, theme, 40).lines.map(strip).join("\n");
	assert.match(lines, /no package\.json scripts/);
	assert.match(lines, /no dev servers listening/);
	assert.match(lines, /docker not running/);
	assert.doesNotMatch(lines, /ODD/);
});

test("S4 launchCommand opens a new Windows Terminal tab in the project, or a console window", () => {
	assert.deepEqual(launchCommand("C:\\repo", "pnpm", "dev", true), { command: "wt.exe", args: ["-w", "0", "nt", "--title", "dev", "-d", "C:\\repo", "cmd", "/k", "pnpm run dev"] });
	assert.deepEqual(launchCommand("C:\\repo", "npm", "dev", false), { command: "cmd.exe", args: ["/c", "start", "dev", "/d", "C:\\repo", "cmd", "/k", "npm run dev"] });
});

test("S4 the model reads scripts and the newest ODD feature, and the widget runs the clicked action", async (t) => {
	const root = project(t);
	const run = async (command: string) => {
		if (command === "netstat") return "  TCP    127.0.0.1:3000   0.0.0.0:0   LISTENING   77\n  TCP    0.0.0.0:135   0.0.0.0:0   LISTENING   900\n";
		if (command === "tasklist") return '"node.exe","77","Console","1","1 K"\n"svchost.exe","900","Services","0","1 K"\n';
		if (command === "docker") throw new Error("daemon down");
		return "";
	};
	const actions: unknown[] = [];
	const model = new ProjectModel(root, run, (action) => void actions.push(action));
	await model.refresh();
	assert.deepEqual(model.info.scripts, ["dev", "test"]);
	assert.deepEqual(model.info.odd, { name: "feature", done: 2, total: 4 });
	assert.deepEqual(model.info.ports, [{ port: 3000, pid: 77, process: "node.exe" }], "system services are left out");
	assert.equal(model.info.docker.status, "unavailable");
	const widget = createProjectWidget(model, theme);
	const lines = widget.render(40).map(strip);
	widget.handleMouse!({ type: "click", button: "left", x: 3, y: lines.findIndex((line) => /▶ test/.test(line)) } as any);
	widget.handleMouse!({ type: "click", button: "left", x: 3, y: lines.findIndex((line) => /:3000/.test(line)) } as any);
	assert.equal(widget.handleMouse!({ type: "click", button: "left", x: 3, y: 0 } as any), undefined);
	assert.deepEqual(actions, [{ kind: "script", name: "test" }, { kind: "port", port: 3000 }]);
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import spotifyTab from "../extensions/spotify-tab.ts";

function fixture(t: TestContext) {
	const home = mkdtempSync(join(tmpdir(), "shell-extras-home-"));
	process.env.SHELL_EXTRAS_HOME = home;
	t.after(() => {
		delete process.env.SHELL_EXTRAS_HOME;
		rmSync(home, { recursive: true, force: true });
	});
	const commands = new Map<string, any>();
	const notices: Array<[string, string]> = [];
	spotifyTab({ on() {}, registerCommand: (name: string, command: any) => void commands.set(name, command) } as any);
	const ctx = { ui: { notify: (message: string, level: string) => void notices.push([message, level]) } };
	return { home, notices, run: (args: string) => commands.get("spotify").handler(args, ctx), command: commands.get("spotify") };
}

test("S2 /spotify status, unknown subcommands and a malformed client ID explain the usage", async (t) => {
	const f = fixture(t);
	assert.match(f.command.description, /login <client-id>/);
	await f.run("");
	await f.run("dance");
	await f.run("login not-an-id!");
	assert.deepEqual(f.notices.map(([, level]) => level), ["info", "warning", "error"]);
	assert.match(f.notices[0]![0], /not connected/);
	assert.match(f.notices[2]![0], /does not look like a Spotify client ID/);
	assert.equal(existsSync(join(f.home, "settings.json")), false, "a rejected ID is not saved");
});

test("S2 /spotify logout deletes the saved token", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "shell-extras-home-"));
	writeFileSync(join(home, "spotify-token.json"), JSON.stringify({ accessToken: "A", refreshToken: "R", expiresAt: Date.now() + 3_600_000 }));
	process.env.SHELL_EXTRAS_HOME = home;
	t.after(() => {
		delete process.env.SHELL_EXTRAS_HOME;
		rmSync(home, { recursive: true, force: true });
	});
	const commands = new Map<string, any>();
	const notices: string[] = [];
	spotifyTab({ on() {}, registerCommand: (name: string, command: any) => void commands.set(name, command) } as any);
	const ctx = { ui: { notify: (message: string) => void notices.push(message) } };
	await commands.get("spotify").handler("status", ctx);
	await commands.get("spotify").handler("logout", ctx);
	assert.equal(existsSync(join(home, "spotify-token.json")), false);
	assert.deepEqual(notices, ["Spotify is connected", "Spotify disconnected; the saved token was deleted"]);
});

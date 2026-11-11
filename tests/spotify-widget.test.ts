import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createSpotifyWidget, formatTime, parsePlayer, renderSpotify, SpotifyModel } from "../lib/spotify-widget.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const PLAYER = {
	is_playing: true,
	progress_ms: 83_000,
	shuffle_state: false,
	repeat_state: "off",
	device: { name: "PC", volume_percent: 60 },
	item: { name: "Song", duration_ms: 225_000, artists: [{ name: "A" }, { name: "B" }] },
};

test("S2 parsePlayer reads track, artists, device, progress, shuffle, repeat and volume", () => {
	assert.deepEqual(parsePlayer(PLAYER), { playing: true, progress: 83_000, duration: 225_000, track: "Song", artists: "A, B", device: "PC", volume: 60, shuffle: false, repeat: "off" });
	assert.equal(parsePlayer(undefined), undefined);
	assert.equal(parsePlayer({ is_playing: false, device: { name: "PC" } }), undefined, "no item, nothing to show");
});

test("S2 formatTime prints m:ss", () => {
	assert.equal(formatTime(83_000), "1:23");
	assert.equal(formatTime(5_000), "0:05");
});

test("S2 renderSpotify shows the track, progress, controls and volume within the width", () => {
	const frame = renderSpotify({ status: "ok", player: parsePlayer(PLAYER) }, theme, 40);
	const lines = frame.lines.map(strip);
	assert.match(lines[0]!, /Song/);
	assert.match(lines[1]!, /A, B/);
	assert.match(lines[2]!, /1:23 \/ 3:45/);
	const controls = lines.findIndex((line) => line.includes("⏮"));
	assert.ok(lines[controls]!.includes("⏸"), "pause shows while playing");
	const actions = frame.spans.filter((span) => span.row === controls).map((span) => span.action);
	assert.deepEqual(actions, ["previous", "toggle", "next", "shuffle", "repeat"]);
	const volume = lines.findIndex((line) => line.includes("60%"));
	assert.deepEqual(frame.spans.filter((span) => span.row === volume).map((span) => span.action), ["volumeDown", "volumeUp"]);
	for (const line of frame.lines) assert.ok(visibleWidth(line) <= 40);
});

test("S2 renderSpotify explains logged-out, idle and error states", () => {
	assert.match(renderSpotify({ status: "logged-out" }, theme, 40).lines.map(strip).join("\n"), /\/spotify login/);
	assert.match(renderSpotify({ status: "ok" }, theme, 40).lines.map(strip).join("\n"), /nothing playing/);
	assert.match(renderSpotify({ status: "error", error: "Premium required" }, theme, 40).lines.map(strip).join("\n"), /Premium required/);
});

function api(player: unknown = PLAYER) {
	const calls: string[] = [];
	const fetcher = (async (url: string, init: any) => {
		calls.push(`${init?.method ?? "GET"} ${url.replace("https://api.spotify.com/v1", "")} ${init?.headers?.authorization ?? ""}`);
		if (url.endsWith("/me/player") && (init?.method ?? "GET") === "GET") return { ok: true, status: player ? 200 : 204, json: async () => player };
		return { ok: true, status: 204, json: async () => undefined };
	}) as unknown as typeof fetch;
	return { calls, fetcher };
}

test("S2 the model polls the player with the access token and sends each control", async () => {
	const { calls, fetcher } = api();
	const model = new SpotifyModel(async () => "TOKEN", fetcher, () => 0);
	await model.refresh();
	assert.equal(model.state.player?.track, "Song");
	for (const action of ["toggle", "next", "previous", "shuffle", "repeat", "volumeUp", "volumeDown"] as const) await model.control(action);
	assert.deepEqual(calls.filter((call) => !call.startsWith("GET")), [
		"PUT /me/player/pause Bearer TOKEN",
		"POST /me/player/next Bearer TOKEN",
		"POST /me/player/previous Bearer TOKEN",
		"PUT /me/player/shuffle?state=true Bearer TOKEN",
		"PUT /me/player/repeat?state=context Bearer TOKEN",
		"PUT /me/player/volume?volume_percent=70 Bearer TOKEN",
		"PUT /me/player/volume?volume_percent=50 Bearer TOKEN",
	]);
});

test("S2 nothing playing (204) and logged out are distinct states", async () => {
	const idle = new SpotifyModel(async () => "T", api(null).fetcher, () => 0);
	await idle.refresh();
	assert.deepEqual(idle.state, { status: "ok", player: undefined });
	const out = new SpotifyModel(async () => undefined, api().fetcher, () => 0);
	await out.refresh();
	assert.equal(out.state.status, "logged-out");
});

test("S2 an API error is shown, not thrown", async () => {
	const fetcher = (async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "Player command failed: Premium required" } }) })) as unknown as typeof fetch;
	const model = new SpotifyModel(async () => "T", fetcher, () => 0);
	await model.control("next");
	assert.deepEqual(model.state, { status: "error", error: "Player command failed: Premium required" });
});

test("S2 progress moves on between polls while playing, and a click runs the control under the pointer", async () => {
	let now = 0;
	const { calls, fetcher } = api();
	const model = new SpotifyModel(async () => "T", fetcher, () => now);
	await model.refresh();
	const widget = createSpotifyWidget(model, theme);
	const lines = widget.render(40).map(strip);
	const before = widget.digest!();
	now = 2000;
	assert.match(widget.render(40).map(strip)[2]!, /1:25/);
	assert.notEqual(widget.digest!(), before);
	const row = lines.findIndex((line) => line.includes("⏭"));
	const result = widget.handleMouse!({ type: "click", button: "left", x: lines[row]!.indexOf("⏭"), y: row } as any);
	assert.deepEqual(result, { handled: true, render: true });
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(calls.some((call) => call.startsWith("POST /me/player/next")));
	assert.equal(widget.handleMouse!({ type: "click", button: "left", x: 0, y: 0 } as any), undefined);
});

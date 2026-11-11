import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { authorizeUrl, codeChallenge, exchangeCode, randomState, randomVerifier, TokenStore, waitForCallback, SCOPES } from "../lib/spotify-auth.ts";

function dir(t: TestContext): string {
	const path = mkdtempSync(join(tmpdir(), "shell-extras-spotify-"));
	t.after(() => rmSync(path, { recursive: true, force: true }));
	return path;
}

function fakeFetch(responses: Array<{ status: number; body?: unknown }>, calls: Array<{ url: string; init: any }>) {
	return (async (url: string, init: any) => {
		calls.push({ url, init });
		const next = responses.shift() ?? { status: 500 };
		return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body, text: async () => JSON.stringify(next.body ?? "") };
	}) as unknown as typeof fetch;
}

test("S2 the PKCE challenge is the unpadded base64url SHA-256 of the verifier", () => {
	for (const verifier of ["dBjftJeZ4CVP-mJ92IUN2dbhmJ5XIk2T9HgPzA4DbN4", randomVerifier()]) {
		const challenge = codeChallenge(verifier);
		assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
		assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
	}
	assert.match(randomVerifier(), /^[A-Za-z0-9_-]{43,128}$/);
	assert.notEqual(randomState(), randomState());
});

test("S2 the authorize URL asks for playback scopes with PKCE and state", () => {
	const url = new URL(authorizeUrl({ clientId: "abc", redirectUri: "http://127.0.0.1:8888/callback", challenge: "ch", state: "st" }));
	assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
	assert.equal(url.searchParams.get("client_id"), "abc");
	assert.equal(url.searchParams.get("response_type"), "code");
	assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:8888/callback");
	assert.equal(url.searchParams.get("code_challenge_method"), "S256");
	assert.equal(url.searchParams.get("code_challenge"), "ch");
	assert.equal(url.searchParams.get("state"), "st");
	assert.equal(url.searchParams.get("scope"), SCOPES.join(" "));
	assert.deepEqual(SCOPES, ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"]);
});

test("S2 the callback server accepts only the matching state on /callback, then closes", async () => {
	const pending = waitForCallback({ port: 0, state: "good", timeoutMs: 5000 });
	const port = await pending.port;
	const wrongPath = await fetch(`http://127.0.0.1:${port}/other?code=x&state=good`);
	assert.equal(wrongPath.status, 404);
	const wrongState = await fetch(`http://127.0.0.1:${port}/callback?code=x&state=bad`);
	assert.equal(wrongState.status, 400);
	const ok = await fetch(`http://127.0.0.1:${port}/callback?code=the-code&state=good`);
	assert.equal(ok.status, 200);
	assert.equal(await pending.code, "the-code");
	await assert.rejects(fetch(`http://127.0.0.1:${port}/callback?code=again&state=good`));
});

test("S2 a denied authorization and a timeout reject", async () => {
	const denied = waitForCallback({ port: 0, state: "s", timeoutMs: 5000 });
	const port = await denied.port;
	await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&state=s`);
	await assert.rejects(denied.code, /access_denied/);
	const slow = waitForCallback({ port: 0, state: "s", timeoutMs: 20 });
	await assert.rejects(slow.code, /timed out/);
});

test("S2 exchangeCode posts the code with the verifier and returns tokens with an expiry", async () => {
	const calls: Array<{ url: string; init: any }> = [];
	const tokens = await exchangeCode({ clientId: "abc", code: "c", verifier: "v", redirectUri: "http://127.0.0.1:8888/callback" }, fakeFetch([{ status: 200, body: { access_token: "A", refresh_token: "R", expires_in: 3600 } }], calls), () => 1000);
	assert.deepEqual(tokens, { accessToken: "A", refreshToken: "R", expiresAt: 1000 + 3600 * 1000 });
	assert.equal(calls[0]!.url, "https://accounts.spotify.com/api/token");
	assert.equal(calls[0]!.init.method, "POST");
	const body = new URLSearchParams(calls[0]!.init.body);
	assert.deepEqual(Object.fromEntries(body), { grant_type: "authorization_code", code: "c", redirect_uri: "http://127.0.0.1:8888/callback", client_id: "abc", code_verifier: "v" });
});

test("S2 the token store saves, reloads, refreshes when expired and forgets on logout", async (t) => {
	const file = join(dir(t), "spotify-token.json");
	let now = 0;
	const calls: Array<{ url: string; init: any }> = [];
	const store = new TokenStore(file, "abc", fakeFetch([{ status: 200, body: { access_token: "A2", expires_in: 3600 } }], calls), () => now);
	assert.equal(await store.accessToken(), undefined, "logged out");
	store.save({ accessToken: "A1", refreshToken: "R", expiresAt: 100_000 });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { accessToken: "A1", refreshToken: "R", expiresAt: 100_000 });
	const reloaded = new TokenStore(file, "abc", fakeFetch([], calls), () => now);
	assert.equal(await reloaded.accessToken(), "A1");
	now = 99_000;
	assert.equal(await store.accessToken(), "A2", "refreshed a minute before expiry");
	assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0]!.init.body)), { grant_type: "refresh_token", refresh_token: "R", client_id: "abc" });
	assert.equal(JSON.parse(readFileSync(file, "utf8")).refreshToken, "R", "Spotify may omit a new refresh token; the old one is kept");
	store.clear();
	assert.equal(existsSync(file), false);
	assert.equal(await store.accessToken(), undefined);
});

test("S2 a failed refresh logs out instead of looping", async (t) => {
	const file = join(dir(t), "spotify-token.json");
	writeFileSync(file, JSON.stringify({ accessToken: "A", refreshToken: "R", expiresAt: 0 }));
	const store = new TokenStore(file, "abc", fakeFetch([{ status: 400, body: { error: "invalid_grant" } }], []), () => 10);
	assert.equal(await store.accessToken(), undefined);
	assert.equal(existsSync(file), false);
});

test("S2 a corrupt token file reads as logged out", async (t) => {
	const file = join(dir(t), "spotify-token.json");
	writeFileSync(file, "{nope");
	assert.equal(await new TokenStore(file, "abc", fakeFetch([], []), () => 0).accessToken(), undefined);
});

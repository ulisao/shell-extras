import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";

/** Read the player and control it; nothing else in the account. */
export const SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"];
const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
/** Refresh this long before the access token expires. */
const EARLY_MS = 60_000;

export interface Tokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

const base64url = (buffer: Buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomVerifier(): string {
	return base64url(randomBytes(64));
}

export function randomState(): string {
	return base64url(randomBytes(16));
}

/** RFC 7636 S256 code challenge. */
export function codeChallenge(verifier: string): string {
	return base64url(createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(options: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
	const params = new URLSearchParams({
		client_id: options.clientId,
		response_type: "code",
		redirect_uri: options.redirectUri,
		code_challenge_method: "S256",
		code_challenge: options.challenge,
		state: options.state,
		scope: SCOPES.join(" "),
	});
	return `${AUTHORIZE}?${params}`;
}

const PAGE = (message: string) => `<!doctype html><meta charset="utf-8"><title>shell-extras · Spotify</title><body style="font-family:sans-serif;padding:3em"><h2>${message}</h2><p>You can close this tab and go back to Gentle Shell.</p></body>`;

/**
 * A one-shot loopback server for the OAuth redirect. It listens on
 * 127.0.0.1 only, answers just `/callback` with the expected `state`, and
 * closes after the first valid answer, an authorization error, or the timeout.
 */
export function waitForCallback(options: { port: number; state: string; timeoutMs: number }): { port: Promise<number>; code: Promise<string> } {
	if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
		const error = new Error(`Invalid Spotify callback port: ${options.port}`);
		const rejected = Promise.reject(error);
		rejected.catch(() => undefined);
		return { port: rejected, code: rejected };
	}
	let resolvePort!: (port: number) => void;
	let rejectPort!: (error: Error) => void;
	const port = new Promise<number>((resolve, reject) => {
		resolvePort = resolve;
		rejectPort = reject;
	});
	const code = new Promise<string>((resolve, reject) => {
		const server = createServer((request, response) => {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (url.pathname !== "/callback") {
				response.writeHead(404).end();
				return;
			}
			if (url.searchParams.get("state") !== options.state) {
				response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(PAGE("Spotify login failed: the request did not match."));
				return;
			}
			const error = url.searchParams.get("error");
			const value = url.searchParams.get("code");
			response.writeHead(error || !value ? 400 : 200, { "content-type": "text/html; charset=utf-8", connection: "close" }).end(PAGE(error || !value ? "Spotify login was cancelled." : "Spotify is connected."));
			finish(() => (error || !value ? reject(new Error(`Spotify authorization failed: ${error ?? "no code"}`)) : resolve(value)));
		});
		const timer = setTimeout(() => finish(() => reject(new Error("Spotify login timed out"))), options.timeoutMs);
		const finish = (settle: () => void) => {
			clearTimeout(timer);
			server.close();
			server.closeAllConnections?.();
			settle();
		};
		server.on("error", (error) => {
			clearTimeout(timer);
			rejectPort(error);
			reject(error);
		});
		server.listen(options.port, "127.0.0.1", () => {
			const address = server.address();
			resolvePort(typeof address === "object" && address ? address.port : options.port);
		});
	});
	code.catch(() => undefined);
	port.catch(() => undefined);
	return { port, code };
}

type Fetch = typeof fetch;

async function tokenRequest(body: Record<string, string>, fetcher: Fetch, now: () => number, previousRefresh?: string): Promise<Tokens> {
	const response = await fetcher(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
	if (!response.ok) throw Object.assign(new Error(`Spotify token request failed (${response.status})`), { status: response.status });
	const data = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
	if (!data.access_token) throw new Error("Spotify token response had no access token");
	const refreshToken = data.refresh_token ?? previousRefresh;
	if (!refreshToken) throw new Error("Spotify token response had no refresh token");
	return { accessToken: data.access_token, refreshToken, expiresAt: now() + (data.expires_in ?? 3600) * 1000 };
}

export function exchangeCode(options: { clientId: string; code: string; verifier: string; redirectUri: string }, fetcher: Fetch = fetch, now: () => number = Date.now): Promise<Tokens> {
	return tokenRequest({ grant_type: "authorization_code", code: options.code, redirect_uri: options.redirectUri, client_id: options.clientId, code_verifier: options.verifier }, fetcher, now);
}

/**
 * Spotify tokens on disk, in their own file (owner-only where the OS
 * supports it). Tokens are never logged or shown. An expired token is
 * refreshed once; a failed refresh logs out.
 */
export class TokenStore {
	private tokens: Tokens | undefined;
	private refreshing: Promise<string | undefined> | undefined;
	/** Bumped by clear(), so a refresh that started before a logout never writes the tokens back. */
	private generation = 0;
	readonly file: string;
	private readonly clientId: string;
	private readonly fetcher: Fetch;
	private readonly now: () => number;

	constructor(file: string, clientId: string, fetcher: Fetch = fetch, now: () => number = Date.now) {
		this.file = file;
		this.clientId = clientId;
		this.fetcher = fetcher;
		this.now = now;
		try {
			const data = JSON.parse(readFileSync(file, "utf8"));
			if (typeof data?.accessToken === "string" && typeof data.refreshToken === "string" && typeof data.expiresAt === "number") this.tokens = data;
		} catch {
			this.tokens = undefined;
		}
	}

	loggedIn(): boolean {
		return this.tokens !== undefined;
	}

	save(tokens: Tokens): void {
		this.tokens = tokens;
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(tokens), { mode: 0o600 });
		try {
			chmodSync(this.file, 0o600);
		} catch {
			// Windows ignores POSIX modes; the file stays in the user's profile.
		}
	}

	clear(): void {
		this.generation++;
		this.tokens = undefined;
		rmSync(this.file, { force: true });
	}

	async accessToken(): Promise<string | undefined> {
		const tokens = this.tokens;
		if (!tokens) return undefined;
		if (this.now() < tokens.expiresAt - EARLY_MS) return tokens.accessToken;
		const generation = this.generation;
		this.refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: this.clientId }, this.fetcher, this.now, tokens.refreshToken)
			.then((fresh) => {
				if (generation !== this.generation) return undefined;
				this.save(fresh);
				return fresh.accessToken;
			})
			.catch((error: { status?: number }) => {
				// Spotify rejected the refresh token (4xx): log out. A network error or a
				// 5xx is transient: keep the tokens and try again on the next poll.
				const status = error?.status;
				if (generation === this.generation && typeof status === "number" && status >= 400 && status < 500) this.clear();
				return undefined;
			})
			.finally(() => {
				this.refreshing = undefined;
			});
		return this.refreshing;
	}
}

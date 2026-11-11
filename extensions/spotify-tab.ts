import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Settings, extrasHome } from "../lib/settings.ts";
import { authorizeUrl, codeChallenge, exchangeCode, randomState, randomVerifier, TokenStore, waitForCallback } from "../lib/spotify-auth.ts";
import { createSpotifyWidget, SpotifyModel } from "../lib/spotify-widget.ts";
import { numberFromEnv, registerTabWidget } from "../lib/widget-extension.ts";

const LOGIN_TIMEOUT_MS = 3 * 60_000;
const USAGE = "Usage: /spotify login <client-id> | /spotify logout | /spotify status";

/** Opens a URL in the default browser without going through a shell (the URL carries `&`). */
function openBrowser(url: string): void {
	const [command, args] =
		process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
	try {
		const child = spawn(command, args as string[], { detached: true, stdio: "ignore" });
		child.on("error", () => undefined);
		child.unref();
	} catch {
		// The URL is also shown in the notice.
	}
}

/**
 * The Spotify tab: what is playing, with previous / play-pause / next,
 * shuffle, repeat and volume. `/spotify login <client-id>` connects a Spotify
 * app of your own through OAuth PKCE (no client secret).
 */
export default function spotifyTab(pi: ExtensionAPI): void {
	const settings = new Settings();
	const clientId = () => process.env.SPOTIFY_CLIENT_ID || settings.get<string>("spotifyClientId") || "";
	const tokenFile = () => join(extrasHome(), "spotify-token.json");
	let store = new TokenStore(tokenFile(), clientId());
	const model = new SpotifyModel(() => store.accessToken());
	let loginRunning = false;

	const tab = registerTabWidget(pi, {
		key: "shell-extras.spotify",
		id: "spotify",
		label: "Music",
		order: 50,
		pollMs: numberFromEnv("SHELL_EXTRAS_SPOTIFY_POLL_MS", 3000),
		create({ theme, requestRender }) {
			const unsubscribe = model.onChange(requestRender);
			// Spotify applies a command a moment later; re-read the player then.
			const widget = createSpotifyWidget(model, theme, () => void setTimeout(() => void model.refresh(), 400).unref?.());
			return { widget, refresh: () => model.refresh(), dispose: unsubscribe };
		},
	});

	async function login(ctx: ExtensionCommandContext, id: string): Promise<void> {
		if (loginRunning) {
			ctx.ui.notify("A Spotify login is already waiting for the browser", "warning");
			return;
		}
		if (!/^[A-Za-z0-9]{16,64}$/.test(id)) {
			ctx.ui.notify(`That does not look like a Spotify client ID. ${USAGE}`, "error");
			return;
		}
		settings.set("spotifyClientId", id);
		const port = numberFromEnv("SHELL_EXTRAS_SPOTIFY_PORT", 8888);
		const redirectUri = `http://127.0.0.1:${port}/callback`;
		const verifier = randomVerifier();
		const state = randomState();
		loginRunning = true;
		try {
			const callback = waitForCallback({ port, state, timeoutMs: LOGIN_TIMEOUT_MS });
			await callback.port;
			const url = authorizeUrl({ clientId: id, redirectUri, challenge: codeChallenge(verifier), state });
			openBrowser(url);
			ctx.ui.notify(`Opening Spotify in the browser to connect. If it does not open, visit:\n${url}`, "info");
			const code = await callback.code;
			const tokens = await exchangeCode({ clientId: id, code, verifier, redirectUri });
			store = new TokenStore(tokenFile(), id);
			store.save(tokens);
			ctx.ui.notify("Spotify connected", "info");
			await model.refresh();
		} catch (error) {
			ctx.ui.notify(`Spotify login failed: ${(error as Error).message}`, "error");
		} finally {
			loginRunning = false;
		}
	}

	pi.registerCommand("spotify", {
		description: "Connect the sidebar Spotify tab: login <client-id>, logout, status",
		handler: async (args, ctx) => {
			const [sub = "status", value] = args.trim().split(/\s+/).filter(Boolean);
			if (sub === "login") {
				await login(ctx, value ?? clientId());
				return;
			}
			if (sub === "logout") {
				store.clear();
				await model.refresh();
				ctx.ui.notify("Spotify disconnected; the saved token was deleted", "info");
				return;
			}
			if (sub === "status") {
				ctx.ui.notify(store.loggedIn() ? "Spotify is connected" : `Spotify is not connected. ${USAGE}`, "info");
				return;
			}
			ctx.ui.notify(USAGE, "warning");
		},
	});

	void tab;
}

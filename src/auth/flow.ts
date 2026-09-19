import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { InvalidOAuthStateError, type YouTubeAuth } from "./oauth.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface OAuthFlowOptions {
  /** How long to wait for the browser callback. Defaults to five minutes. */
  timeoutMs?: number;
  /** Disable browser launch or provide a custom launcher (useful for tests). */
  openBrowser?: boolean | ((url: string) => void | Promise<void>);
  /** Receives status messages. Defaults to stderr so stdio MCP stays valid. */
  logger?: (message: string) => void;
}

export type OAuthCallbackOutcome =
  | "success"
  | "declined"
  | "invalid"
  | "failed";

function sendHtml(
  res: ServerResponse,
  status: number,
  heading: string,
  body: string,
): void {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(
    `<!doctype html><html><head><title>${heading}</title>` +
      "<style>body{font:16px system-ui;max-width:42rem;margin:5rem auto;padding:0 1rem}" +
      "h1{font-size:1.5rem}</style></head>" +
      `<body><h1>${heading}</h1><p>${body}</p></body></html>`,
  );
}

function launchBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? { executable: "open", args: [url] }
      : process.platform === "win32"
        ? {
            executable: "rundll32.exe",
            args: ["url.dll,FileProtocolHandler", url],
          }
        : { executable: "xdg-open", args: [url] };

  const child = spawn(command.executable, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {
    // The URL is also printed, so a missing desktop opener is non-fatal.
  });
  child.unref();
}

function listen(server: Server, port: number, hostname: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}

/**
 * Validate and complete a Google OAuth callback, returning a safe browser page.
 */
export async function handleOAuthCallback(
  auth: YouTubeAuth,
  requestUrl: URL,
  res: ServerResponse,
): Promise<OAuthCallbackOutcome> {
  const state = requestUrl.searchParams.get("state") ?? "";
  const oauthError = requestUrl.searchParams.get("error");

  if (oauthError) {
    if (!auth.cancelAuthorization(state)) {
      sendHtml(
        res,
        400,
        "Authorization failed",
        "The OAuth state did not match or has expired. Please try again.",
      );
      return "invalid";
    }

    sendHtml(
      res,
      400,
      "Authorization declined",
      "You can close this window and try again.",
    );
    return "declined";
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    sendHtml(
      res,
      400,
      "Authorization failed",
      "No authorization code was provided.",
    );
    return "invalid";
  }

  try {
    await auth.completeAuthorization(code, state);
    sendHtml(
      res,
      200,
      "YouTube authorization complete",
      "You can close this window and return to your agent.",
    );
    return "success";
  } catch (error) {
    if (error instanceof InvalidOAuthStateError) {
      sendHtml(
        res,
        400,
        "Authorization failed",
        "The OAuth state did not match or has expired. Please try again.",
      );
      return "invalid";
    }

    sendHtml(
      res,
      500,
      "Authorization failed",
      "The authorization code could not be exchanged. Please try again.",
    );
    return "failed";
  }
}

/**
 * Start a persistent callback listener for stdio servers using the auth tool.
 */
export async function startOAuthCallbackServer(
  auth: YouTubeAuth,
): Promise<Server> {
  const redirectUri = getLocalRedirectUri(auth);
  const hostname = redirectUri.hostname.replace(/^\[(.*)\]$/, "$1");
  const port = redirectUri.port ? Number.parseInt(redirectUri.port, 10) : 80;
  const callbackPath = redirectUri.pathname || "/";

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const requestUrl = new URL(req.url ?? "/", redirectUri.origin);
      if (req.method !== "GET" || requestUrl.pathname !== callbackPath) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      await handleOAuthCallback(auth, requestUrl, res);
    },
  );

  await listen(server, port, hostname);
  return server;
}

function getLocalRedirectUri(auth: YouTubeAuth): URL {
  const redirectUri = new URL(auth.redirectUri);
  const hostname = redirectUri.hostname.replace(/^\[(.*)\]$/, "$1");

  if (redirectUri.protocol !== "http:" || !LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      "GOOGLE_REDIRECT_URI must be an http://localhost callback URL for the local OAuth flow.",
    );
  }

  return redirectUri;
}

/**
 * Run the interactive installed-app OAuth flow and persist the resulting token.
 *
 * A short-lived local HTTP listener receives Google's redirect. Tokens are
 * exchanged and stored by YouTubeAuth and are never returned to the browser or
 * written to the console.
 */
export async function runOAuthFlow(
  auth: YouTubeAuth,
  options: OAuthFlowOptions = {},
): Promise<void> {
  const redirectUri = getLocalRedirectUri(auth);
  const hostname = redirectUri.hostname.replace(/^\[(.*)\]$/, "$1");

  const port = redirectUri.port ? Number.parseInt(redirectUri.port, 10) : 80;
  const callbackPath = redirectUri.pathname || "/";
  const authUrl = auth.startAuthorization();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = options.logger ?? console.error;

  let settle: (() => void) | undefined;
  let rejectFlow: ((error: Error) => void) | undefined;

  const callback = new Promise<void>((resolve, reject) => {
    settle = resolve;
    rejectFlow = reject;
  });

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const requestUrl = new URL(req.url ?? "/", redirectUri.origin);
      if (requestUrl.pathname !== callbackPath) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const outcome = await handleOAuthCallback(auth, requestUrl, res);
      if (outcome === "success") {
        settle?.();
      } else if (outcome === "declined") {
        rejectFlow?.(new Error("Google authorization was declined."));
      } else if (outcome === "failed") {
        rejectFlow?.(new Error("Google authorization code exchange failed."));
      }
    },
  );

  await listen(server, port, hostname);
  server.on("error", (error: Error) => rejectFlow?.(error));

  const timer = setTimeout(() => {
    rejectFlow?.(new Error("Timed out waiting for Google OAuth authorization."));
  }, timeoutMs);

  try {
    logger("Authorize YouTube access by opening this URL:");
    logger(authUrl);
    logger(`Waiting for the OAuth callback at ${redirectUri.toString()}`);

    if (typeof options.openBrowser === "function") {
      await options.openBrowser(authUrl);
    } else if (options.openBrowser !== false) {
      launchBrowser(authUrl);
    }

    await callback;
    logger("YouTube authorization completed. Credentials were stored securely.");
  } finally {
    clearTimeout(timer);
    await close(server);
  }
}

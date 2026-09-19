import { google } from "googleapis";
import { OAuth2Client, Credentials } from "google-auth-library";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const AUTHORIZATION_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * YouTube API OAuth scopes mapped by operation category.
 */
export const YOUTUBE_SCOPES = {
  readonly: "https://www.googleapis.com/auth/youtube.readonly",
  manage: "https://www.googleapis.com/auth/youtube",
  upload: "https://www.googleapis.com/auth/youtube.upload",
  forceSsl: "https://www.googleapis.com/auth/youtube.force-ssl",
} as const;

/** All scopes needed for full YouTube API access. */
export const ALL_SCOPES = Object.values(YOUTUBE_SCOPES);

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenStoragePath: string;
}

export class InvalidOAuthStateError extends Error {
  constructor() {
    super("OAuth authorization state is invalid or expired.");
    this.name = "InvalidOAuthStateError";
  }
}

/**
 * Manages Google OAuth 2.0 authentication for the YouTube Data API.
 *
 * Handles token storage, refresh, and provides an authenticated OAuth2Client.
 */
export class YouTubeAuth {
  private oauth2Client: OAuth2Client;
  private tokenPath: string;
  private pendingAuthorizations = new Map<string, number>();

  constructor(private config: OAuthConfig) {
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    );
    this.tokenPath = path.resolve(config.tokenStoragePath, "tokens.json");

    // Set up automatic token refresh
    this.oauth2Client.on("tokens", (tokens) => {
      this.saveTokens(tokens).catch(() => {
        // Silently handle save errors — never log token data
      });
    });
  }

  /**
   * Get the authenticated OAuth2 client.
   * Loads stored tokens if available and refreshes if expired.
   */
  async getClient(): Promise<OAuth2Client> {
    const tokens = await this.loadTokens();
    if (!tokens) {
      throw new Error(
        "No stored YouTube credentials found. Call the youtube_auth_start tool " +
          "and present its authorization URL to the user.",
      );
    }

    this.oauth2Client.setCredentials(tokens);

    // Check if token is expired or about to expire (5 min buffer)
    if (this.isTokenExpired(tokens)) {
      await this.refreshToken();
    }

    return this.oauth2Client;
  }

  /**
   * Generate an authorization URL for the user to visit.
   */
  getAuthUrl(scopes: string[] = ALL_SCOPES, state?: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
      include_granted_scopes: true,
      state,
    });
  }

  /**
   * Start a short-lived authorization attempt and return its Google consent URL.
   */
  startAuthorization(scopes: string[] = ALL_SCOPES): string {
    const now = Date.now();
    for (const [state, expiresAt] of this.pendingAuthorizations) {
      if (expiresAt <= now) {
        this.pendingAuthorizations.delete(state);
      }
    }

    const state = randomBytes(32).toString("hex");
    this.pendingAuthorizations.set(state, now + AUTHORIZATION_STATE_TTL_MS);
    return this.getAuthUrl(scopes, state);
  }

  /**
   * Complete a pending authorization attempt after validating its one-time state.
   */
  async completeAuthorization(code: string, state: string): Promise<void> {
    if (!this.consumeAuthorizationState(state)) {
      throw new InvalidOAuthStateError();
    }
    await this.exchangeCode(code);
  }

  /**
   * Cancel a pending authorization attempt, returning whether its state was valid.
   */
  cancelAuthorization(state: string): boolean {
    return this.consumeAuthorizationState(state);
  }

  /**
   * Redirect URI configured for this OAuth client.
   */
  get redirectUri(): string {
    return this.config.redirectUri;
  }

  /**
   * Exchange an authorization code for tokens and store them.
   */
  async exchangeCode(code: string): Promise<void> {
    if (!code.trim()) {
      throw new Error("Authorization code is required.");
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    await this.saveTokens(tokens);
  }

  /**
   * Check if the current token is expired or near expiry.
   */
  private isTokenExpired(tokens: Credentials): boolean {
    if (!tokens.expiry_date) return true;
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= tokens.expiry_date - bufferMs;
  }

  /**
   * Refresh the access token using the stored refresh token.
   */
  private async refreshToken(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);
      await this.saveTokens(credentials);
    } catch {
      throw new Error(
        "Failed to refresh access token. The refresh token may have been revoked. " +
          "Call the youtube_auth_start tool and present its authorization URL to the user.",
      );
    }
  }

  /**
   * Save tokens to disk. Never logs token values.
   */
  private async saveTokens(tokens: Credentials): Promise<void> {
    const dir = path.dirname(this.tokenPath);
    await fs.mkdir(dir, { recursive: true });

    // Refresh responses do not always include a new refresh token. Preserve the
    // existing one so a successful access-token refresh cannot make the stored
    // credentials unusable after the next restart.
    const storedTokens = await this.loadTokens();
    const credentials = storedTokens ? { ...storedTokens, ...tokens } : tokens;

    await fs.writeFile(this.tokenPath, JSON.stringify(credentials), {
      mode: 0o600, // Owner read/write only
    });
    await fs.chmod(this.tokenPath, 0o600);
  }

  /**
   * Load tokens from disk. Returns null if no stored tokens.
   */
  private async loadTokens(): Promise<Credentials | null> {
    try {
      const data = await fs.readFile(this.tokenPath, "utf-8");
      return JSON.parse(data) as Credentials;
    } catch {
      return null;
    }
  }

  /**
   * Check if stored credentials exist.
   */
  async hasStoredCredentials(): Promise<boolean> {
    try {
      await fs.access(this.tokenPath);
      return true;
    } catch {
      return false;
    }
  }

  private consumeAuthorizationState(state: string): boolean {
    if (!state) return false;

    const expiresAt = this.pendingAuthorizations.get(state);
    this.pendingAuthorizations.delete(state);
    return expiresAt !== undefined && expiresAt > Date.now();
  }
}

/**
 * Create a YouTubeAuth instance from environment variables.
 */
export function createAuthFromEnv(): YouTubeAuth {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/callback";
  const tokenStoragePath = process.env.TOKEN_STORAGE_PATH || "./.tokens";

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required.",
    );
  }

  return new YouTubeAuth({
    clientId,
    clientSecret,
    redirectUri,
    tokenStoragePath,
  });
}

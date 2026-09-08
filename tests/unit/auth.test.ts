import { YouTubeAuth, YOUTUBE_SCOPES, ALL_SCOPES } from "../../src/auth/oauth.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("YouTubeAuth", () => {
  let auth: YouTubeAuth;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-mcp-test-"));
    auth = new YouTubeAuth({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      redirectUri: "http://localhost:3000/callback",
      tokenStoragePath: tmpDir,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates an auth instance with config", () => {
      expect(auth).toBeDefined();
    });
  });

  describe("getAuthUrl", () => {
    it("generates an authorization URL with all scopes", () => {
      const url = auth.getAuthUrl();
      expect(url).toContain("accounts.google.com");
      expect(url).toContain("access_type=offline");
      for (const scope of ALL_SCOPES) {
        expect(url).toContain(encodeURIComponent(scope));
      }
    });

    it("generates URL with specific scopes", () => {
      const url = auth.getAuthUrl([YOUTUBE_SCOPES.readonly]);
      expect(url).toContain(encodeURIComponent(YOUTUBE_SCOPES.readonly));
    });

    it("includes a state value when provided", () => {
      const url = new URL(auth.getAuthUrl(undefined, "test-state"));
      expect(url.searchParams.get("state")).toBe("test-state");
    });
  });

  describe("hasStoredCredentials", () => {
    it("returns false when no tokens stored", async () => {
      const result = await auth.hasStoredCredentials();
      expect(result).toBe(false);
    });

    it("returns true when tokens exist", async () => {
      const tokenPath = path.join(tmpDir, "tokens.json");
      await fs.writeFile(tokenPath, JSON.stringify({ access_token: "test" }));
      const result = await auth.hasStoredCredentials();
      expect(result).toBe(true);
    });
  });

  describe("getClient", () => {
    it("throws when no stored credentials", async () => {
      await expect(auth.getClient()).rejects.toThrow("No stored credentials found");
    });

    it("returns client when valid tokens exist", async () => {
      const tokenPath = path.join(tmpDir, "tokens.json");
      const tokens = {
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expiry_date: Date.now() + 3600 * 1000, // 1 hour from now
      };
      await fs.writeFile(tokenPath, JSON.stringify(tokens));

      const client = await auth.getClient();
      expect(client).toBeDefined();
    });
  });

  describe("token persistence", () => {
    it("preserves the refresh token when new credentials omit it", async () => {
      const tokenPath = path.join(tmpDir, "tokens.json");
      await fs.writeFile(
        tokenPath,
        JSON.stringify({
          access_token: "old-access-token",
          refresh_token: "test-refresh-token",
        }),
      );

      await (auth as any).saveTokens({ access_token: "new-access-token" });

      const stored = JSON.parse(await fs.readFile(tokenPath, "utf-8"));
      expect(stored.access_token).toBe("new-access-token");
      expect(stored.refresh_token).toBe("test-refresh-token");
    });
  });

  describe("YOUTUBE_SCOPES", () => {
    it("has all required scope categories", () => {
      expect(YOUTUBE_SCOPES.readonly).toContain("youtube.readonly");
      expect(YOUTUBE_SCOPES.manage).toContain("/youtube");
      expect(YOUTUBE_SCOPES.upload).toContain("youtube.upload");
      expect(YOUTUBE_SCOPES.forceSsl).toContain("youtube.force-ssl");
    });
  });
});

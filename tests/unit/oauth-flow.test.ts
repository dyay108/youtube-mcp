import { jest } from "@jest/globals";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runOAuthFlow } from "../../src/auth/flow.js";
import { YouTubeAuth } from "../../src/auth/oauth.js";

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

describe("runOAuthFlow", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-mcp-flow-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("receives the callback, verifies state, and exchanges the code", async () => {
    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const auth = new YouTubeAuth({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      redirectUri,
      tokenStoragePath: tmpDir,
    });
    const exchangeCode = jest
      .spyOn(auth, "exchangeCode")
      .mockResolvedValue(undefined);

    let browserOpened!: (url: string) => void;
    const browserUrl = new Promise<string>((resolve) => {
      browserOpened = resolve;
    });

    const flow = runOAuthFlow(auth, {
      timeoutMs: 2_000,
      logger: () => undefined,
      openBrowser: (url) => browserOpened(url),
    });

    const authorizationUrl = new URL(await browserUrl);
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const response = await fetch(
      `${redirectUri}?code=test-authorization-code&state=${encodeURIComponent(state!)}`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("test-authorization-code");
    await flow;
    expect(exchangeCode).toHaveBeenCalledWith("test-authorization-code");
  });

  it("rejects callback URLs that cannot be served locally", async () => {
    const auth = new YouTubeAuth({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      redirectUri: "https://example.com/callback",
      tokenStoragePath: tmpDir,
    });

    await expect(runOAuthFlow(auth, { openBrowser: false })).rejects.toThrow(
      "must be an http://localhost callback URL",
    );
  });
});

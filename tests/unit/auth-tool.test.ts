import { jest } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthTools } from "../../src/tools/auth.js";

describe("youtube_auth_start", () => {
  it("returns an authorization URL for the agent to present", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const beginAuthorization = jest
      .fn<() => Promise<string>>()
      .mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth?state=test");
    registerAuthTools(server, beginAuthorization);

    const tool = (server as any)._registeredTools.youtube_auth_start;
    const result = await tool.handler({});

    expect(beginAuthorization).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("Ask the user to open");
    expect(result.content[0].text).toContain("accounts.google.com");
  });
});

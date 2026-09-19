import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type BeginAuthorization = () => string | Promise<string>;

/** Register the tool that starts an interactive Google OAuth flow. */
export function registerAuthTools(
  server: McpServer,
  beginAuthorization: BeginAuthorization,
): void {
  server.tool(
    "youtube_auth_start",
    "Start YouTube OAuth authorization. Returns a Google consent URL that must be presented to the user. Use this when YouTube credentials are missing, expired, or revoked.",
    {},
    async () => {
      const authorizationUrl = await beginAuthorization();

      return {
        content: [
          {
            type: "text" as const,
            text:
              "Ask the user to open this Google authorization URL within 10 minutes. " +
              "After they approve access and see the success page, retry the original YouTube operation.\n\n" +
              authorizationUrl,
          },
        ],
      };
    },
  );
}

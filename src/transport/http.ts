import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

export interface HttpTransportOptions {
  port: number;
  host: string;
}

export type McpServerFactory = () => McpServer | Promise<McpServer>;

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getSessionId(req: IncomingMessage): string | undefined {
  const value = req.headers["mcp-session-id"];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Start the MCP server with a stateful Streamable HTTP transport.
 *
 * Each initialize request receives its own transport and McpServer instance.
 * Subsequent requests are routed using the Mcp-Session-Id header.
 */
export async function startHttpTransport(
  createMcpServer: McpServerFactory,
  options: HttpTransportOptions,
): Promise<HttpServer> {
  const sessions = new Map<string, Session>();

  const httpServer = createHttpServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");

      if (requestUrl.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (requestUrl.pathname !== "/mcp" && requestUrl.pathname !== "/mcp/") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      try {
        const sessionId = getSessionId(req);
        if (sessionId) {
          const session = sessions.get(sessionId);
          if (!session) {
            sendJsonRpcError(res, 404, -32001, "Session not found");
            return;
          }

          await session.transport.handleRequest(req, res);
          return;
        }

        if (req.method !== "POST") {
          sendJsonRpcError(
            res,
            400,
            -32000,
            "Bad Request: Mcp-Session-Id header is required",
          );
          return;
        }

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendJsonRpcError(res, 400, -32700, "Parse error");
          return;
        }

        if (!isInitializeRequest(body)) {
          sendJsonRpcError(
            res,
            400,
            -32000,
            "Bad Request: No valid session ID provided",
          );
          return;
        }

        const mcpServer = await createMcpServer();
        let transport!: StreamableHTTPServerTransport;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, { server: mcpServer, transport });
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error) {
        console.error(
          "Error handling MCP request:",
          error instanceof Error ? error.message : "Unknown error",
        );
        if (!res.headersSent) {
          sendJsonRpcError(res, 500, -32603, "Internal server error");
        }
      }
    },
  );

  httpServer.on("close", () => {
    const activeSessions = [...sessions.values()];
    sessions.clear();
    void Promise.allSettled(activeSessions.map(({ server }) => server.close()));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(options.port, options.host, () => {
      console.error(
        `YouTube MCP server running on http://${options.host}:${options.port}/mcp`,
      );
      resolve();
    });
    httpServer.once("error", reject);
  });

  return httpServer;
}

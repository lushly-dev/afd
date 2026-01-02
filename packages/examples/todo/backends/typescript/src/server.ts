/**
 * @fileoverview Todo app MCP server entry point
 *
 * This file creates and starts an MCP server exposing all todo commands.
 *
 * Usage:
 *   node dist/server.js
 *
 * Then connect with the AFD CLI:
 *   afd connect http://localhost:3100/sse
 *   afd tools
 *   afd call todo.create '{"title": "My first todo"}'
 */

import { createMcpServer, createLoggingMiddleware } from "@afd/server";
import { allCommands } from "./commands/index.js";

// Configuration from environment
const PORT = parseInt(process.env.PORT ?? "3100", 10);
const HOST = process.env.HOST ?? "localhost";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

/**
 * Dev mode: enables verbose errors, permissive CORS, stack traces.
 * Set NODE_ENV=development to enable, or NODE_ENV=production for secure defaults.
 */
const DEV_MODE = process.env.NODE_ENV === "development";

/**
 * Create and configure the MCP server.
 */
function createServer() {
  return createMcpServer({
    name: "todo-app",
    version: "1.0.0",
    commands: allCommands,
    port: PORT,
    host: HOST,
    devMode: DEV_MODE,
    // CORS follows devMode by default (permissive in dev, restrictive in prod)
    // Explicitly set cors: true here for the UI to work in both modes
    cors: true,

    // Add logging middleware - verbose in dev mode
    middleware:
      DEV_MODE || LOG_LEVEL === "debug"
        ? [createLoggingMiddleware({ logInput: true, logResult: true })]
        : [createLoggingMiddleware()],

    // Log command execution
    onCommand(command, input, result) {
      if (LOG_LEVEL === "debug") {
        console.error(`[Command] ${command}:`, { input, result });
      }
    },

    // Log errors
    onError(error) {
      console.error("[Error]", error);
    },
  });
}

/**
 * Main entry point.
 */
async function main() {
  const server = createServer();

  // Use console.error for logging to avoid interfering with MCP stdio
  console.error("Starting Todo App MCP Server...");
  console.error(`  Name: todo-app`);
  console.error(`  Version: 1.0.0`);
  console.error(
    `  Mode: ${
      DEV_MODE
        ? "🔧 DEVELOPMENT (verbose errors, permissive CORS)"
        : "🔒 PRODUCTION (secure defaults)"
    }`
  );
  console.error(`  Commands: ${allCommands.length}`);
  console.error("");

  await server.start();

  console.error(`Server running at ${server.getUrl()}`);
  console.error("");
  console.error("Connect with the AFD CLI:");
  console.error(`  afd connect ${server.getUrl()}/sse`);
  console.error("");
  console.error("Or open the UI:");
  console.error(`  Open ui/index.html in a browser`);
  console.error("");
  console.error("Available commands:");
  for (const cmd of server.getCommands()) {
    console.error(`  - ${cmd.name}: ${cmd.description}`);
  }
  console.error("");
  console.error("Press Ctrl+C to stop.");

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.error("\nShutting down...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("\nShutting down...");
    await server.stop();
    process.exit(0);
  });
}

// Run
main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

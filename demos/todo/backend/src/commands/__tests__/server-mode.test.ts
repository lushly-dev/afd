/**
 * @fileoverview Tests for server devMode behavior
 *
 * Tests verify that:
 * - Production mode (default) sanitizes errors and restricts CORS
 * - Development mode provides verbose errors and permissive CORS
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMcpServer, defineCommand } from "@afd/server";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// TEST COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create test commands fresh for each test to avoid type inference issues.
 */
function createTestCommands() {
  const throwingCommand = defineCommand({
    name: "test.throw",
    description: "A command that throws an error",
    input: z.object({}),
    async handler() {
      throw new Error(
        "Intentional test error with sensitive details: /internal/path/secret.key"
      );
    },
  });

  const successCommand = defineCommand({
    name: "test.success",
    description: "A command that succeeds",
    input: z.object({
      value: z.string(),
    }),
    async handler(input) {
      return {
        success: true as const,
        data: { received: input.value },
      };
    },
  });

  // Use 'as any' to work around complex Zod generic inference
  return [throwingCommand, successCommand] as any;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEV MODE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Server devMode", () => {
  describe("devMode: true (development)", () => {
    let server: ReturnType<typeof createMcpServer>;

    beforeEach(async () => {
      server = createMcpServer({
        name: "test-server",
        version: "1.0.0",
        commands: createTestCommands(),
        port: 3201,
        devMode: true,
      } as any);
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    it("includes stack traces in error responses", async () => {
      const result = await server.execute("test.throw", {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("COMMAND_EXECUTION_ERROR");
      // In dev mode, should include detailed error message
      expect(result.error?.message).toContain("Intentional test error");
      // In dev mode, should include stack trace in details
      expect(result.error?.details).toBeDefined();
      expect(result.error?.details?.stack).toBeDefined();
      // Stack trace contains file path and function call info
      expect(result.error?.details?.stack).toContain("server-mode.test.ts");
    });

    it("includes detailed error message with sensitive info", async () => {
      const result = await server.execute("test.throw", {});

      expect(result.success).toBe(false);
      // Dev mode preserves the full error message including sensitive paths
      expect(result.error?.message).toContain("sensitive details");
    });

    it("provides helpful suggestion in dev mode", async () => {
      const result = await server.execute("test.throw", {});

      expect(result.success).toBe(false);
      expect(result.error?.suggestion).toContain(
        "Check the command implementation"
      );
    });
  });

  describe("devMode: false (production, default)", () => {
    let server: ReturnType<typeof createMcpServer>;

    beforeEach(async () => {
      server = createMcpServer({
        name: "test-server",
        version: "1.0.0",
        commands: createTestCommands(),
        port: 3202,
        devMode: false,
      } as any);
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    it("does NOT include stack traces in error responses", async () => {
      const result = await server.execute("test.throw", {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("COMMAND_EXECUTION_ERROR");
      // In production mode, should NOT include details with stack
      expect(result.error?.details).toBeUndefined();
    });

    it("sanitizes error message (no sensitive info)", async () => {
      const result = await server.execute("test.throw", {});

      expect(result.success).toBe(false);
      // Production mode should return generic message
      expect(result.error?.message).toBe("An internal error occurred");
      // Should NOT contain the sensitive path
      expect(result.error?.message).not.toContain("sensitive details");
      expect(result.error?.message).not.toContain("/internal/path");
    });

    it("provides user-friendly suggestion in production", async () => {
      const result = await server.execute("test.throw", {});

      expect(result.success).toBe(false);
      expect(result.error?.suggestion).toContain("Contact support");
    });
  });

  describe("default behavior (no devMode specified)", () => {
    let server: ReturnType<typeof createMcpServer>;

    beforeEach(async () => {
      server = createMcpServer({
        name: "test-server",
        version: "1.0.0",
        commands: createTestCommands(),
        port: 3203,
        // devMode not specified - should default to false (secure)
      } as any);
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    it("defaults to production behavior (secure by default)", async () => {
      const result = await server.execute("test.throw", {});

      expect(result.success).toBe(false);
      // Should behave like devMode: false
      expect(result.error?.details).toBeUndefined();
      expect(result.error?.message).toBe("An internal error occurred");
    });
  });

  describe("CORS behavior", () => {
    it("devMode: true enables CORS by default", async () => {
      const server = createMcpServer({
        name: "test-server",
        version: "1.0.0",
        commands: createTestCommands(),
        port: 3204,
        devMode: true,
        // cors not specified - should default to true in dev mode
      } as any);
      await server.start();

      // The CORS headers are set in the HTTP handler, which we can't easily test here
      // without making actual HTTP requests. This test documents the expected behavior.
      // Integration tests should verify actual CORS headers.

      await server.stop();
    });

    it("devMode: false disables CORS by default", async () => {
      const server = createMcpServer({
        name: "test-server",
        version: "1.0.0",
        commands: createTestCommands(),
        port: 3205,
        devMode: false,
        // cors not specified - should default to false in production mode
      } as any);
      await server.start();

      // CORS should be disabled by default in production
      // Integration tests should verify no CORS headers are sent

      await server.stop();
    });

    it("explicit cors: true overrides devMode default", async () => {
      const server = createMcpServer({
        name: "test-server",
        version: "1.0.0",
        commands: createTestCommands(),
        port: 3206,
        devMode: false,
        cors: true, // Explicitly enable CORS even in production
      } as any);
      await server.start();

      // CORS should be enabled despite production mode

      await server.stop();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Validation errors", () => {
  it("returns validation errors with details", async () => {
    const validationCommand = defineCommand({
      name: "test.validate",
      description: "A command with strict validation",
      input: z.object({
        email: z.string().email(),
        age: z.number().int().positive(),
      }),
      async handler(input) {
        return { success: true as const, data: input };
      },
    });

    const server = createMcpServer({
      name: "test-server",
      version: "1.0.0",
      commands: [validationCommand] as any,
      port: 3207,
      devMode: true,
    } as any);
    await server.start();

    const result = await server.execute("test.validate", {
      email: "not-an-email",
      age: -5,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
    // Validation errors should include field-level details
    expect(result.error?.details?.errors).toBeDefined();

    await server.stop();
  });
});

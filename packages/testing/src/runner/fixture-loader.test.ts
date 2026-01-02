/**
 * @afd/testing - Fixture Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFixture, applyFixture, type FixtureData } from "./fixture-loader.js";

describe("loadFixture", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `afd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe("basic loading", () => {
    it("loads a simple JSON fixture", async () => {
      const fixture = { app: "todo", todos: [{ title: "Test" }] };
      await writeFile(join(testDir, "fixture.json"), JSON.stringify(fixture));

      const result = await loadFixture(
        { file: "fixture.json" },
        { basePath: testDir }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.app).toBe("todo");
        expect(result.data.todos).toEqual([{ title: "Test" }]);
      }
    });

    it("returns error for non-existent file", async () => {
      const result = await loadFixture(
        { file: "missing.json" },
        { basePath: testDir }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("not found");
      }
    });

    it("returns error for invalid JSON", async () => {
      await writeFile(join(testDir, "invalid.json"), "{ invalid json }");

      const result = await loadFixture(
        { file: "invalid.json" },
        { basePath: testDir }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Invalid JSON");
      }
    });

    it("resolves relative paths from basePath", async () => {
      const subDir = join(testDir, "fixtures");
      await mkdir(subDir, { recursive: true });
      await writeFile(join(subDir, "test.json"), JSON.stringify({ app: "test" }));

      const result = await loadFixture(
        { file: "fixtures/test.json" },
        { basePath: testDir }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.app).toBe("test");
        expect(result.path).toContain("fixtures");
      }
    });
  });

  describe("base fixture inheritance", () => {
    it("merges base fixture with main fixture", async () => {
      const baseFixture = {
        app: "todo",
        version: "1.0.0",
        defaults: { priority: "medium" },
      };
      const mainFixture = {
        todos: [{ title: "Test" }],
        defaults: { priority: "high" },
      };

      await writeFile(join(testDir, "base.json"), JSON.stringify(baseFixture));
      await writeFile(join(testDir, "main.json"), JSON.stringify(mainFixture));

      const result = await loadFixture(
        { file: "main.json", base: "base.json" },
        { basePath: testDir }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        // Main fixture values override base
        expect(result.data.defaults).toEqual({ priority: "high" });
        // Base values are preserved if not overridden
        expect(result.data.app).toBe("todo");
        expect(result.data.version).toBe("1.0.0");
        // Main-only values are included
        expect(result.data.todos).toEqual([{ title: "Test" }]);
      }
    });

    it("returns error if base fixture not found", async () => {
      await writeFile(join(testDir, "main.json"), JSON.stringify({ app: "test" }));

      const result = await loadFixture(
        { file: "main.json", base: "missing-base.json" },
        { basePath: testDir }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("base fixture");
      }
    });

    it("handles nested object merging", async () => {
      const baseFixture = {
        config: {
          api: { url: "http://base.com", timeout: 5000 },
          debug: false,
        },
      };
      const mainFixture = {
        config: {
          api: { url: "http://main.com" },
        },
      };

      await writeFile(join(testDir, "base.json"), JSON.stringify(baseFixture));
      await writeFile(join(testDir, "main.json"), JSON.stringify(mainFixture));

      const result = await loadFixture(
        { file: "main.json", base: "base.json" },
        { basePath: testDir }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const config = result.data.config as Record<string, unknown>;
        const api = config.api as Record<string, unknown>;
        // Nested override
        expect(api.url).toBe("http://main.com");
        // Preserved from base
        expect(api.timeout).toBe(5000);
        expect(config.debug).toBe(false);
      }
    });
  });

  describe("inline overrides", () => {
    it("applies inline overrides to loaded fixture", async () => {
      const fixture = {
        app: "todo",
        todos: [{ title: "Original" }],
      };
      await writeFile(join(testDir, "fixture.json"), JSON.stringify(fixture));

      const result = await loadFixture(
        {
          file: "fixture.json",
          overrides: { todos: [{ title: "Overridden" }] },
        },
        { basePath: testDir }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.todos).toEqual([{ title: "Overridden" }]);
        expect(result.data.app).toBe("todo");
      }
    });

    it("combines base, main, and overrides correctly", async () => {
      const base = { level: "base", a: 1, b: 2 };
      const main = { level: "main", b: 20, c: 3 };
      const overrides = { level: "override", c: 30, d: 4 };

      await writeFile(join(testDir, "base.json"), JSON.stringify(base));
      await writeFile(join(testDir, "main.json"), JSON.stringify(main));

      const result = await loadFixture(
        { file: "main.json", base: "base.json", overrides },
        { basePath: testDir }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.level).toBe("override"); // Override wins
        expect(result.data.a).toBe(1); // From base
        expect(result.data.b).toBe(20); // Main overrides base
        expect(result.data.c).toBe(30); // Override overrides main
        expect(result.data.d).toBe(4); // Only in override
      }
    });
  });

  describe("array handling", () => {
    it("replaces arrays instead of merging", async () => {
      const baseFixture = {
        todos: [{ title: "Base 1" }, { title: "Base 2" }],
      };
      const mainFixture = {
        todos: [{ title: "Main 1" }],
      };

      await writeFile(join(testDir, "base.json"), JSON.stringify(baseFixture));
      await writeFile(join(testDir, "main.json"), JSON.stringify(mainFixture));

      const result = await loadFixture(
        { file: "main.json", base: "base.json" },
        { basePath: testDir }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        // Arrays are replaced, not concatenated
        expect(result.data.todos).toEqual([{ title: "Main 1" }]);
      }
    });
  });
});

describe("applyFixture", () => {
  describe("todo app fixtures", () => {
    it("clears todos and creates new ones", async () => {
      const commands: Array<{ command: string; input?: Record<string, unknown> }> = [];

      const handler = async (command: string, input?: Record<string, unknown>) => {
        commands.push({ command, input });
        return { success: true, data: { id: `todo-${commands.length}` } };
      };

      const fixture: FixtureData = {
        app: "todo",
        clearFirst: true,
        todos: [
          { title: "Todo 1", priority: "high" },
          { title: "Todo 2", priority: "low" },
        ],
      };

      const result = await applyFixture(fixture, handler);

      expect(result.success).toBe(true);
      expect(result.appliedCommands.map((c) => c.command)).toContain("todo.clear");
      expect(result.appliedCommands.filter((c) => c.command === "todo.create")).toHaveLength(2);

      // Verify clear was called first
      expect(commands[0]?.command).toBe("todo.clear");
      expect(commands[0]?.input).toEqual({ all: true });

      // Verify todos were created with correct data
      expect(commands[1]?.command).toBe("todo.create");
      expect(commands[1]?.input?.title).toBe("Todo 1");
      expect(commands[1]?.input?.priority).toBe("high");

      expect(commands[2]?.command).toBe("todo.create");
      expect(commands[2]?.input?.title).toBe("Todo 2");
      expect(commands[2]?.input?.priority).toBe("low");
    });

    it("skips clear when clearFirst is false", async () => {
      const commands: string[] = [];

      const handler = async (command: string) => {
        commands.push(command);
        return { success: true };
      };

      const fixture: FixtureData = {
        app: "todo",
        clearFirst: false,
        todos: [{ title: "Todo 1" }],
      };

      await applyFixture(fixture, handler);

      expect(commands).not.toContain("todo.clear");
      expect(commands).toContain("todo.create");
    });

    it("uses default priority when not specified", async () => {
      const inputs: Array<Record<string, unknown>> = [];

      const handler = async (_command: string, input?: Record<string, unknown>) => {
        if (input) inputs.push(input);
        return { success: true };
      };

      const fixture: FixtureData = {
        app: "todo",
        todos: [{ title: "No priority specified" }],
      };

      await applyFixture(fixture, handler);

      // Find the todo.create input (skip todo.clear)
      const createInput = inputs.find((i) => i.title);
      expect(createInput?.priority).toBe("medium");
    });
  });

  describe("violet app fixtures", () => {
    it("creates nodes, then operations, then constraints", async () => {
      const commands: Array<{ command: string; input?: Record<string, unknown> }> = [];

      const handler = async (command: string, input?: Record<string, unknown>) => {
        commands.push({ command, input });
        return { success: true };
      };

      const fixture: FixtureData = {
        app: "violet",
        nodes: [
          { id: "global", name: "Global", type: "root" },
          { id: "product", name: "Product", type: "product", parentId: "global" },
        ],
        operations: [
          { type: "add", nodeId: "global", token: "color.primary", value: "#007bff" },
          { type: "override", nodeId: "product", token: "color.primary", value: "#ff0000" },
        ],
        constraints: [
          { nodeId: "global", id: "brand-colors", type: "enum", tokens: ["color.primary"] },
        ],
      };

      const result = await applyFixture(fixture, handler);

      expect(result.success).toBe(true);

      // Verify order: nodes first, then operations, then constraints
      const nodeCommands = commands.filter((c) => c.command === "node.create");
      const tokenCommands = commands.filter((c) => c.command.startsWith("token."));
      const constraintCommands = commands.filter((c) => c.command === "constraints.set");

      expect(nodeCommands).toHaveLength(2);
      expect(tokenCommands).toHaveLength(2);
      expect(constraintCommands).toHaveLength(1);

      // Verify nodes created with correct data
      expect(nodeCommands[0]?.input?.id).toBe("global");
      expect(nodeCommands[1]?.input?.parentId).toBe("global");

      // Verify token operations
      expect(tokenCommands[0]?.command).toBe("token.add");
      expect(tokenCommands[1]?.command).toBe("token.override");
    });
  });

  describe("generic fixtures", () => {
    it("executes setup commands array", async () => {
      const commands: Array<{ command: string; input?: Record<string, unknown> }> = [];

      const handler = async (command: string, input?: Record<string, unknown>) => {
        commands.push({ command, input });
        return { success: true };
      };

      const fixture: FixtureData = {
        app: "custom",
        setup: [
          { command: "custom.init", input: { name: "test" } },
          { command: "custom.configure", input: { option: true } },
        ],
      };

      const result = await applyFixture(fixture, handler);

      expect(result.success).toBe(true);
      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual({ command: "custom.init", input: { name: "test" } });
      expect(commands[1]).toEqual({ command: "custom.configure", input: { option: true } });
    });

    it("handles empty setup array", async () => {
      const handler = async () => ({ success: true });

      const fixture: FixtureData = {
        app: "custom",
        setup: [],
      };

      const result = await applyFixture(fixture, handler);

      expect(result.success).toBe(true);
      expect(result.appliedCommands).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("returns error when handler throws", async () => {
      const handler = async () => {
        throw new Error("Handler failed");
      };

      const fixture: FixtureData = {
        app: "todo",
        todos: [{ title: "Test" }],
      };

      const result = await applyFixture(fixture, handler);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Handler failed");
    });

    it("includes applied commands even on failure", async () => {
      let callCount = 0;
      const handler = async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Second call failed");
        }
        return { success: true };
      };

      const fixture: FixtureData = {
        app: "todo",
        todos: [{ title: "Todo 1" }, { title: "Todo 2" }],
      };

      const result = await applyFixture(fixture, handler);

      expect(result.success).toBe(false);
      expect(result.appliedCommands.length).toBeGreaterThan(0);
    });
  });
});

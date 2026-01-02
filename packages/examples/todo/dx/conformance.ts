import fs from "fs/promises";
import path from "path";

/**
 * Conformance Test Runner
 *
 * This script runs the shared test-cases.json against a target MCP server.
 * It ensures that all backends (TS, Python, etc.) behave identically.
 */

interface TestCase {
  name: string;
  description: string;
  setup: any[];
  command: string;
  input: any;
  expect: Record<string, any>;
}

interface TestResult {
  name: string;
  success: boolean;
  error?: string;
  actual?: any;
  expected?: any;
}

export class ConformanceRunner {
  private captured: Record<string, any> = {};

  constructor(private callTool: (name: string, args: any) => Promise<any>) {}

  async run(specPath: string): Promise<TestResult[]> {
    const spec = JSON.parse(await fs.readFile(specPath, "utf-8"));
    const results: TestResult[] = [];

    for (const test of spec.tests as TestCase[]) {
      try {
        // 1. Reset state (Clear all)
        await this.callTool("todo.clear", { all: true });
        this.captured = {};

        // 2. Run setup
        for (const step of test.setup) {
          const input = this.resolveVariables(step.input);
          const result = await this.callTool(step.command, input);
          if (step.capture) {
            this.captured[step.capture] = result.data;
          }
        }

        // 3. Run command
        const input = this.resolveVariables(test.input);
        const actual = await this.callTool(test.command, input);

        // 4. Validate expectations
        const errors = this.validate(actual, test.expect);

        results.push({
          name: test.name,
          success: errors.length === 0,
          error: errors.join(", "),
          actual,
          expected: test.expect,
        });
      } catch (err: any) {
        results.push({
          name: test.name,
          success: false,
          error: err.message,
        });
      }
    }

    return results;
  }

  private resolveVariables(input: any): any {
    if (typeof input === "string" && input.startsWith("$")) {
      const parts = input.substring(1).split(".");
      const key = parts[0] as string;
      const path = parts.slice(1);
      let val = this.captured[key];
      for (const p of path) {
        val = val?.[p];
      }
      return val;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.resolveVariables(item));
    }

    if (typeof input === "object" && input !== null) {
      const resolved: any = {};
      for (const [k, v] of Object.entries(input)) {
        resolved[k] = this.resolveVariables(v);
      }
      return resolved;
    }

    return input;
  }

  private validate(actual: any, expect: Record<string, any>): string[] {
    const errors: string[] = [];

    for (const [key, expectedValue] of Object.entries(expect)) {
      const actualValue = this.getValue(actual, key);

      if (key.endsWith(".length")) {
        if (actualValue !== expectedValue) {
          errors.push(
            `Expected ${key} to be ${expectedValue}, got ${actualValue}`
          );
        }
        continue;
      }

      if (actualValue !== expectedValue) {
        errors.push(
          `Expected ${key} to be ${JSON.stringify(
            expectedValue
          )}, got ${JSON.stringify(actualValue)}`
        );
      }
    }

    return errors;
  }

  private getValue(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }
}

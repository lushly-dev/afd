/**
 * @afd/testing - CLI Wrapper
 *
 * Executes CLI commands (afd call <command>) and captures structured output.
 * Supports both subprocess execution and in-process execution modes.
 */

import { spawn } from "node:child_process";
import type { CommandResult } from "@afd/core";
import type { StepError } from "../types/report.js";
import { createStepError } from "../types/report.js";

// ============================================================================
// Configuration Types
// ============================================================================

export interface CliConfig {
  /** Path to the AFD CLI executable (default: "afd") */
  cliPath?: string;

  /** Working directory for CLI execution */
  cwd?: string;

  /** Environment variables to pass to CLI */
  env?: Record<string, string>;

  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** MCP server URL for --connect option */
  serverUrl?: string;

  /** Whether to output verbose logging */
  verbose?: boolean;
}

export interface ExecuteOptions {
  /** Override timeout for this command */
  timeout?: number;

  /** Additional environment variables */
  env?: Record<string, string>;
}

// ============================================================================
// Execution Result Types
// ============================================================================

export interface ExecuteSuccess {
  success: true;
  result: CommandResult<unknown>;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface ExecuteError {
  success: false;
  error: StepError;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode?: number;
}

export type ExecuteResult = ExecuteSuccess | ExecuteError;

// ============================================================================
// CLI Wrapper Class
// ============================================================================

/**
 * Wrapper for executing AFD CLI commands.
 *
 * @example
 * ```typescript
 * const cli = new CliWrapper({ serverUrl: "http://localhost:3000/mcp" });
 * const result = await cli.execute("todo.create", { title: "Buy groceries" });
 * if (result.success) {
 *   console.log(result.result.data);
 * }
 * ```
 */
export class CliWrapper {
  private config: Required<Omit<CliConfig, "serverUrl">> & { serverUrl?: string };

  constructor(config: CliConfig = {}) {
    this.config = {
      cliPath: config.cliPath ?? "afd",
      cwd: config.cwd ?? process.cwd(),
      env: config.env ?? {},
      timeout: config.timeout ?? 30000,
      verbose: config.verbose ?? false,
      serverUrl: config.serverUrl,
    };
  }

  /**
   * Execute a command via the AFD CLI.
   *
   * @param command - Command name (e.g., "todo.create")
   * @param input - Input parameters as an object
   * @param options - Execution options
   */
  async execute(
    command: string,
    input?: Record<string, unknown>,
    options?: ExecuteOptions
  ): Promise<ExecuteResult> {
    const timeout = options?.timeout ?? this.config.timeout;
    const startTime = Date.now();

    // Build CLI arguments
    const args = this.buildArgs(command, input);

    if (this.config.verbose) {
      console.log(`[CLI] ${this.config.cliPath} ${args.join(" ")}`);
    }

    try {
      const { stdout, stderr, exitCode } = await this.spawn(args, timeout, options?.env);
      const durationMs = Date.now() - startTime;

      if (this.config.verbose) {
        console.log(`[CLI] exit=${exitCode} duration=${durationMs}ms`);
        if (stderr) console.log(`[CLI] stderr: ${stderr}`);
      }

      // Try to parse JSON output
      const parseResult = this.parseOutput(stdout, stderr, exitCode);

      if (parseResult.success) {
        return {
          success: true,
          result: parseResult.result,
          durationMs,
          stdout,
          stderr,
        };
      } else {
        return {
          success: false,
          error: parseResult.error,
          durationMs,
          stdout,
          stderr,
          exitCode,
        };
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        error: createStepError("unknown", `CLI execution failed: ${message}`, {
          cause: err instanceof Error ? err : undefined,
        }),
        durationMs,
        stdout: "",
        stderr: message,
      };
    }
  }

  /**
   * Build CLI arguments for a command.
   */
  private buildArgs(command: string, input?: Record<string, unknown>): string[] {
    const args: string[] = ["call", command];

    // Add server URL if configured
    if (this.config.serverUrl) {
      args.push("--connect", this.config.serverUrl);
    }

    // Add JSON format for structured output
    args.push("--json");

    // Add input as JSON argument if provided
    if (input && Object.keys(input).length > 0) {
      args.push("--input", JSON.stringify(input));
    }

    return args;
  }

  /**
   * Spawn CLI process and capture output.
   */
  private spawn(
    args: string[],
    timeout: number,
    extraEnv?: Record<string, string>
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.cliPath, args, {
        cwd: this.config.cwd,
        env: {
          ...process.env,
          ...this.config.env,
          ...extraEnv,
        },
        shell: process.platform === "win32",
        timeout,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });

      proc.on("error", (err) => {
        reject(err);
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      proc.on("close", () => {
        clearTimeout(timeoutId);
      });
    });
  }

  /**
   * Parse CLI output into a CommandResult.
   */
  private parseOutput(
    stdout: string,
    stderr: string,
    exitCode: number
  ): { success: true; result: CommandResult<unknown> } | { success: false; error: StepError } {
    // Try to extract JSON from stdout
    const trimmed = stdout.trim();

    // Look for JSON object in output (may have non-JSON prefix/suffix)
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // If exit code is 0 but no JSON, treat as success with string data
      if (exitCode === 0) {
        return {
          success: true,
          result: {
            success: true,
            data: trimmed || undefined,
          },
        };
      }

      // Non-zero exit with no JSON is an error
      return {
        success: false,
        error: createStepError("parse_error", stderr || stdout || "Command failed with no output"),
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;

      // Check if it's a CommandResult-like object
      if (typeof parsed === "object" && parsed !== null && "success" in parsed) {
        return {
          success: true,
          result: parsed as CommandResult<unknown>,
        };
      }

      // Wrap raw data in a CommandResult
      return {
        success: true,
        result: {
          success: exitCode === 0,
          data: parsed,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: createStepError(
          "parse_error",
          `Failed to parse JSON output: ${err instanceof Error ? err.message : String(err)}`
        ),
      };
    }
  }

  /**
   * Update configuration.
   */
  configure(config: Partial<CliConfig>): void {
    if (config.cliPath !== undefined) this.config.cliPath = config.cliPath;
    if (config.cwd !== undefined) this.config.cwd = config.cwd;
    if (config.env !== undefined) this.config.env = config.env;
    if (config.timeout !== undefined) this.config.timeout = config.timeout;
    if (config.serverUrl !== undefined) this.config.serverUrl = config.serverUrl;
    if (config.verbose !== undefined) this.config.verbose = config.verbose;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a CLI wrapper with the given configuration.
 */
export function createCliWrapper(config?: CliConfig): CliWrapper {
  return new CliWrapper(config);
}

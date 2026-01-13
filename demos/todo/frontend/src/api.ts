import type { CommandResult } from "./types";

/** API server URL - configurable via VITE_API_URL env var */
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3101";
let messageId = 0;

export async function callTool<T>(
  name: string,
  args: any = {}
): Promise<CommandResult<T>> {
  const id = ++messageId;

  try {
    const response = await fetch(`${API_URL}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    const content = data.result?.content?.[0]?.text;
    if (!content) {
      throw new Error("Invalid response format");
    }

    return JSON.parse(content);
  } catch (error: any) {
    return {
      success: false,
      data: null as any,
      error: {
        code: "FETCH_ERROR",
        message: error.message,
      },
    };
  }
}

/**
 * Transport-level batch execution using the afd-batch tool.
 * Executes multiple different commands in a single roundtrip.
 *
 * @example
 * ```typescript
 * const result = await callBatch([
 *   { command: 'todo.create', input: { title: 'Task 1' } },
 *   { command: 'todo.list', input: {} }
 * ]);
 * ```
 */
export interface BatchCommand {
  id?: string;
  command: string;
  input: unknown;
}

export interface BatchOptions {
  stopOnError?: boolean;
  timeout?: number;
}

export interface BatchResult {
  success: boolean;
  results: Array<{
    id: string;
    index: number;
    command: string;
    result: CommandResult<unknown>;
    durationMs: number;
  }>;
  summary: {
    total: number;
    successCount: number;
    failureCount: number;
    skippedCount: number;
  };
  confidence: number;
  reasoning: string;
}

export async function callBatch(
  commands: BatchCommand[],
  options?: BatchOptions
): Promise<BatchResult> {
  return callTool<BatchResult>("afd-batch", {
    commands,
    options,
  }).then((res) => {
    if (res.success && res.data) {
      return res.data;
    }
    // Return a failed batch result
    return {
      success: false,
      results: [],
      summary: { total: 0, successCount: 0, failureCount: 0, skippedCount: 0 },
      confidence: 0,
      reasoning: res.error?.message || "Batch execution failed",
    };
  });
}

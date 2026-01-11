/**
 * @fileoverview todo.clear command
 */

import { z } from "zod";
import { defineCommand, success } from "@lushly-dev/afd-server";
import { store } from "../store/index.js";

const inputSchema = z.object({
  all: z
    .boolean()
    .optional()
    .describe("If true, clear all todos regardless of status"),
});

export interface ClearResult {
  cleared: number;
  remaining: number;
}

export const clearCompleted = defineCommand<typeof inputSchema, ClearResult>({
  name: 'todo-clear',
  description: "Clear completed todos (or all if specified)",
  category: "todo",
  tags: ['todo', 'clear', 'write', 'batch', 'destructive'],
  mutation: true,
  version: "1.0.0",
  input: inputSchema,

  async handler(input: z.infer<typeof inputSchema>) {
    console.error(`[todo.clear] input:`, JSON.stringify(input));
    if (input.all) {
      const count = store.count();
      console.error(`[todo.clear] Clearing all ${count} todos`);
      store.clear();
      return success(
        { cleared: count, remaining: 0 },
        {
          reasoning: `Cleared all ${count} todos`,
          confidence: 1.0,
        }
      );
    }

    const result = store.clearCompleted();

    return success(
      {
        cleared: result.cleared,
        remaining: result.remaining,
      },
      {
        reasoning:
          result.cleared > 0
            ? `Cleared ${result.cleared} completed todo${
                result.cleared === 1 ? "" : "s"
              }, ${result.remaining} remaining`
            : `No completed todos to clear, ${result.remaining} remaining`,
        confidence: 1.0,
        warnings:
          result.cleared > 0
            ? [
                {
                  code: "PERMANENT",
                  message: "This action cannot be undone",
                  severity: "info",
                },
              ]
            : undefined,
      }
    );
  },
});

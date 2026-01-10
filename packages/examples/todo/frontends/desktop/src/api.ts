/**
 * API client for communicating with the sidecar Todo backend server.
 * Uses the same MCP JSON-RPC protocol as the web frontend.
 */

import type { CommandResult } from './types';

const API_URL = 'http://localhost:3100/message';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

let requestId = 0;

export async function callCommand<T>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<CommandResult<T>> {
  const request: MCPRequest = {
    jsonrpc: '2.0',
    id: ++requestId,
    method: 'tools/call',
    params: {
      name: command,
      arguments: args,
    },
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: 'HTTP_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
          suggestion: 'Check if the backend server is running.',
        },
      };
    }

    const data: MCPResponse = await response.json();

    if (data.error) {
      return {
        success: false,
        error: {
          code: 'RPC_ERROR',
          message: data.error.message,
        },
      };
    }

    if (data.result?.content?.[0]?.text) {
      const parsed = JSON.parse(data.result.content[0].text);
      return parsed as CommandResult<T>;
    }

    return {
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: 'Invalid response format',
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message,
        suggestion: 'Make sure the Todo server is running. It starts automatically with the app.',
      },
    };
  }
}

// Convenience methods for common operations
export const api = {
  async listTodos(filter?: { status?: 'all' | 'pending' | 'completed' }) {
    return callCommand<{ items: Todo[]; total: number }>('todo-list', filter || {});
  },

  async createTodo(title: string, options?: { description?: string; priority?: number }) {
    return callCommand<Todo>('todo-create', { title, ...options });
  },

  async toggleTodo(id: string) {
    return callCommand<Todo>('todo-toggle', { id });
  },

  async deleteTodo(id: string) {
    return callCommand<{ deleted: boolean }>('todo-delete', { id });
  },

  async updateTodo(id: string, updates: Partial<Todo>) {
    return callCommand<Todo>('todo-update', { id, ...updates });
  },

  async getStats() {
    return callCommand<TodoStats>('todo-stats', {});
  },

  async clearCompleted() {
    return callCommand<{ cleared: number }>('todo-clear', {});
  },
};

export interface Todo {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodoStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  completionRate: number;
}

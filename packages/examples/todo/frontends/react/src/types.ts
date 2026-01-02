export type Priority = "low" | "medium" | "high";

export interface Todo {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TodoStats {
  total: number;
  completed: number;
  pending: number;
  completionRate: number;
}

export interface CommandResult<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
  };
  reasoning?: string;
  confidence?: number;
  metadata?: {
    executionTimeMs: number;
  };
}

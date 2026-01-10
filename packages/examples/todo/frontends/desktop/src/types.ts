/**
 * AFD Core types for the desktop frontend.
 */

export interface CommandError {
  code: string;
  message: string;
  suggestion?: string;
}

export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: CommandError;
  confidence?: number;
  reasoning?: string;
  warnings?: string[];
  executionTime?: number;
}

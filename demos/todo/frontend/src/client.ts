/**
 * AFD Client - Browser SDK wrapper
 */

interface CommandResult<T = unknown> {
  data: T;
  metadata?: {
    confidence?: number;
    reasoning?: string;
  };
  _debug?: {
    latency: string;
    command: string;
  };
}

interface CommandLogEntry {
  command: string;
  latency: string;
  confidence: number;
  timestamp: Date;
  success: boolean;
}

class AFDClient {
  private baseUrl: string;
  private commandLog: CommandLogEntry[] = [];
  private onLogUpdate?: (log: CommandLogEntry[]) => void;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  setLogCallback(callback: (log: CommandLogEntry[]) => void) {
    this.onLogUpdate = callback;
  }

  async execute<T = unknown>(command: string, input: Record<string, unknown> = {}): Promise<CommandResult<T>> {
    const response = await fetch(`${this.baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, input }),
    });

    const result = await response.json() as CommandResult<T>;

    // Log command
    const entry: CommandLogEntry = {
      command,
      latency: result._debug?.latency || 'unknown',
      confidence: result.metadata?.confidence || 1.0,
      timestamp: new Date(),
      success: response.ok,
    };
    this.commandLog.unshift(entry);
    if (this.commandLog.length > 50) this.commandLog.pop();
    this.onLogUpdate?.(this.commandLog);

    if (!response.ok) {
      throw new Error((result as any).error || 'Command failed');
    }

    return result;
  }

  getLog(): CommandLogEntry[] {
    return this.commandLog;
  }
}

export const client = new AFDClient();
export type { CommandResult, CommandLogEntry };

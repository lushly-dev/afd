import React from "react";
import "./CommandLog.css";

export interface LogEntry {
  id: number;
  timestamp: Date;
  message: string;
  type: "success" | "error" | "info";
}

interface CommandLogProps {
  entries: LogEntry[];
}

export const CommandLog: React.FC<CommandLogProps> = ({ entries }) => {
  return (
    <div className="command-log-card">
      <h3 className="command-log-title">Command Log</h3>
      <div className="command-log-panel">
        {entries.length === 0 ? (
          <div className="log-entry">Waiting for commands...</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`log-entry ${entry.type}`}>
              [{entry.timestamp.toLocaleTimeString()}] {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// Hook for managing log entries
let logIdCounter = 0;

export const useCommandLog = () => {
  const [entries, setEntries] = React.useState<LogEntry[]>([
    { id: logIdCounter++, timestamp: new Date(), message: "Initializing...", type: "info" },
  ]);

  const log = React.useCallback((message: string, type: LogEntry["type"] = "info") => {
    setEntries((prev) => {
      const newEntry: LogEntry = {
        id: logIdCounter++,
        timestamp: new Date(),
        message,
        type,
      };
      // Keep only last 50 entries, newest first
      return [newEntry, ...prev].slice(0, 50);
    });
  }, []);

  return { entries, log };
};

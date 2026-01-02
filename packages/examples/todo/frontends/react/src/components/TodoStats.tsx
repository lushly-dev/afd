import React from "react";
import type { TodoStats as ITodoStats } from "../types";

interface TodoStatsProps {
  stats: ITodoStats | null;
}

export const TodoStats: React.FC<TodoStatsProps> = ({ stats }) => {
  if (!stats) return null;

  return (
    <div className="todo-stats">
      <div className="stat-item">
        <span className="stat-label">Total:</span>
        <span className="stat-value">{stats.total}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Pending:</span>
        <span className="stat-value">{stats.pending}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Completed:</span>
        <span className="stat-value">{stats.completed}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Rate:</span>
        <span className="stat-value">
          {Math.round(stats.completionRate * 100)}%
        </span>
      </div>
    </div>
  );
};

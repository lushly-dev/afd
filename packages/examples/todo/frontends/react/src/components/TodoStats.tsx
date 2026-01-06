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
        <span className="stat-value">{stats.total}</span>
        <span className="stat-label">Total</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{stats.pending}</span>
        <span className="stat-label">Pending</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{stats.completed}</span>
        <span className="stat-label">Completed</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{Math.round(stats.completionRate * 100)}%</span>
        <span className="stat-label">Done</span>
      </div>
    </div>
  );
};

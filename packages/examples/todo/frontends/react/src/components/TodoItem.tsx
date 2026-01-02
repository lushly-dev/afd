import React from "react";
import type { Todo } from "../types";

interface TodoItemProps {
  todo: Todo;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

export const TodoItem: React.FC<TodoItemProps> = ({
  todo,
  onToggle,
  onDelete,
}) => {
  return (
    <div className={`todo-item ${todo.completed ? "completed" : ""}`}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => onToggle(todo.id)}
      />
      <div className="todo-content">
        <div className="todo-title">{todo.title}</div>
        {todo.description && (
          <div className="todo-description">{todo.description}</div>
        )}
        <div className="todo-meta">
          <span className={`priority-badge priority-${todo.priority}`}>
            {todo.priority}
          </span>
        </div>
      </div>
      <button onClick={() => onDelete(todo.id)} className="delete-btn">
        Delete
      </button>
    </div>
  );
};

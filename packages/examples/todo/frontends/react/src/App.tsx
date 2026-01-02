import React, { useState, useEffect, useCallback } from "react";
import type { Todo, TodoStats as ITodoStats } from "./types";
import { callTool } from "./api";
import { TodoItem } from "./components/TodoItem";
import { TodoForm } from "./components/TodoForm";
import { TodoStats } from "./components/TodoStats";
import "./App.css";

const App: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [stats, setStats] = useState<ITodoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [todosRes, statsRes] = await Promise.all([
        callTool<Todo[]>("todo.list", {}),
        callTool<ITodoStats>("todo.stats", {}),
      ]);

      if (todosRes.success && todosRes.data) {
        setTodos(todosRes.data);
      }
      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }
    } catch (err) {
      setError("Failed to fetch data from MCP server");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddTodo = async (title: string) => {
    const res = await callTool<Todo>("todo.create", { title });
    if (res.success) {
      fetchData();
    }
  };

  const handleToggleTodo = async (id: string) => {
    const res = await callTool<Todo>("todo.toggle", { id });
    if (res.success) {
      fetchData();
    }
  };

  const handleDeleteTodo = async (id: string) => {
    const res = await callTool<{ id: string }>("todo.delete", { id });
    if (res.success) {
      fetchData();
    }
  };

  const handleClearCompleted = async () => {
    const res = await callTool<{ count: number }>("todo.clear", {});
    if (res.success) {
      fetchData();
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>
          AFD Todo <span className="badge">React</span>
        </h1>
        <p className="subtitle">Agent-First Development Example</p>
      </header>

      <main>
        <TodoForm onAdd={handleAddTodo} />

        <TodoStats stats={stats} />

        {loading && <div className="loading">Loading todos...</div>}
        {error && <div className="error">{error}</div>}

        <div className="todo-list">
          {todos.length === 0 && !loading ? (
            <p className="empty-state">No todos yet. Add one above!</p>
          ) : (
            todos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onToggle={handleToggleTodo}
                onDelete={handleDeleteTodo}
              />
            ))
          )}
        </div>

        {stats && stats.completed > 0 && (
          <button className="clear-btn" onClick={handleClearCompleted}>
            Clear Completed
          </button>
        )}
      </main>

      <footer>
        <p>Powered by MCP & AFD</p>
      </footer>
    </div>
  );
};

export default App;

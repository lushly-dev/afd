import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { api, type Todo, type TodoStats } from './api';
import './App.css';

type FilterStatus = 'all' | 'pending' | 'completed';

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [stats, setStats] = useState<TodoStats | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<'starting' | 'running' | 'error'>('starting');

  const checkServerStatus = useCallback(async () => {
    try {
      const isRunning = await invoke<boolean>('get_server_status');
      if (isRunning) {
        setServerStatus('running');
        return true;
      }
    } catch {
      // Server not ready yet
    }
    return false;
  }, []);

  const fetchTodos = useCallback(async () => {
    const result = await api.listTodos(filter !== 'all' ? { status: filter } : undefined);
    if (result.success && result.data) {
      setTodos(result.data.items);
      setError(null);
    } else if (result.error) {
      setError(result.error.message);
    }
  }, [filter]);

  const fetchStats = useCallback(async () => {
    const result = await api.getStats();
    if (result.success && result.data) {
      setStats(result.data);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([fetchTodos(), fetchStats()]);
  }, [fetchTodos, fetchStats]);

  useEffect(() => {
    let mounted = true;
    let retryCount = 0;
    const maxRetries = 10;

    const init = async () => {
      // Wait for server to start
      while (mounted && retryCount < maxRetries) {
        const running = await checkServerStatus();
        if (running) {
          // Give server a moment to fully initialize
          await new Promise(r => setTimeout(r, 500));
          await refresh();
          setLoading(false);
          return;
        }
        retryCount++;
        await new Promise(r => setTimeout(r, 1000));
      }

      if (mounted) {
        setServerStatus('error');
        setError('Failed to connect to backend server');
        setLoading(false);
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, [checkServerStatus, refresh]);

  useEffect(() => {
    if (serverStatus === 'running') {
      fetchTodos();
    }
  }, [filter, serverStatus, fetchTodos]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const result = await api.createTodo(newTitle.trim());
    if (result.success) {
      setNewTitle('');
      refresh();
    } else if (result.error) {
      setError(result.error.message);
    }
  };

  const handleToggle = async (id: string) => {
    const result = await api.toggleTodo(id);
    if (result.success) {
      refresh();
    } else if (result.error) {
      setError(result.error.message);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await api.deleteTodo(id);
    if (result.success) {
      refresh();
    } else if (result.error) {
      setError(result.error.message);
    }
  };

  const handleClearCompleted = async () => {
    const result = await api.clearCompleted();
    if (result.success) {
      refresh();
    } else if (result.error) {
      setError(result.error.message);
    }
  };

  if (loading) {
    return (
      <div className="app loading-screen">
        <div className="loading-content">
          <div className="loading-spinner large" />
          <h2>Starting Todo Server...</h2>
          <p>The backend is initializing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>AFD Todo</h1>
        <div className="server-status">
          <span className={`status-dot ${serverStatus}`} />
          {serverStatus === 'running' ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main className="main">
        {stats && (
          <div className="stats-bar">
            <div className="stat">
              <span className="stat-value">{stats.total}</span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.completed}</span>
              <span className="stat-label">Done</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.pending}</span>
              <span className="stat-label">Pending</span>
            </div>
            <div className="stat">
              <span className="stat-value">{Math.round(stats.completionRate * 100)}%</span>
              <span className="stat-label">Rate</span>
            </div>
          </div>
        )}

        <form className="create-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="What needs to be done?"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-primary">Add</button>
        </form>

        <div className="filter-bar">
          {(['all', 'pending', 'completed'] as const).map(f => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          {stats && stats.completed > 0 && (
            <button className="clear-btn" onClick={handleClearCompleted}>
              Clear completed
            </button>
          )}
        </div>

        <ul className="todo-list">
          {todos.length === 0 ? (
            <li className="empty-state">
              {filter === 'all' ? 'No todos yet. Add one above!' : `No ${filter} todos.`}
            </li>
          ) : (
            todos.map(todo => (
              <li key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                <button
                  className="toggle-btn"
                  onClick={() => handleToggle(todo.id)}
                  aria-label={todo.completed ? 'Mark incomplete' : 'Mark complete'}
                >
                  {todo.completed ? '✓' : '○'}
                </button>
                <div className="todo-content">
                  <span className="todo-title">{todo.title}</span>
                  {todo.description && (
                    <span className="todo-description">{todo.description}</span>
                  )}
                </div>
                <div className="todo-meta">
                  {todo.priority > 0 && (
                    <span className={`priority priority-${todo.priority}`}>
                      {'!'.repeat(todo.priority)}
                    </span>
                  )}
                </div>
                <button
                  className="delete-btn"
                  onClick={() => handleDelete(todo.id)}
                  aria-label="Delete todo"
                >
                  ×
                </button>
              </li>
            ))
          )}
        </ul>
      </main>

      <footer className="footer">
        <p>Built with Tauri + AFD</p>
      </footer>
    </div>
  );
}

# Phase 04 - Frontends

> **Goal**: Update the Vanilla JS frontend and create a React frontend, both configurable to connect to any backend via `BACKEND_URL`.

---

## Current State

| Frontend | Status | Features |
|----------|--------|----------|
| Vanilla JS | Complete | Full AFD metadata display |
| React | Not started | — |

The existing Vanilla JS frontend demonstrates all AFD UX patterns:
- Confidence indicators
- Reasoning display
- Warnings/alerts
- Error suggestions
- Alternatives panel

---

## Vanilla JS Frontend Tasks

### Task 1: Move to new location

Move from `packages/examples/todo-app/ui/` to `packages/examples/todo/frontends/vanilla/`.

### Task 2: Add configurable backend URL

Update `app.js` to read `BACKEND_URL` from environment or use default:

```javascript
// Configuration - read from environment or use default
const SERVER_URL = window.BACKEND_URL || 'http://localhost:3100';
```

For development with Vite, create `vite.config.js`:

```javascript
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'window.BACKEND_URL': JSON.stringify(process.env.BACKEND_URL || 'http://localhost:3100'),
  },
  server: {
    port: 5173,
  },
});
```

### Task 3: Create package.json

```json
{
  "name": "@afd/example-todo-vanilla",
  "version": "1.0.0",
  "description": "Todo example - Vanilla JS frontend",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.2.0"
  }
}
```

### Task 4: Extract CSS to separate file

Currently styles are in `index.html`. Extract to `style.css` for maintainability.

### Task 5: Create README

```markdown
# Todo Frontend - Vanilla JS

Pure JavaScript frontend demonstrating AFD patterns.

## Quick Start

```bash
# Start any backend first, then:
pnpm dev
```

Opens at http://localhost:5173

## Configuration

Set `BACKEND_URL` environment variable to connect to different backends:

```bash
BACKEND_URL=http://localhost:3100 pnpm dev
```

## AFD Features Demonstrated

- Confidence indicators on operations
- Reasoning display in toasts
- Warning alerts for destructive actions
- Error suggestions for recovery
- Alternatives panel for filtered queries
```

---

## React Frontend Tasks

### Task 1: Create project structure

```
frontends/react/
├── src/
│   ├── components/
│   │   ├── TodoList.tsx
│   │   ├── TodoItem.tsx
│   │   ├── AddTodo.tsx
│   │   ├── Stats.tsx
│   │   ├── FilterBar.tsx
│   │   ├── Toast.tsx
│   │   ├── ConfirmModal.tsx
│   │   └── AlternativesPanel.tsx
│   ├── hooks/
│   │   ├── useTodos.ts
│   │   ├── useMcp.ts
│   │   └── useToast.ts
│   ├── lib/
│   │   └── mcp-client.ts
│   ├── types/
│   │   └── todo.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

### Task 2: Create package.json

```json
{
  "name": "@afd/example-todo-react",
  "version": "1.0.0",
  "description": "Todo example - React frontend",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "biome check src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0"
  }
}
```

### Task 3: Create MCP client hook

```typescript
// src/hooks/useMcp.ts
import { useState, useCallback } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3100';

interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
  };
  reasoning?: string;
  confidence?: number;
  warnings?: Array<{
    code: string;
    message: string;
    severity?: string;
  }>;
  alternatives?: Array<{
    data: T;
    reason: string;
    confidence?: number;
  }>;
  metadata?: {
    executionTimeMs?: number;
  };
}

let messageId = 0;

export function useMcp() {
  const [isConnected, setIsConnected] = useState(false);

  const callTool = useCallback(async <T>(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<CommandResult<T>> => {
    const id = ++messageId;

    const response = await fetch(`${BACKEND_URL}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    const content = data.result?.content?.[0]?.text;
    if (!content) {
      throw new Error('Invalid response format');
    }

    return JSON.parse(content);
  }, []);

  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/health`);
      const data = await response.json();
      setIsConnected(data.status === 'ok');
      return data.status === 'ok';
    } catch {
      setIsConnected(false);
      return false;
    }
  }, []);

  return { callTool, checkConnection, isConnected };
}
```

### Task 4: Create todos hook

```typescript
// src/hooks/useTodos.ts
import { useState, useEffect, useCallback } from 'react';
import { useMcp } from './useMcp';
import type { Todo, TodoStats, ListResult } from '../types/todo';

export function useTodos() {
  const { callTool, checkConnection, isConnected } = useMcp();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [stats, setStats] = useState<TodoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const loadTodos = useCallback(async () => {
    const filterParams: Record<string, unknown> = {};
    if (filter === 'pending') filterParams.completed = false;
    if (filter === 'completed') filterParams.completed = true;

    const result = await callTool<ListResult>('todo.list', {
      ...filterParams,
      limit: 100,
    });

    if (result.success && result.data) {
      setTodos(result.data.todos);
    }

    return result;
  }, [callTool, filter]);

  const loadStats = useCallback(async () => {
    const result = await callTool<TodoStats>('todo.stats', {});
    if (result.success && result.data) {
      setStats(result.data);
    }
    return result;
  }, [callTool]);

  const createTodo = useCallback(async (title: string, priority: string = 'medium') => {
    const result = await callTool<Todo>('todo.create', { title, priority });
    if (result.success) {
      await Promise.all([loadTodos(), loadStats()]);
    }
    return result;
  }, [callTool, loadTodos, loadStats]);

  const toggleTodo = useCallback(async (id: string) => {
    const result = await callTool<Todo>('todo.toggle', { id });
    if (result.success) {
      await Promise.all([loadTodos(), loadStats()]);
    }
    return result;
  }, [callTool, loadTodos, loadStats]);

  const deleteTodo = useCallback(async (id: string) => {
    const result = await callTool<{ deleted: boolean; id: string }>('todo.delete', { id });
    if (result.success) {
      await Promise.all([loadTodos(), loadStats()]);
    }
    return result;
  }, [callTool, loadTodos, loadStats]);

  const clearCompleted = useCallback(async () => {
    const result = await callTool<{ cleared: number; remaining: number }>('todo.clear', {});
    if (result.success) {
      await Promise.all([loadTodos(), loadStats()]);
    }
    return result;
  }, [callTool, loadTodos, loadStats]);

  // Initial load
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const connected = await checkConnection();
      if (connected) {
        await Promise.all([loadTodos(), loadStats()]);
      }
      setLoading(false);
    };
    init();
  }, [checkConnection, loadTodos, loadStats]);

  // Reload on filter change
  useEffect(() => {
    if (isConnected) {
      loadTodos();
    }
  }, [filter, isConnected, loadTodos]);

  return {
    todos,
    stats,
    loading,
    isConnected,
    filter,
    setFilter,
    createTodo,
    toggleTodo,
    deleteTodo,
    clearCompleted,
    refresh: () => Promise.all([loadTodos(), loadStats()]),
  };
}
```

### Task 5: Create Toast component with AFD metadata

```typescript
// src/components/Toast.tsx
import { useEffect } from 'react';

interface ToastProps {
  result: {
    success: boolean;
    error?: { message: string; suggestion?: string };
    reasoning?: string;
    confidence?: number;
    metadata?: { executionTimeMs?: number };
  };
  commandName: string;
  onClose: () => void;
}

export function Toast({ result, commandName, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const confidencePercent = result.confidence !== undefined 
    ? Math.round(result.confidence * 100) 
    : null;

  const confidenceClass = result.confidence !== undefined
    ? result.confidence >= 0.9 ? 'high' : result.confidence >= 0.7 ? 'medium' : 'low'
    : '';

  return (
    <div className={`toast ${result.success ? 'success' : 'error'}`}>
      <span className="toast-icon">{result.success ? '✓' : '✗'}</span>
      <div className="toast-content">
        <div className="toast-message">
          {result.success 
            ? result.reasoning || `${commandName} completed`
            : result.error?.message || 'Operation failed'
          }
        </div>
        <div className="toast-meta">
          {confidencePercent !== null && (
            <span className="toast-confidence">
              <span className={`confidence-bar ${confidenceClass}`}>
                <span 
                  className="confidence-fill" 
                  style={{ width: `${confidencePercent}%` }}
                />
              </span>
              {confidencePercent}%
            </span>
          )}
          {result.metadata?.executionTimeMs !== undefined && (
            <span>⚡ {result.metadata.executionTimeMs}ms</span>
          )}
        </div>
        {!result.success && result.error?.suggestion && (
          <div className="toast-suggestion">
            <strong>💡 Suggestion:</strong> {result.error.suggestion}
          </div>
        )}
      </div>
      <button className="toast-close" onClick={onClose}>×</button>
    </div>
  );
}
```

### Task 6: Create main App component

```typescript
// src/App.tsx
import { useTodos } from './hooks/useTodos';
import { TodoList } from './components/TodoList';
import { AddTodo } from './components/AddTodo';
import { Stats } from './components/Stats';
import { FilterBar } from './components/FilterBar';
import { ToastContainer } from './components/ToastContainer';

export function App() {
  const {
    todos,
    stats,
    loading,
    isConnected,
    filter,
    setFilter,
    createTodo,
    toggleTodo,
    deleteTodo,
    clearCompleted,
  } = useTodos();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!isConnected) {
    return (
      <div className="disconnected">
        <h1>Server Disconnected</h1>
        <p>Start the backend server and refresh.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>Todo App</h1>
        <p className="subtitle">AFD Example - React Frontend</p>
      </header>

      <Stats stats={stats} />
      
      <AddTodo onAdd={createTodo} />
      
      <FilterBar 
        filter={filter} 
        onFilterChange={setFilter}
        onClearCompleted={clearCompleted}
      />
      
      <TodoList 
        todos={todos}
        onToggle={toggleTodo}
        onDelete={deleteTodo}
      />

      <ToastContainer />
    </div>
  );
}
```

### Task 7: Style to match Vanilla version

Create `src/index.css` with similar styles to the Vanilla version for visual consistency.

### Task 8: Create vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BACKEND_URL': JSON.stringify(
      process.env.BACKEND_URL || 'http://localhost:3100'
    ),
  },
  server: {
    port: 5174, // Different from Vanilla to run both
  },
});
```

---

## AFD Features to Implement

Both frontends must display these AFD metadata fields:

| Feature | Display Location |
|---------|------------------|
| `confidence` | Progress bar in toast notifications |
| `reasoning` | Toast message text |
| `warnings` | Separate warning toasts |
| `error.suggestion` | Recovery hint in error toasts |
| `alternatives` | Panel below filter bar |
| `metadata.executionTimeMs` | Performance indicator in toast |

---

## Tasks

### Vanilla JS
- [ ] Move files to new location
- [ ] Add BACKEND_URL configuration
- [ ] Create package.json with Vite
- [ ] Extract CSS to separate file
- [ ] Create README
- [ ] Verify all AFD features work

### React
- [ ] Create project structure
- [ ] Create package.json and configs
- [ ] Implement MCP client hook
- [ ] Implement todos hook
- [ ] Create TodoList component
- [ ] Create TodoItem component
- [ ] Create AddTodo component
- [ ] Create Stats component
- [ ] Create FilterBar component
- [ ] Create Toast component with AFD metadata
- [ ] Create ConfirmModal component
- [ ] Create AlternativesPanel component
- [ ] Create main App component
- [ ] Style to match Vanilla version
- [ ] Create README
- [ ] Test with TypeScript backend
- [ ] Test with Python backend

---

## Validation Criteria

Phase 04 is complete when:

1. Vanilla JS frontend works with configurable `BACKEND_URL`
2. React frontend implements all features
3. Both frontends work with both backends
4. AFD metadata (confidence, reasoning, warnings, suggestions, alternatives) displayed correctly
5. Visual appearance is consistent between frontends

---

## Next Phase

[Phase 05 - Developer Experience](./05-developer-experience.plan.md) — Scripts, docs, and onboarding

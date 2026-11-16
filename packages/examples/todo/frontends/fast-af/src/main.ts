/**
 * Entry point: register the violet elements the page uses, apply the theme, define the page and connect it to
 * the backend. `?backend=http://host:port` picks another backend (default http://localhost:3100).
 */
import '@afd/example-todo-ui/elements';
import { TodoSession } from '@afd/example-todo-ui/session';
import { applyTheme } from '@afd/example-todo-ui/theme';
import { defineTodoApp, type TodoApp } from './todo-app';
import '@afd/example-todo-ui/styles.css';

applyTheme();
await defineTodoApp();
const backend = new URLSearchParams(location.search).get('backend') ?? 'http://localhost:3100';
const session = new TodoSession({ baseUrl: backend.replace(/\/+$/, '') });
const app = document.querySelector<TodoApp>('todo-app');
app?.attach(session);
await session.start();
document.documentElement.dataset.ready = 'true';
// For an in-page agent (phase 4) and for tests: the page's view-state commands
(globalThis as { todoPage?: unknown }).todoPage = { session, view: session.view };

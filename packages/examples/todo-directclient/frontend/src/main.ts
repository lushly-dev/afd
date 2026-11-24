/**
 * Entry point: the to-do page (`<todo-app>`, from the FAST-AF frontend) and the copilot panel,
 * on one session. The list talks MCP at `/mcp`; the copilot asks `/chat`. Both are this page's
 * server unless the page was opened with `?backend=http://host:port`, which works only where the
 * build is served without the server's Content-Security-Policy (`connect-src 'self'`), as the
 * shared Chromium suite serves it.
 */
import './elements';
import { defineTodoApp, type TodoApp } from '@afd/example-todo-fast-af/todo-app';
import { TodoSession } from '@afd/example-todo-ui/session';
import { applyTheme } from '@afd/example-todo-ui/theme';
import { defineTodoCopilot, type TodoCopilot } from './todo-copilot';
import '@afd/example-todo-ui/styles.css';
import './copilot.css';

await applyTheme();
await Promise.all([defineTodoApp(), defineTodoCopilot()]);
const backend = (new URLSearchParams(location.search).get('backend') ?? location.origin).replace(
	/\/+$/,
	''
);
const session = new TodoSession({ baseUrl: backend });
document.querySelector<TodoApp>('todo-app')?.attach(session);
document.querySelector<TodoCopilot>('todo-copilot')?.attach(session, backend);
await session.start();
document.documentElement.dataset.ready = 'true';
// For tests: the page's session and its view-state commands
(globalThis as { todoPage?: unknown }).todoPage = { session, view: session.view };

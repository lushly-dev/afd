/**
 * Entry point: register the violet elements the page uses, apply the theme, and render the shared
 * session. `?backend=http://host:port` picks another backend (default http://localhost:3100).
 */
import '@afd/example-todo-ui/elements';
import '@afd/example-todo-ui/styles.css';
import { TodoSession } from '@afd/example-todo-ui/session';
import { applyTheme } from '@afd/example-todo-ui/theme';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

await applyTheme();
const backend = new URLSearchParams(location.search).get('backend') ?? 'http://localhost:3100';
const session = new TodoSession({ baseUrl: backend.replace(/\/+$/, '') });
const root = document.getElementById('root');
if (root) {
	createRoot(root).render(
		<StrictMode>
			<App session={session} />
		</StrictMode>
	);
}
await session.start();
document.documentElement.dataset.ready = 'true';
// For an in-page agent (phase 4) and for tests: the page's view-state commands
(globalThis as { todoPage?: unknown }).todoPage = { session, view: session.view };

import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css'; // Design tokens - import first
import './index.css';
import { AppWithAuth } from './AppWithAuth.tsx';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ConvexAuthProvider client={convex}>
			<AppWithAuth />
		</ConvexAuthProvider>
	</StrictMode>
);

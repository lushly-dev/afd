import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The React page, served by `pnpm dev` on port 5174 (an origin the TypeScript backend allows), so
 * it can run beside the FAST-AF page on 5173. The bundle is mostly the MCP client SDK, Zod and
 * React; the page imports only the violet elements it uses.
 */
export default defineConfig({
	plugins: [react()],
	resolve: { conditions: ['browser'] },
	server: { port: 5174 },
	build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});

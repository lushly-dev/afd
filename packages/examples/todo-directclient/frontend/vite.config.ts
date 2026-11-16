import { defineConfig } from 'vite';

/**
 * `pnpm build` writes `dist/`, which the server serves at http://localhost:3201. `pnpm dev`
 * serves the page on port 5175 and sends `/chat`, `/mcp` and `/health` to that server.
 */
const SERVER = process.env.TODO_COPILOT_SERVER ?? 'http://127.0.0.1:3201';

export default defineConfig({
	resolve: { conditions: ['browser'] },
	server: {
		port: 5175,
		proxy: { '/chat': SERVER, '/mcp': SERVER, '/health': SERVER },
	},
	// As the FAST-AF page: most of the bundle is the MCP client SDK and Zod
	build: { target: 'es2022', chunkSizeWarningLimit: 750 },
});

import { defineConfig } from 'vite';

/** The page, served by `pnpm dev` on port 5173, an origin the TypeScript backend allows. */
export default defineConfig({
	resolve: { conditions: ['browser'] },
	server: { port: 5173 },
	// Most of the bundle is the MCP client SDK and Zod (about 500 kB of 600), which the
	// Streamable HTTP transport needs; the page imports only the violet elements it uses.
	build: { target: 'es2022', chunkSizeWarningLimit: 700 },
});

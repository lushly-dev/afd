/**
 * @fileoverview Standalone chat server for the AI copilot sidebar
 *
 * This runs alongside the MCP server on a different port to handle
 * chat requests with Gemini + DirectClient, and serves the frontend.
 *
 * Security defaults (see `http-security.ts`, all configurable in `.env`):
 * - Binds 127.0.0.1 only (`CHAT_HOST`)
 * - Browser requests only from this server's own localhost origins
 *   (`ALLOWED_ORIGINS`); `null` and `*` are refused
 * - `Host` header check against DNS rebinding (`ALLOWED_HOSTS`)
 * - Per-client rate limits on the socket address; `X-Forwarded-For` only
 *   with `TRUST_PROXY=true`
 * - Body size limit, and every command validated by `createDirectRegistry`
 *
 * Usage: npx tsx src/chat-server.ts, then open http://localhost:3201
 */

import 'dotenv/config';
import { DirectClient } from '@lushly-dev/afd-client';
import { getMetrics, isConfigured, processChat } from './chat.js';
import { createChatServer } from './chat-http.js';
import { type ChatServerConfig, loadChatServerConfig } from './http-security.js';
import { registry } from './registry.js';

// ═══════════════════════════════════════════════════════════════════════════════
// API KEY VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function validateApiKey(): void {
	const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

	if (!apiKey) {
		console.warn('⚠️  No GOOGLE_API_KEY or GEMINI_API_KEY found in environment');
		console.warn('   AI chat will be unavailable. Set the key in .env file.');
		return;
	}

	// Basic format validation (Gemini API keys are typically 39 chars)
	if (apiKey.length < 20) {
		console.error('❌ API key appears too short. Check your .env file.');
		process.exit(1);
	}

	// Mask API key in logs (show only last 4 chars)
	const masked = `***${apiKey.slice(-4)}`;
	console.log(`✅ API Key configured: ${masked}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

let config: ChatServerConfig;
try {
	config = loadChatServerConfig(process.env);
} catch (error) {
	console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

validateApiKey();

const { server } = createChatServer(config, {
	// The same validating registry the AI uses: the UI gets no extra powers.
	executor: new DirectClient(registry),
	chat: { processChat, isConfigured, getMetrics },
});

server.listen(config.port, config.host, () => {
	const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
	console.log(`\n🤖 AI Chat Server running at ${url}`);
	console.log(`   Open ${url}/ for the UI`);
	console.log(`   Gemini configured: ${isConfigured() ? '✅ Yes' : '❌ No (set GOOGLE_API_KEY)'}`);
	console.log(`\n   Security:`);
	console.log(`   • Bound to: ${config.host}`);
	console.log(`   • Allowed origins: ${config.allowedOrigins.join(', ')}`);
	console.log(`   • Allowed hosts: ${config.allowedHosts.join(', ')}`);
	console.log(`   • Trust X-Forwarded-For: ${config.trustProxy ? 'yes (TRUST_PROXY)' : 'no'}`);
	console.log(`   • Rate limit (chat): ${config.rateLimitChat}/min`);
	console.log(`   • Rate limit (execute): ${config.rateLimitExecute}/min`);
	console.log(`   • Max body size: ${config.maxBodySize} bytes`);
	console.log(`\n   Endpoints:`);
	console.log(`   GET  /        - Frontend`);
	console.log(`   POST /chat    - Send messages to Gemini + DirectClient`);
	console.log(`   POST /execute - Execute commands directly`);
	console.log(`   GET  /health  - Basic liveness check`);
	console.log(`   GET  /ready   - Comprehensive readiness check`);
	console.log(`   GET  /metrics - Request counts, latencies, error rates`);
	console.log(`\n   Press Ctrl+C to stop.\n`);
});

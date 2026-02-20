/**
 * @fileoverview Standalone chat server for the AI copilot sidebar
 *
 * This runs alongside the MCP server on a different port to handle
 * chat requests with Gemini 2.0 Flash + DirectClient.
 *
 * Security features:
 * - API key validation on startup
 * - CORS lockdown (configurable via ALLOWED_ORIGINS)
 * - Input validation and body size limits
 * - Per-IP rate limiting
 *
 * Usage: npx tsx src/chat-server.ts
 */

import 'dotenv/config';
import http from 'http';
import { processChat, isConfigured, getMetrics, type ChatResponse } from './chat.js';
import { DirectClient } from '@lushly-dev/afd-client';
import { registry } from './registry.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = parseInt(process.env.CHAT_PORT ?? '3201', 10);
const MAX_BODY_SIZE = parseInt(process.env.MAX_BODY_SIZE ?? '10240', 10); // 10KB default

// CORS configuration: comma-separated list of allowed origins, or '*' for dev
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((o) => o.trim());

// Rate limiting: requests per minute per IP
const RATE_LIMIT_CHAT = parseInt(process.env.RATE_LIMIT_CHAT ?? '30', 10);
const RATE_LIMIT_EXECUTE = parseInt(process.env.RATE_LIMIT_EXECUTE ?? '120', 10);
const RATE_WINDOW_MS = 60_000; // 1 minute

// Server start time for uptime tracking
const SERVER_START_TIME = Date.now();

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
	const masked = '***' + apiKey.slice(-4);
	console.log(`✅ API Key configured: ${masked}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const rateLimits: Map<string, RateLimitEntry> = new Map();

function getClientIP(req: http.IncomingMessage): string {
	// Check for forwarded IP (behind proxy)
	const forwarded = req.headers['x-forwarded-for'];
	if (forwarded) {
		const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
		return ips?.trim() ?? 'unknown';
	}
	return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string, limit: number): { allowed: boolean; retryAfter?: number } {
	const now = Date.now();
	const key = ip;

	let entry = rateLimits.get(key);

	// Clean up expired entries
	if (entry && entry.resetAt <= now) {
		rateLimits.delete(key);
		entry = undefined;
	}

	if (!entry) {
		rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
		return { allowed: true };
	}

	if (entry.count >= limit) {
		const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
		return { allowed: false, retryAfter };
	}

	entry.count++;
	return { allowed: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORS HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): boolean {
	const origin = req.headers.origin || '';

	// Check if origin is allowed
	const isAllowed =
		ALLOWED_ORIGINS.includes('*') ||
		ALLOWED_ORIGINS.includes(origin) ||
		// Allow file:// protocol for local development
		origin.startsWith('file://') ||
		// Allow null origin (same-origin or file://)
		origin === '' ||
		origin === 'null';

	if (!isAllowed) {
		res.writeHead(403, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Origin not allowed' }));
		return false;
	}

	// Set CORS headers
	res.setHeader('Access-Control-Allow-Origin', origin || '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

	return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function validateCommandName(name: unknown): name is string {
	if (typeof name !== 'string') return false;
	// Command names should be alphanumeric with hyphens, 1-50 chars
	return /^[a-zA-Z][a-zA-Z0-9-]{0,49}$/.test(name);
}

function sanitizeMessage(message: unknown): string | null {
	if (typeof message !== 'string') return null;
	// Trim and limit message length
	const sanitized = message.trim().slice(0, 2000);
	return sanitized.length > 0 ? sanitized : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST BODY PARSING
// ═══════════════════════════════════════════════════════════════════════════════

function parseBody(req: http.IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let body = '';
		let size = 0;

		req.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				reject(new Error('Request body too large'));
				return;
			}
			body += chunk.toString();
		});

		req.on('end', () => {
			try {
				resolve(JSON.parse(body));
			} catch {
				reject(new Error('Invalid JSON'));
			}
		});

		req.on('error', reject);
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SERVER
// ═══════════════════════════════════════════════════════════════════════════════

// DirectClient for /execute endpoint
const directClient = new DirectClient(registry);

const server = http.createServer(async (req, res) => {
	// CORS check
	if (!setCorsHeaders(req, res)) {
		return;
	}

	// Handle preflight
	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	const clientIP = getClientIP(req);

	// Health check - basic liveness (no rate limit)
	if (req.url === '/health') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				status: 'ok',
				geminiConfigured: isConfigured(),
				uptimeMs: Date.now() - SERVER_START_TIME,
			})
		);
		return;
	}

	// Ready check - comprehensive readiness (no rate limit)
	if (req.url === '/ready') {
		const isReady = isConfigured();
		res.writeHead(isReady ? 200 : 503, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				ready: isReady,
				checks: {
					gemini: isConfigured() ? 'ok' : 'missing_api_key',
					directClient: 'ok', // Always ready (in-process)
				},
			})
		);
		return;
	}

	// Metrics endpoint (no rate limit)
	if (req.url === '/metrics') {
		const metrics = getMetrics();
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				...metrics,
				uptimeMs: Date.now() - SERVER_START_TIME,
				rateLimitConfig: {
					chat: RATE_LIMIT_CHAT,
					execute: RATE_LIMIT_EXECUTE,
				},
			})
		);
		return;
	}

	// Execute command directly (for UI to use same registry as AI)
	if (req.method === 'POST' && req.url === '/execute') {
		// Rate limit check
		const rateCheck = checkRateLimit(`${clientIP}:execute`, RATE_LIMIT_EXECUTE);
		if (!rateCheck.allowed) {
			res.writeHead(429, {
				'Content-Type': 'application/json',
				'Retry-After': String(rateCheck.retryAfter),
			});
			res.end(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: rateCheck.retryAfter }));
			return;
		}

		try {
			const parsed = (await parseBody(req)) as { name?: unknown; args?: unknown };

			// Validate command name
			if (!validateCommandName(parsed.name)) {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Invalid command name' }));
				return;
			}

			// Validate args is an object (if provided)
			const args =
				parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
					? (parsed.args as Record<string, unknown>)
					: {};

			const start = performance.now();
			const result = await directClient.call(parsed.name, args);
			const latencyMs = performance.now() - start;

			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ...result, latencyMs }));
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			const status = message.includes('too large') || message.includes('Invalid JSON') ? 400 : 500;
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: message }));
		}
		return;
	}

	// Chat endpoint
	if (req.method === 'POST' && req.url === '/chat') {
		// Rate limit check (stricter for chat)
		const rateCheck = checkRateLimit(`${clientIP}:chat`, RATE_LIMIT_CHAT);
		if (!rateCheck.allowed) {
			res.writeHead(429, {
				'Content-Type': 'application/json',
				'Retry-After': String(rateCheck.retryAfter),
			});
			res.end(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: rateCheck.retryAfter }));
			return;
		}

		try {
			const parsed = (await parseBody(req)) as { message?: unknown };
			const message = sanitizeMessage(parsed.message);

			if (!message) {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Message required' }));
				return;
			}

			console.log(`\n📨 Chat [${clientIP}]: "${message.slice(0, 50)}${message.length > 50 ? '...' : ''}"`);
			const start = performance.now();

			const response = await processChat(message);

			const totalMs = performance.now() - start;
			console.log(`✅ Response in ${totalMs.toFixed(0)}ms`);
			console.log(`   Model: ${response.modelLatencyMs.toFixed(0)}ms`);
			console.log(`   Tools: ${response.totalToolLatencyMs.toFixed(3)}ms (${response.toolExecutions.length} calls)`);

			for (const exec of response.toolExecutions) {
				console.log(`     → ${exec.name}: ${exec.latencyMs.toFixed(3)}ms`);
			}

			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(response));
		} catch (error) {
			console.error('❌ Chat error:', error);
			const message = error instanceof Error ? error.message : 'Unknown error';
			const status = message.includes('too large') || message.includes('Invalid JSON') ? 400 : 500;
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: message }));
		}
		return;
	}

	// 404
	res.writeHead(404, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ error: 'Not found' }));
});

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

// Validate API key on startup
validateApiKey();

server.listen(PORT, () => {
	console.log(`\n🤖 AI Chat Server running at http://localhost:${PORT}`);
	console.log(`   Gemini configured: ${isConfigured() ? '✅ Yes' : '❌ No (set GOOGLE_API_KEY)'}`);
	console.log(`\n   Security:`);
	console.log(`   • CORS: ${ALLOWED_ORIGINS.includes('*') ? 'Open (dev mode)' : ALLOWED_ORIGINS.join(', ')}`);
	console.log(`   • Rate limit (chat): ${RATE_LIMIT_CHAT}/min`);
	console.log(`   • Rate limit (execute): ${RATE_LIMIT_EXECUTE}/min`);
	console.log(`   • Max body size: ${MAX_BODY_SIZE} bytes`);
	console.log(`\n   Endpoints:`);
	console.log(`   POST /chat    - Send messages to Gemini + DirectClient`);
	console.log(`   POST /execute - Execute commands directly`);
	console.log(`   GET  /health  - Basic liveness check`);
	console.log(`   GET  /ready   - Comprehensive readiness check`);
	console.log(`   GET  /metrics - Request counts, latencies, error rates`);
	console.log(`\n   Press Ctrl+C to stop.\n`);
});

/**
 * The skill catalog part of `afd validate --surface`, against a real AFD server with a catalog.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient, type McpClient } from '@lushly-dev/afd-client';
import { success } from '@lushly-dev/afd-core';
import { createMcpHandler, defineCommand, SkillCatalog } from '@lushly-dev/afd-server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkSkillCatalog } from './surface-skills.js';

const ping = defineCommand({
	name: 'ping-send',
	description: 'Send a ping and return pong',
	input: z.object({}),
	expose: { mcp: true },
	handler: async () => success({ pong: true }),
});

const running: Array<{ server: Server; dispose: () => void; client: McpClient }> = [];

afterEach(async () => {
	for (const { server, dispose, client } of running.splice(0)) {
		await client.disconnect();
		dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

async function connect(skills?: SkillCatalog): Promise<McpClient> {
	const handler = createMcpHandler({
		name: 'skills',
		version: '0.1.0',
		commands: [ping],
		...(skills ? { skills } : {}),
	});
	const server = createServer((req, res) => void handler(req, res));
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	const client = createClient({
		url: `http://127.0.0.1:${port}/mcp`,
		transport: 'streamable-http',
		autoReconnect: false,
	});
	await client.connect();
	running.push({ server, dispose: handler.dispose, client });
	return client;
}

function skillMd(name: string): string {
	return `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n# ${name}\n`;
}

describe('the skill catalog check', () => {
	it('warns about a file over Claude Code limit, naming the skill, the limit and Claude Code', async () => {
		const catalog = new SkillCatalog([
			{ path: 'small', files: { 'SKILL.md': skillMd('small') } },
			{
				path: 'acme/big-reference',
				files: {
					'SKILL.md': skillMd('big-reference'),
					'references/api.md': 'x'.repeat(150_000),
				},
			},
		]);
		const check = await checkSkillCatalog(await connect(catalog));

		expect(check.skillCount).toBe(2);
		expect(check.warning).toBeUndefined();
		expect(check.findings).toEqual([
			expect.objectContaining({
				rule: 'claude-code-file-size',
				severity: 'warning',
				skill: 'big-reference',
				file: 'references/api.md',
				source: 'Claude Code',
				suppressed: false,
				evidence: { file: 'references/api.md', size: 150_000, limit: 100_000 },
			}),
		]);
		expect(check.findings[0]?.message).toContain(
			"Claude Code's limit of 100 KB a text file for a skill it scans"
		);
	});

	it('marks findings --suppress names, by rule or rule:skill', async () => {
		const catalog = new SkillCatalog([
			{
				path: 'big-reference',
				files: { 'SKILL.md': skillMd('big-reference'), 'a.md': 'x'.repeat(150_000) },
			},
		]);
		const client = await connect(catalog);
		for (const suppression of ['claude-code-file-size', 'claude-code-file-size:big-reference']) {
			const check = await checkSkillCatalog(client, [suppression]);
			expect(check.findings.map((finding) => finding.suppressed)).toEqual([true]);
		}
		const other = await checkSkillCatalog(client, ['claude-code-file-size:other']);
		expect(other.findings.map((finding) => finding.suppressed)).toEqual([false]);
	});

	it('reports nothing for a server with no catalog', async () => {
		expect(await checkSkillCatalog(await connect())).toEqual({ findings: [] });
	});

	it('says so when skills/list fails or has no skills array', async () => {
		const failing = await checkSkillCatalog({
			request: async () => {
				throw new Error('socket hang up');
			},
		});
		expect(failing).toEqual({
			findings: [],
			warning: 'Could not read the skill catalog (skills/list): socket hang up',
		});
		const empty = await checkSkillCatalog({ request: async <T>() => ({}) as T });
		expect(empty.warning).toContain('no skills array');

		const notRouted = async () => {
			throw Object.assign(new Error('Method not found: skills/list'), { code: -32601 });
		};
		const declared = await checkSkillCatalog({
			request: notRouted,
			getStatus: () => ({ capabilities: { extensions: { 'io.modelcontextprotocol/skills': {} } } }),
		});
		expect(declared.warning).toContain('does not serve skills/list');
		expect(await checkSkillCatalog({ request: notRouted })).toEqual({ findings: [] });
		const absent = await checkSkillCatalog({
			request: notRouted,
			getStatus: () => ({ capabilities: { tools: {} } }),
		});
		expect(absent).toEqual({ findings: [] });
	});

	it('follows nextCursor and counts every skill toward the 100, dynamic or malformed', async () => {
		const entry = (name: string) => ({
			uri: `skill://${name}/SKILL.md`,
			frontmatter: { name },
			resources: [{ uri: `skill://${name}/SKILL.md`, size: 10 }],
		});
		const pages: Record<string, { skills: unknown[]; nextCursor?: string }> = {
			first: { skills: Array.from({ length: 99 }, (_, i) => entry(`s-${i}`)), nextCursor: 'p2' },
			p2: {
				skills: [
					{ uri: 'skill://live/SKILL.md', frontmatter: { name: 'live' }, resources: 'dynamic' },
					{
						uri: 'skill://odd/SKILL.md',
						frontmatter: { name: 'odd' },
						resources: [null, { uri: 'skill://odd/big.md', size: 200_000 }],
					},
				],
			},
		};
		const calls: unknown[] = [];
		const check = await checkSkillCatalog({
			request: async <T>(_method: string, params?: Record<string, unknown>) => {
				calls.push(params);
				return pages[(params?.cursor as string | undefined) ?? 'first'] as T;
			},
		});
		expect(calls).toEqual([{}, { cursor: 'p2' }]);
		expect(check.skillCount).toBe(101);
		expect(check.findings.map(({ rule, skill }) => [rule, skill])).toEqual([
			['claude-code-file-size', 'odd'],
			['claude-code-skill-count', 'odd'],
		]);
		expect(check.warning).toContain('1 skills/list entries or manifest files have no uri');
	});

	it('gives up on a cursor that repeats', async () => {
		const check = await checkSkillCatalog({
			request: async <T>() => ({ skills: [], nextCursor: 'again' }) as T,
		});
		expect(check).toEqual({
			findings: [],
			warning: expect.stringContaining('did not end within'),
		});
	});
});

import { PostgresDatabase } from '@lushly-dev/violet-core';
import { initializeExport } from '@lushly-dev/violet-core/engine';
import { NeonPostgresClient } from '@lushly-dev/violet-core/neon';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeDeviationsCommand } from '../commands/analyze/deviations.js';
import { exportCommand } from '../commands/export/export.js';
import { nodeCreateCommand } from '../commands/node/create.js';
import type { CommandContext } from '../commands/registry.js';
import { tokenAddCommand } from '../commands/token/add.js';
import { tokenOverrideCommand } from '../commands/token/override.js';
import { tokensResolveCommand } from '../commands/token/resolve.js';

const connectionString = process.env.VIOLET_NEON_DATABASE_URL;
const describeIfNeon = connectionString ? describe : describe.skip;

describeIfNeon('Neon storage smoke', () => {
	let client: NeonPostgresClient;
	let db: PostgresDatabase;
	let context: CommandContext;
	let rootId: string;
	let childId: string;

	beforeAll(async () => {
		client = new NeonPostgresClient(connectionString as string);
		db = new PostgresDatabase(client);
		context = { db, actor: 'neon-smoke', traceId: 'neon-smoke' };

		initializeExport();
		await db.initSchema();

		const suffix = nanoid(8).toLowerCase();
		rootId = `neon-root-${suffix}`;
		childId = `neon-child-${suffix}`;
	});

	afterAll(async () => {
		await client.close();
	});

	it('runs core node/token/export/analyze flows against Neon', async () => {
		const rootResult = await nodeCreateCommand.handler(
			{
				id: rootId,
				name: rootId,
				type: 'root',
				parentId: null,
			},
			context,
		);

		expect(rootResult.success).toBe(true);

		const childResult = await nodeCreateCommand.handler(
			{
				id: childId,
				name: childId,
				type: 'product',
				parentId: rootId,
			},
			context,
		);

		expect(childResult.success).toBe(true);

		const addResult = await tokenAddCommand.handler(
			{
				nodeId: rootId,
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);

		expect(addResult.success).toBe(true);

		const overrideResult = await tokenOverrideCommand.handler(
			{
				nodeId: childId,
				tokenId: 'color.primary',
				value: '#107C10',
			},
			context,
		);

		expect(overrideResult.success).toBe(true);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: childId }, context);

		expect(resolveResult.success).toBe(true);
		expect(resolveResult.data?.tokens).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'color.primary',
					value: '#107C10',
					resolvedAt: childId,
				}),
			]),
		);

		const exportResult = await exportCommand.handler({ nodeId: childId, format: 'json' }, context);

		expect(exportResult.success).toBe(true);
		expect(exportResult.data?.tokenCount).toBe(1);
		expect(JSON.parse(exportResult.data?.content || '{}')).toEqual({
			color: {
				primary: {
					value: '#107C10',
				},
			},
		});

		const analyzeResult = await analyzeDeviationsCommand.handler(
			{ nodeId: childId, fromAncestor: rootId },
			context,
		);

		expect(analyzeResult.success).toBe(true);
		expect(analyzeResult.data?.totalDeviations).toBe(1);
		expect(analyzeResult.data?.deviations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					tokenId: 'color.primary',
					operation: 'override',
					deviatedAt: childId,
				}),
			]),
		);
	});
});

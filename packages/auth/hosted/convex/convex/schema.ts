import { authTables } from '@convex-dev/auth/server';
import { type DataModelFromSchemaDefinition, defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const schema = defineSchema({
	...authTables,
	harnessRecords: defineTable({
		ownerId: v.id('users'),
		runId: v.string(),
		value: v.string(),
	}).index('owner_run', ['ownerId', 'runId']),
	cleanupReceipts: defineTable({
		runId: v.string(),
		proof: v.string(),
		records: v.number(),
		sessions: v.number(),
		accounts: v.number(),
		verified: v.boolean(),
	}).index('run_proof', ['runId', 'proof']),
});

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export default schema;

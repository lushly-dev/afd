/**
 * @fileoverview The `probe` document type, the fixture the kernel's document tests use, so the kernel
 * names no real type (documents specification, 1 and step 9). A native plugin with two types: `probe`, at
 * either level, with an export and an import command, and `probe-memo`, project-only, with neither. Its
 * `probe-reach` calls a shell command through its own nested client, for the port's rows (4.2 and 11).
 * Exported from `@lushly-dev/loam-kernel/testing`.
 */

import type { ManifestV2, ProjectionV3 } from '@lushly-dev/loam-manifest';
import {
	type AppCallContextV1,
	defineApp,
	documentContentKey,
	failure,
	success,
} from '@lushly-dev/loam-sdk';
import { scopedDeployment, scopedPackages } from './scope/fixtures.js';
import { createFixturePorts } from './testing-probe.js';

const documentOnly = {
	type: 'object',
	properties: { document: { type: 'string' } },
	required: ['document'],
	additionalProperties: false,
};
const BINDING = {
	model: 'command',
	selection: 'text-range',
	locator: 'text-range',
	conflict: 'last-writer-wins',
} as const;

const command = (name: string, effects: string[], input: object) => ({
	name,
	title: name,
	description: `The probe type's ${name}.`,
	effects,
	input_schema: input,
});

/** The fixture's manifest: version 2, with `store`, `clock` and `documents`. */
export const PROBE_DOCUMENTS_MANIFEST: ManifestV2 = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'probe',
		title: 'Probe',
		version: '1.0.0',
		description: 'A document type fixture for the kernel tests.',
		kind: 'native',
		domains: ['probe'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	grants: [
		{ name: 'store', reason: "Keeps each document's content." },
		{ name: 'clock', reason: 'Stamps its writes.' },
		{ name: 'documents', reason: 'Lists the documents of its scope.' },
	],
	commands: [
		command('probe-content-get', ['inspect'], documentOnly),
		command('probe-content-set', ['store-write'], {
			type: 'object',
			properties: { document: { type: 'string' }, text: { type: 'string' } },
			required: ['document', 'text'],
			additionalProperties: false,
		}),
		command('probe-content-refuse', ['store-write'], {
			type: 'object',
			properties: { document: { type: 'string' }, text: { type: 'string' } },
			required: ['document', 'text'],
			additionalProperties: false,
		}),
		command('probe-content-swap', ['store-write'], {
			type: 'object',
			properties: { document: { type: 'string' }, other: { type: 'string' } },
			required: ['document', 'other'],
			additionalProperties: false,
		}),
		command('probe-export', ['inspect'], documentOnly),
		command('probe-import', ['store-write'], {
			type: 'object',
			properties: { document: { type: 'string' }, content: {} },
			required: ['document', 'content'],
			additionalProperties: false,
		}),
		command('probe-memo-get', ['inspect'], documentOnly),
		command('probe-reach', ['inspect'], {
			type: 'object',
			properties: { command: { type: 'string' }, input: { type: 'object' } },
			required: ['command'],
			additionalProperties: false,
		}),
	],
	ui: {
		surfaces: { main: { element: 'probe-main' } },
		documents: [
			{
				id: 'probe',
				title: 'Probe note',
				icon: 'system/document',
				content_schema: {
					type: 'object',
					properties: { text: { type: 'string' } },
					required: ['text'],
					additionalProperties: false,
				},
				content_version: 2,
				autosave_ms: 2000,
				instance_commands: [
					'probe-content-get',
					'probe-content-set',
					'probe-content-refuse',
					'probe-content-swap',
					'probe-export',
					'probe-import',
				],
				export_command: 'probe-export',
				import_command: 'probe-import',
				editor: { element: 'probe-editor' },
				inspector: { element: 'probe-inspector' },
				binding: BINDING,
				templates: [
					{ id: 'blank', title: 'Blank probe', content: { text: '' } },
					{ id: 'greeting', title: 'Greeting', content: { text: 'Hello' } },
				],
			},
			{
				id: 'probe-memo',
				title: 'Memo',
				icon: 'system/document',
				content_schema: { type: 'object' },
				content_version: 1,
				scope_levels: ['project'],
				instance_commands: ['probe-memo-get'],
				editor: { element: 'probe-memo-editor' },
				binding: { ...BINDING, selection: 'none', locator: 'none' },
				templates: [{ id: 'blank', title: 'Blank memo', content: {} }],
			},
		],
	},
} as unknown as ManifestV2;

/** The fixture's handlers. Each reads and writes only its own store, under the call's scope. */
export const PROBE_DOCUMENTS_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		'probe-content-get': (async (input: { document: string }, context: AppCallContextV1) =>
			success({
				content: (await context.store?.get(documentContentKey(input.document))) ?? null,
			})) as never,
		'probe-content-set': (async (
			input: { document: string; text: string },
			context: AppCallContextV1
		) => {
			await context.store?.put(documentContentKey(input.document), { text: input.text });
			return success({ document: input.document });
		}) as never,
		// Writes, then answers the kernel's own size code: an app's refusal, which the journal keeps whole.
		'probe-content-refuse': (async (
			input: { document: string; text: string },
			context: AppCallContextV1
		) => {
			await context.store?.put(documentContentKey(input.document), { text: input.text });
			return failure({
				code: 'DOCUMENT_CONTENT_TOO_LARGE',
				message: 'The app says this is too large',
				suggestion: 'It is the app speaking, not the kernel',
			});
		}) as never,
		// Changes its own input to name another document, which the kernel's stamp must not follow.
		'probe-content-swap': (async (input: { document: string; other: string }) => {
			input.document = input.other;
			return success({ swapped: true });
		}) as never,
		'probe-export': (async (input: { document: string }, context: AppCallContextV1) =>
			success({
				content: (await context.store?.get(documentContentKey(input.document))) ?? null,
			})) as never,
		'probe-import': (async (
			input: { document: string; content: unknown },
			context: AppCallContextV1
		) => {
			await context.store?.put(documentContentKey(input.document), input.content);
			return success({ document: input.document });
		}) as never,
		'probe-memo-get': (async (input: { document: string }, context: AppCallContextV1) =>
			success({
				content: (await context.store?.get(documentContentKey(input.document))) ?? null,
			})) as never,
		// A shell command through the handler's own nested client: the answer an app gets, whole.
		'probe-reach': (async (
			input: { command: string; input?: unknown },
			context: AppCallContextV1
		) => success({ answer: await context.client.call(input.command, input.input ?? {}) })) as never,
	},
});

/** The scoped workspace's deployment, with `probe` after its three apps. */
export const documentsDeployment = (): ProjectionV3 => {
	const scoped = scopedDeployment();
	return {
		...scoped,
		generation: 'documents',
		apps: [...scoped.apps, { instance: 'probe', app: 'probe', package: 'fixtures/probe/' }],
	};
};

/** The scoped workspace's packages, with `probe`'s. */
export const documentsPorts = () =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/probe/': {
			manifest: PROBE_DOCUMENTS_MANIFEST,
			definition: PROBE_DOCUMENTS_DEFINITION,
		},
	});

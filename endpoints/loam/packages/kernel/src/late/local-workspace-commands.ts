import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import { isHumanGesture } from '../settings/setting-rules.js';
import type { LocalWorkspaceBackup } from '../types.js';
import { DOCUMENT_KIT as kit } from './command-kit.js';

export function createLocalWorkspaceCommands(backup: LocalWorkspaceBackup): ZodCommandDefinition[] {
	const describe = {
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		expose: { agent: false },
		mutation: false,
		category: 'workspace',
	};
	return [
		kit.define<typeof emptyInput, { status: Awaited<LocalWorkspaceBackup['persistence']> }>({
			...describe,
			name: 'storage-persistence-get',
			description: 'Report whether the local host granted persistent storage',
			async handler(_input, context) {
				if (!isHumanGesture(context))
					return kit.kernelFailure(
						'HUMAN_REQUIRED',
						'Only a person can read local storage status',
						'Read it in Loam Settings'
					);
				return kit.success({ status: await backup.persistence });
			},
		}),
		kit.define<typeof emptyInput, Awaited<ReturnType<LocalWorkspaceBackup['export']>>>({
			...describe,
			name: 'workspace-export',
			title: 'Export local workspace',
			description: 'Download all documents, settings and app records in one workspace backup',
			async handler(_input, context) {
				if (!isHumanGesture(context))
					return kit.kernelFailure(
						'HUMAN_REQUIRED',
						'Only a person can export a local backup',
						'Run it in the Loam shell'
					);
				try {
					return kit.success(await backup.export());
				} catch {
					return kit.kernelFailure(
						'WORKSPACE_EXPORT_FAILED',
						'The local workspace backup could not be written',
						'Check that this host can download files, then try the export again',
						{ retryable: true }
					);
				}
			},
		}),
	] as unknown as ZodCommandDefinition[];
}

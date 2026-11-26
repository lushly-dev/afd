import type { LocalWorkspaceBackup } from '@lushly-dev/loam-kernel';
import type { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';

type Persistence = 'persistent' | 'best-effort' | 'unavailable';

export interface LocalWorkspacePorts {
	storage?: Pick<StorageManager, 'persist'>;
	saveFile?(name: string, contents: string): void | Promise<void>;
}

async function requestPersistence(storage: LocalWorkspacePorts['storage']): Promise<Persistence> {
	try {
		if (!storage?.persist) return 'unavailable';
		return (await storage.persist()) ? 'persistent' : 'best-effort';
	} catch {
		return 'unavailable';
	}
}

function downloadFile(filename: string, contents: string): void {
	const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	try {
		link.click();
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}
}

export function localWorkspaceBackup(
	store: IndexedDbAdapter,
	ports: LocalWorkspacePorts = {}
): LocalWorkspaceBackup {
	return {
		persistence: requestPersistence(ports.storage ?? globalThis.navigator?.storage),
		async export() {
			const filename = 'loam-workspace.json';
			const records = await store.snapshot();
			const contents = JSON.stringify({ format: 'loam-workspace', version: 1, records });
			await (ports.saveFile ?? downloadFile)(filename, contents);
			return { filename, records: records.length };
		},
	};
}

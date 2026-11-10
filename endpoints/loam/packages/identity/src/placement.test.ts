/**
 * P3-E13: placement and inputs (phase 3 specification, 1, 11 and 18). Nothing a browser loads imports this
 * package, and no command takes a secret in its input but `auth-sign-in`'s password, which the journal
 * redacts. In this package, since the dependency runs one way, `identity` to `kernel` (1).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
} from '@lushly-dev/loam-kernel/testing';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
/** What a browser loads: the web host, the chrome and the kernel. */
const BROWSER_SOURCES = ['web/src', 'chrome/src', 'kernel/src'];

function filesUnder(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? filesUnder(path) : /\.(ts|js|mjs)$/.test(entry.name) ? [path] : [];
	});
}

/** Every property name a JSON Schema holds, at any depth. */
function propertyNames(schema: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(schema)) for (const item of schema) propertyNames(item, into);
	else if (typeof schema === 'object' && schema !== null) {
		const { properties } = schema as { properties?: Record<string, unknown> };
		for (const name of Object.keys(properties ?? {})) into.add(name);
		for (const value of Object.values(schema)) propertyNames(value, into);
	}
	return into;
}

/** Input properties no command may take (11): a secret never passes through a command. */
const SECRET_NAMES = ['token', 'password', 'secret', 'code', 'cookie'];

describe('P3-E13: placement and inputs', () => {
	it('is imported by nothing a browser loads', () => {
		const files = BROWSER_SOURCES.flatMap((directory) => filesUnder(join(PACKAGES, directory)));
		expect(files.length).toBeGreaterThan(100);
		const importing = files.filter((file) =>
			readFileSync(file, 'utf8').includes('@lushly-dev/loam-identity')
		);
		expect(importing).toEqual([]);
	});

	it("takes no secret in any command's input but `auth-sign-in`'s password", async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
			empty: true,
		});
		try {
			const commands = workspace.registries.palette.listCommands();
			expect(commands.length).toBeGreaterThan(80);
			const found = commands.flatMap((command) => {
				const schema =
					(command as { jsonSchema?: unknown }).jsonSchema ??
					(command as { inputSchema?: unknown }).inputSchema;
				return [...propertyNames(schema)]
					.filter((name) => SECRET_NAMES.includes(name.toLowerCase()))
					.map((name) => `${command.name}.${name}`);
			});
			expect(found).toEqual(['auth-sign-in.password']);
		} finally {
			await workspace.kernel.dispose();
		}
	});
});

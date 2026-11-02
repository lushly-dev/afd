import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CliIO, runCli } from './cli.js';
import { temporaryDirectory } from './test-support.js';

async function loam(...args: string[]) {
	let text = '';
	const io: CliIO = {
		stdout(chunk) {
			text += chunk;
		},
	};
	const code = await runCli(args, io);
	return { code, result: JSON.parse(text) };
}

describe('the loam bin', () => {
	it('scaffolds, checks and packs an app, exiting 0 with JSON', async () => {
		const dir = join(await temporaryDirectory(), 'demo');
		const made = await loam('app', 'new', 'demo', '--kind', 'native', '--dir', dir);
		expect(made.code).toBe(0);
		expect(made.result.success).toBe(true);
		expect(made.result.data.trust.code).toBe('TRUSTED_NOT_SANDBOXED');

		const checked = await loam('app', 'check', dir);
		expect(checked.code).toBe(0);
		expect(checked.result.data.exposure['demo-ping'].palette).toBe(true);

		await mkdir(join(dir, 'dist'));
		await writeFile(join(dir, 'dist/native.js'), 'export default {};\n');
		const packed = await loam('app', 'pack', dir, '--out', join(dir, 'dist/package'));
		expect(packed.code).toBe(0);
		expect(packed.result.data.files).toContain('app-manifest.json');
	});

	it('prints D55 for a mounted manifest', async () => {
		const dir = join(await temporaryDirectory(), 'demo');
		const { result } = await loam('app', 'new', 'demo', '--kind', 'mounted', '--dir', dir);
		const codes = result.data.trust.notices.map(({ code }: { code: string }) => code);
		expect(codes).toContain('TEAM_INSTANCE_SINGLE_PRINCIPAL');
		expect(codes).toContain('MOUNT_ANNOTATIONS_UNTRUSTED');
	});

	describe('each refusal path exits 1 with JSON', () => {
		it('a refused id', async () => {
			const dir = join(await temporaryDirectory(), 'demo');
			const { code, result } = await loam('app', 'new', 'layout', '--kind', 'native', '--dir', dir);
			expect(code).toBe(1);
			expect(result.error.code).toBe('MANIFEST_ID_RESERVED');
			expect(result.error.suggestion).toBeTruthy();
		});

		it('a refused check, with every refusal and the trust line in the details', async () => {
			const dir = await temporaryDirectory();
			await writeFile(
				join(dir, 'loam-app.toml'),
				'manifest_version = 1\nprotocol = 1\n\n[plugin]\nkind = "native"\nid = "demo"\nnope = 1\n'
			);
			const { code, result } = await loam('app', 'check', dir);
			expect(code).toBe(1);
			expect(result.error.details.refusals.length).toBeGreaterThan(1);
			expect(result.error.message).toMatch(/refusals/);
			expect(result.error.details.trust.code).toBe('TRUSTED_NOT_SANDBOXED');
		});

		it('a refused pack', async () => {
			const dir = await temporaryDirectory();
			const { code, result } = await loam('app', 'pack', dir, '--out', join(dir, 'out'));
			expect(code).toBe(1);
			expect(result.error.code).toBe('APP_MANIFEST_MISSING');
		});

		it('a refused deployment', async () => {
			const dir = await temporaryDirectory();
			const file = join(dir, 'gone.toml');
			const checked = await loam('deployment', 'check', file);
			expect(checked.code).toBe(1);
			expect(checked.result.error.code).toBe('DEPLOYMENT_INVALID');
			const written = await loam(
				'deployment',
				'write',
				'--config',
				file,
				'--dist',
				dir,
				'--out',
				join(dir, 'out')
			);
			expect(written.code).toBe(1);
			expect(written.result.error.code).toBe('DEPLOYMENT_INVALID');
		});

		it.each([
			[['nope'], /Unknown command: nope/],
			[[], /Unknown command/],
			[['app', 'new', 'demo'], /kind/],
			[['app', 'new', 'demo', '--kind', 'compiled'], /kind/],
			[['app', 'new', 'demo', 'extra', '--kind', 'native'], /Unexpected argument: extra/],
			[['app', 'check', '--nope', 'x'], /nope/],
			[['app', 'pack'], /out/],
			[['deployment', 'write', '--config', 'a'], /dist/],
		])('bad usage: %j', async (args, message) => {
			const { code, result } = await loam(...args);
			expect(code).toBe(1);
			expect(result.error.code).toBe('CLI_USAGE');
			expect(result.error.message).toMatch(message);
			expect(result.error.suggestion).toMatch(/loam /);
		});
	});

	it('turns anything thrown into a failure', async () => {
		const dir = await temporaryDirectory();
		await writeFile(join(dir, 'file'), '');
		const { code, result } = await loam('app', 'check', join(dir, 'file'));
		expect(code).toBe(1);
		expect(result.error.code).toBe('CLI_FAILED');
		expect(result.error.suggestion).toBeTruthy();
	});

	it('writes to standard output by default', async () => {
		const written: string[] = [];
		const original = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string) => {
			written.push(chunk);
			return true;
		}) as typeof process.stdout.write;
		try {
			expect(await runCli(['nope'])).toBe(1);
		} finally {
			process.stdout.write = original;
		}
		expect(JSON.parse(written.join('')).error.code).toBe('CLI_USAGE');
	});
});

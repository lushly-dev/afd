import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageManagerConnector } from './package-manager.js';

// Mock the exec function from platform.ts
vi.mock('../platform.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../platform.js')>()),
	exec: vi.fn(),
	isExecError: vi.fn((result) => result.errorCode !== undefined),
}));

import { ExecErrorCode, exec } from '../platform.js';

const mockExec = vi.mocked(exec);

describe('PackageManagerConnector', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('defaults to npm package manager', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector();
			await pm.install();

			expect(mockExec).toHaveBeenCalledWith(['npm', 'install'], {});
		});

		it('accepts pnpm as package manager', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('pnpm');
			await pm.install();

			expect(mockExec).toHaveBeenCalledWith(['pnpm', 'install'], {});
		});

		it('accepts options', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('npm', { debug: true, cwd: '/project' });
			await pm.install();

			expect(mockExec).toHaveBeenCalledWith(['npm', 'install'], { debug: true, cwd: '/project' });
		});
	});

	describe('install', () => {
		it('builds command for installing all dependencies', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('npm');
			await pm.install();

			expect(mockExec).toHaveBeenCalledWith(['npm', 'install'], {});
		});

		it('builds command for installing specific package', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('npm');
			await pm.install('lodash');

			expect(mockExec).toHaveBeenCalledWith(['npm', 'install', 'lodash'], {});
		});

		it('builds command for dev dependency', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('npm');
			await pm.install('vitest', true);

			expect(mockExec).toHaveBeenCalledWith(['npm', 'install', 'vitest', '--save-dev'], {});
		});

		it('works with pnpm', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('pnpm');
			await pm.install('lodash', true);

			expect(mockExec).toHaveBeenCalledWith(['pnpm', 'install', 'lodash', '--save-dev'], {});
		});
	});

	describe('run', () => {
		it('builds command for running scripts', async () => {
			mockExec.mockResolvedValue({
				stdout: 'Build complete',
				stderr: '',
				exitCode: 0,
				durationMs: 1000,
			});

			const pm = new PackageManagerConnector('npm');
			const result = await pm.run('build');

			expect(mockExec).toHaveBeenCalledWith(['npm', 'run', 'build'], {});
			expect(result.stdout).toBe('Build complete');
		});

		it('works with pnpm', async () => {
			mockExec.mockResolvedValue({
				stdout: 'Tests passed',
				stderr: '',
				exitCode: 0,
				durationMs: 500,
			});

			const pm = new PackageManagerConnector('pnpm');
			await pm.run('test');

			expect(mockExec).toHaveBeenCalledWith(['pnpm', 'run', 'test'], {});
		});

		it('includes debug and cwd options', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('npm', { debug: true, cwd: '/my/project' });
			await pm.run('lint');

			expect(mockExec).toHaveBeenCalledWith(['npm', 'run', 'lint'], {
				debug: true,
				cwd: '/my/project',
			});
		});
	});

	describe('add', () => {
		it('builds command for adding a package', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('npm');
			await pm.add('react');

			expect(mockExec).toHaveBeenCalledWith(['npm', 'add', 'react'], {});
		});

		it('adds dev dependency flag when requested', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('pnpm');
			await pm.add('typescript', true);

			expect(mockExec).toHaveBeenCalledWith(['pnpm', 'add', 'typescript', '--save-dev'], {});
		});
	});

	describe('remove', () => {
		it('builds command for removing a package', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('npm');
			await pm.remove('lodash');

			expect(mockExec).toHaveBeenCalledWith(['npm', 'remove', 'lodash'], {});
		});

		it('works with pnpm', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const pm = new PackageManagerConnector('pnpm');
			await pm.remove('moment');

			expect(mockExec).toHaveBeenCalledWith(['pnpm', 'remove', 'moment'], {});
		});
	});

	describe('input validation', () => {
		beforeEach(() => {
			mockExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
		});

		it.each([
			'lodash',
			'@types/node',
			'@lushly-dev/afd-core',
			'lodash.merge',
			'JSONStream',
			'lodash@4.17.21',
			'lodash@latest',
			'typescript@~5.9.3',
			'react@^18.2.0',
			'react@>=18 <19',
			'@scope/pkg@1.x || 2.x',
			'a'.repeat(214),
		])('accepts package spec %j', async (pkg) => {
			const pm = new PackageManagerConnector('pnpm');

			await pm.add(pkg);

			expect(mockExec).toHaveBeenCalledWith(['pnpm', 'add', pkg], {});
		});

		it.each([
			'-g',
			'--registry=https://evil.example',
			'.hidden',
			'_private',
			'@scope/',
			'@/name',
			'x & calc',
			'lodash|calc',
			'lodash"',
			'foo\nbar',
			'../local-dir',
			// portability-ok: Windows path fixture for spawn-escaping tests
			'C:\\pkgs\\evil.tgz',
			'git+ssh://host/repo.git',
			'https://example.com/pkg.tgz',
			'alias@npm:lodash@4',
			'pkg@workspace:*',
			'a'.repeat(215),
		])('rejects package spec %j without running anything', async (pkg) => {
			const pm = new PackageManagerConnector('npm');

			for (const result of [await pm.install(pkg), await pm.add(pkg), await pm.remove(pkg)]) {
				expect(result.errorCode).toBe(ExecErrorCode.SPAWN_FAILED);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain('Invalid package name');
				expect(pm.isSuccess(result)).toBe(false);
			}
			expect(mockExec).not.toHaveBeenCalled();
		});

		it('rejects an empty package name for add and remove', async () => {
			const pm = new PackageManagerConnector('npm');

			expect((await pm.add('')).errorCode).toBe(ExecErrorCode.SPAWN_FAILED);
			expect((await pm.remove('')).errorCode).toBe(ExecErrorCode.SPAWN_FAILED);
			expect(mockExec).not.toHaveBeenCalled();
		});

		it.each(['build', 'test:unit', 'lint-fix', 'dev:py', 'build.esm', '_internal', 'test/e2e'])(
			'accepts script name %j',
			async (script) => {
				const pm = new PackageManagerConnector('npm');

				await pm.run(script);

				expect(mockExec).toHaveBeenCalledWith(['npm', 'run', script], {});
			}
		);

		it.each([
			'',
			'-s',
			'--if-present',
			'build && calc',
			'build calc',
			'a"b',
			'a\nb',
			':x',
			'x'.repeat(129),
		])('rejects script name %j without running anything', async (script) => {
			const pm = new PackageManagerConnector('npm');

			const result = await pm.run(script);

			expect(result.errorCode).toBe(ExecErrorCode.SPAWN_FAILED);
			expect(result.stderr).toContain('Invalid script name');
			expect(mockExec).not.toHaveBeenCalled();
		});
	});

	describe('isSuccess', () => {
		it('returns true for successful results', () => {
			const pm = new PackageManagerConnector();
			const result = {
				stdout: '',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			};

			expect(pm.isSuccess(result)).toBe(true);
		});

		it('returns false for error results', () => {
			const pm = new PackageManagerConnector();
			const result = {
				stdout: '',
				stderr: 'Error',
				exitCode: 1,
				durationMs: 100,
				errorCode: ExecErrorCode.EXIT_CODE,
			};

			expect(pm.isSuccess(result)).toBe(false);
		});
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageManagerConnector } from './package-manager.js';

// Mock the exec function from platform.ts
vi.mock('../platform.js', () => ({
	exec: vi.fn(),
	isExecError: vi.fn((result) => result.errorCode !== undefined),
}));

import { exec } from '../platform.js';

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
				errorCode: 'EXIT_CODE' as const,
			};

			expect(pm.isSuccess(result)).toBe(false);
		});
	});
});

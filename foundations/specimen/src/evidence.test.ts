import { afterEach, describe, expect, it, vi } from 'vitest';
import { claim } from './evidence.js';

const target = {} as Element;
const global = globalThis as { __specimenClaim?: unknown };

describe('claim()', () => {
	afterEach(() => {
		delete global.__specimenClaim;
	});

	it('does nothing without a check outside Specimen', () => {
		expect(claim(target, 'property:disabled=true', 'disabled')).toBeUndefined();
	});

	it('still runs a check when no Specimen hook is present, and rethrows its failure', async () => {
		const check = vi.fn();
		await claim(target, 'guide:button.name', 'named', check);
		expect(check).toHaveBeenCalledOnce();
		await expect(
			claim(target, 'guide:button.name', 'named', () => {
				throw new Error('It has no name.');
			})
		).rejects.toThrow('It has no name.');
	});

	it('records a guide claim only after its check holds, and says whether it had one', async () => {
		const hook = vi.fn();
		global.__specimenClaim = hook;
		let release = () => {};
		const pending = claim(
			target,
			'guide:button.name',
			'named',
			() => new Promise<void>((resolve) => (release = resolve))
		);
		await Promise.resolve();
		expect(hook).not.toHaveBeenCalled();
		release();
		await pending;
		expect(hook).toHaveBeenLastCalledWith(target, 'guide:button.name', 'named', true);
		claim(target, 'guide:button.name', 'said');
		expect(hook).toHaveBeenLastCalledWith(target, 'guide:button.name', 'said', false);
		// A partition claim keeps the call it always had.
		claim(target, 'property:disabled=true', 'disabled');
		expect(hook).toHaveBeenLastCalledWith(target, 'property:disabled=true', 'disabled');
	});

	it('records nothing when the check fails', async () => {
		const hook = vi.fn();
		global.__specimenClaim = hook;
		await expect(
			claim(target, 'guide:button.name', 'named', async () => {
				throw new Error('No.');
			})
		).rejects.toThrow('No.');
		expect(hook).not.toHaveBeenCalled();
	});
});

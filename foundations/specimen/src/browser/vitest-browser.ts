/**
 * What a retained story gets for `vitest/browser`. A play reaches for it to drive the real
 * keyboard, with trusted events and the browser's own focus navigation, so this offers
 * `userEvent.keyboard` through the host. On a page without the host's input binding, such as a
 * static preview, `userEvent` is undefined, as a play finds it outside Vitest's runner.
 */

interface PendingInput {
	resolve(): void;
	reject(error: Error): void;
}

const host = globalThis as typeof globalThis & {
	__specimenInput?: (payload: string) => void;
	__specimenInputDone?: (id: number, error: string | null) => void;
};

const pending = new Map<number, PendingInput>();
let nextId = 0;

function keyboard(keys: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		host.__specimenInput?.(JSON.stringify({ id, keys }));
	});
}

function createUserEvent() {
	host.__specimenInputDone = (id, error) => {
		const call = pending.get(id);
		pending.delete(id);
		if (error === null) call?.resolve();
		else call?.reject(new Error(error));
	};
	return new Proxy(
		{ keyboard },
		{
			get(target, name) {
				if (name === 'keyboard') return target.keyboard;
				throw new Error(
					`Specimen's vitest/browser offers userEvent.keyboard only, not userEvent.${String(name)}.`
				);
			},
		}
	);
}

export const userEvent = host.__specimenInput ? createUserEvent() : undefined;

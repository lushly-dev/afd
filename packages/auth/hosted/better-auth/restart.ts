/** Spend one bounded restart budget across the control command and instance observation. */
export function remainingBudgetMs(startedAt: number, timeoutMs: number, now = Date.now): number {
	const remainingMs = timeoutMs - (now() - startedAt);
	if (remainingMs <= 0) throw new Error('Operation exhausted its shared budget');
	return remainingMs;
}

export async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('Operation exhausted its shared budget')),
					timeoutMs
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function restartWithinBudget(input: {
	timeoutMs: number;
	restart(timeoutMs: number): Promise<void>;
	observeRestart(timeoutMs: number): Promise<void>;
	now?: () => number;
}): Promise<void> {
	const now = input.now ?? Date.now;
	const startedAt = now();
	await input.restart(input.timeoutMs);
	const remainingMs = remainingBudgetMs(startedAt, input.timeoutMs, now);
	await input.observeRestart(remainingMs);
}

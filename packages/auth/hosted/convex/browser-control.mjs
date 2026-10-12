import { withDeadline } from './lib.mjs';

export async function waitForStatus(page, status, timeout) {
	await page.waitForFunction(
		(expected) => window.afdConvex?.snapshot().status === expected,
		status,
		{ timeout }
	);
}

export async function openFreshPage(context, origin, timeout) {
	const page = await context.newPage();
	let pageErrors = 0;
	page.on('pageerror', () => pageErrors++);
	await page.goto(origin, { waitUntil: 'domcontentloaded', timeout });
	await page.waitForFunction(() => window.afdConvex !== undefined, undefined, { timeout });
	return { page, pageErrors: () => pageErrors };
}

export async function boundedEvaluate(page, timeout, label, callback, argument) {
	try {
		return await withDeadline(() => page.evaluate(callback, argument), timeout, label);
	} catch (error) {
		if (error?.code === 'DEADLINE') {
			await withDeadline(
				() => page.close({ runBeforeUnload: false }),
				Math.min(timeout, 5_000),
				`${label}-page-close`
			).catch(() => undefined);
		}
		throw error;
	}
}

export async function cleanupPage(context, current, origin, timeout) {
	if (current && !current.isClosed()) return current;
	return (await openFreshPage(context, origin, timeout)).page;
}

export async function runWithInterruption(operation, timeout, cancel) {
	let interrupt;
	const interruption = new Promise((_, reject) => {
		interrupt = (signal) => reject(Object.assign(new Error(signal), { code: 'INTERRUPTED' }));
	});
	process.once('SIGINT', interrupt);
	process.once('SIGTERM', interrupt);
	try {
		return await withDeadline(
			() => Promise.race([operation(), interruption]),
			timeout,
			'hosted-run'
		);
	} catch (error) {
		if (error?.code === 'DEADLINE' || error?.code === 'INTERRUPTED') await cancel();
		throw error;
	} finally {
		process.off('SIGINT', interrupt);
		process.off('SIGTERM', interrupt);
	}
}

export async function closeWithStatus(name, operation, timeout) {
	try {
		await withDeadline(operation, timeout, `${name}-close`);
		return { name, status: 'passed' };
	} catch {
		return { name, status: 'failed' };
	}
}

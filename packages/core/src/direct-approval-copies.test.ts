import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('approval exchanges across installed core copies', () => {
	it('shares private holds and evidence without trusting forged exchange objects', () => {
		// Exercise native ESM identity, rather than the test runner's module cache. The data
		// URL is a second independent evaluation of the built module, as in a global CLI.
		const moduleUrl = new URL('../dist/direct-approval.js', import.meta.url);
		const source = readFileSync(moduleUrl, 'utf8');
		const copyUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
		const script = `
			import assert from 'node:assert/strict';
			const client = await import(${JSON.stringify(moduleUrl.href)});
			const server = await import(${JSON.stringify(copyUrl)});
			assert.notEqual(client.createDirectApprovalExchange, server.createDirectApprovalExchange);
			const exchange = client.createDirectApprovalExchange();
			const context = exchange.bind({});
			assert.equal(server.directApprovalExchange(context), exchange);
			server.holdDirectApproval(context, { approvalToken: 'secret', summary: 'Run', expiresAt: 'later' });
			assert.equal(JSON.stringify(exchange.pending()).includes('secret'), false);
			assert.equal(server.takeDirectApproval(context), undefined);
			exchange.approve();
			assert.equal(server.takeDirectApproval(context), 'secret');
			assert.equal(client.takeDirectApproval(context), undefined);
			assert.equal(server.directApprovalExchange(client.publicDirectContext(context)), undefined);
			const key = Object.getOwnPropertySymbols(context)[0];
			assert.equal(server.directApprovalExchange({ [key]: { approve() {} } }), undefined);
			exchange.dispose();
			server.holdDirectApproval(context, { approvalToken: 'late', summary: 'Run', expiresAt: 'later' });
			assert.equal(server.directApprovalExchange(context), exchange);
			assert.equal(exchange.pending(), undefined);
		`;
		expect(() =>
			execFileSync(process.execPath, ['--input-type=module', '-e', script])
		).not.toThrow();
	});
});

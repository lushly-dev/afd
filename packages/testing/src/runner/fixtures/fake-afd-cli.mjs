#!/usr/bin/env node

const args = process.argv.slice(2);
const [subcommand, command, input, ...options] = args;
const formatIndex = options.indexOf('--format');
const connectIndex = options.indexOf('--connect');
const transportIndex = options.indexOf('--transport');

if (
	subcommand !== 'call' ||
	formatIndex < 0 ||
	options[formatIndex + 1] !== 'json' ||
	connectIndex < 0 ||
	options[connectIndex + 1] !== 'http://test.example/mcp' ||
	transportIndex < 0 ||
	options[transportIndex + 1] !== 'http'
) {
	console.error(`unexpected arguments: ${JSON.stringify(args)}`);
	process.exit(64);
}

if (command === 'malformed') {
	console.log('not json');
	process.exit(0);
}

if (command === 'hang') {
	// Never answers: used to check that timeouts kill the process
	setInterval(() => {}, 1000);
} else {
	respond();
}

function respond() {
	const parsedInput = input?.startsWith('{') ? JSON.parse(input) : {};
	const success = command !== 'fail-command';
	console.log(
		JSON.stringify(
			success
				? { success: true, data: parsedInput }
				: {
						success: false,
						error: { code: 'EXPECTED_FAILURE', message: 'Expected failure', suggestion: 'Retry' },
					}
		)
	);
	process.exit(success ? 0 : 1);
}

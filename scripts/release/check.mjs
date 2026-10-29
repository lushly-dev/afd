#!/usr/bin/env node
import { assertAdmission, loadInventory } from './control.mjs';

try {
	const args = process.argv.slice(2);
	const unit = args[args.indexOf('--unit') + 1];
	const route = args.includes('--route') ? args[args.indexOf('--route') + 1] : undefined;
	if (!args.includes('--unit') || !unit || !args.includes('--route') || !route)
		throw new Error('Usage: node scripts/release/check.mjs --unit UNIT --route ROUTE');
	const root = process.cwd();
	const distributions = assertAdmission({ root, inventory: loadInventory(root), unit, route });
	console.log(JSON.stringify({ unit, route, distributions }, null, 2));
} catch (error) {
	console.error(`Release admission rejected: ${error.message}`);
	process.exitCode = 1;
}

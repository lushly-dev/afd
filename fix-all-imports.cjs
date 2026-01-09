const fs = require('fs');
const path = require('path');

const commandsPath = path.join(__dirname, 'packages/examples/todo/backends/typescript/src/commands');
const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.ts'));

let fixedCount = 0;

for (const file of files) {
	const filePath = path.join(commandsPath, file);
	let content = fs.readFileSync(filePath, 'utf-8');
	let changed = false;

	if (content.includes('@afd/server')) {
		content = content.replace(/@afd\/server/g, '@lushly-dev/afd-server');
		changed = true;
	}

	if (content.includes('@afd/core')) {
		content = content.replace(/@afd\/core/g, '@lushly-dev/afd-core');
		changed = true;
	}

	if (changed) {
		fs.writeFileSync(filePath, content, 'utf-8');
		console.log('Fixed: ' + file);
		fixedCount++;
	}
}

console.log('Fixed ' + fixedCount + ' files');

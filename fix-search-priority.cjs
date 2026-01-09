const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'packages/examples/todo/backends/typescript/src/commands/search.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Remove old fix if present
content = content.replace(/const PRIORITY_MAP: Record<'low' \| 'medium' \| 'high', number> = \{[\s\S]*?\};\n\n/g, '');
content = content.replace(/\n\t\tconst numericPriority = priority \? PRIORITY_MAP\[priority\] : undefined;/g, '');
content = content.replace(/priority: numericPriority/g, 'priority');

// Add PRIORITY_MAP with Priority type
content = content.replace(
  /const inputSchema = z\.object\(\{/,
  `const PRIORITY_MAP: Record<'low' | 'medium' | 'high', Priority> = {
  low: 1,
  medium: 2,
  high: 3,
};

const inputSchema = z.object({`
);

// Replace the destructuring line to add conversion with proper cast
content = content.replace(
  /const \{ query, scope, completed, priority, sortBy, sortOrder, limit, offset \} = input;/,
  `const { query, scope, completed, priority, sortBy, sortOrder, limit, offset } = input;
		const numericPriority: Priority | undefined = priority ? PRIORITY_MAP[priority] : undefined;`
);

// Replace all usages of priority in store.list() with numericPriority
content = content.replace(
  /store\.list\(\{[\s]*completed,[\s]*priority[\s,]*\}\)/g,
  'store.list({ completed, priority: numericPriority })'
);

content = content.replace(
  /store\.list\(\{[\s]*completed: !completed,[\s]*priority[\s,]*\}\)/g,
  'store.list({ completed: !completed, priority: numericPriority })'
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed search.ts Priority type issue');

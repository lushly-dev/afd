#!/usr/bin/env node
/**
 * Splits every `@lushly-dev/violet-elements` component into a side-effect-free class module and a
 * define module (#1785), and moves the package's importers onto the new modules and subpaths.
 *
 * For each tag in `custom-elements.json`, the class module `src/<folder>/violet-<x>.ts`:
 *  - loses its `if (!customElements.get(tag)) { await X.define(...) }` block, which becomes
 *    `export const violet<Name>Definition = { name, template, styles, shadowOptions }` (and
 *    `violet<Name>Extensions` when the define call passed extensions);
 *  - loses its side-effect imports of other components and its top-level `registerSystem*Icon()`
 *    calls, which move into the define module.
 * The sibling `violet-<x>.define.ts` exports `defineViolet<Name>(registry = customElements)`: it
 * awaits the define function of every component the class module imported (with the same registry),
 * registers the moved icons, defines the element through `defineVioletElement`, which composes its
 * FAST definition once per class, and ends with `await defineViolet<Name>()` so a bare import still
 * registers globally.
 *
 * It then writes `src/all.ts` (imports every define module), makes `src/index.ts` import it, writes
 * the package's `exports` and `sideEffects`, points specs and stories at define modules, and rewrites
 * `@lushly-dev/violet-elements/dist/...` imports elsewhere in the repository to the public subpaths.
 *
 * It parses with the TypeScript compiler API and edits by node position, so the output does not
 * depend on formatting (2- and 4-space files, `FASTElement.define(X, {...})` and `X.define({...})`).
 * Run it on a tree whose class modules still define themselves, as after a rebase onto a `main` that
 * changed them: a class module already split, and an importer already rewritten, are left as they are.
 *
 * Usage: node scripts/codemods/split-define.mjs [--check]
 *   --check  report what would change and exit 1 if anything would, writing nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageDir = join(repository, 'foundations/fast-af/packages/violet-elements');
const packageName = '@lushly-dev/violet-elements';
const checkOnly = process.argv.includes('--check');
const writes = new Map();

const read = (file) => (writes.has(file) ? writes.get(file) : readFileSync(file, 'utf8'));
const write = (file, text) => {
	if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writes.set(file, text);
	else writes.delete(file);
};
const parse = (file, text) =>
	ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const toPosix = (path) => path.split('\\').join('/');

/** Applies `[start, end, text]` edits, last first. */
function applyEdits(text, edits) {
	let result = text;
	for (const [start, end, replacement] of [...edits].sort((a, b) => b[0] - a[0])) {
		result = result.slice(0, start) + replacement + result.slice(end);
	}
	return result;
}

/** The statement's full extent with its trailing newline, so removing it leaves no blank line. */
function statementRange(text, node) {
	const start = node.getStart();
	let lineStart = start;
	while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart -= 1;
	let end = node.getEnd();
	while (end < text.length && text[end] !== '\n') end += 1;
	return [lineStart, Math.min(end + 1, text.length)];
}

// ---------------------------------------------------------------------------------------------
// Components, from the manifest.

const manifest = JSON.parse(readFileSync(join(packageDir, 'custom-elements.json'), 'utf8'));
const components = [];
for (const module of manifest.modules) {
	for (const declaration of module.declarations ?? []) {
		if (!declaration.customElement || !declaration.tagName) continue;
		const className = declaration.name;
		const lower = className[0].toLowerCase() + className.slice(1);
		components.push({
			tag: declaration.tagName,
			subpath: declaration.tagName.replace(/^violet-/, ''),
			className,
			definitionName: `${lower}Definition`,
			extensionsName: `${lower}Extensions`,
			defineName: `define${className}`,
			// `src/button/violet-button.ts`, without `src/` and the extension.
			module: module.path.replace(/^src\//, '').replace(/\.ts$/, ''),
		});
	}
}
components.sort((a, b) => a.module.localeCompare(b.module));
const byModule = new Map(components.map((component) => [component.module, component]));
if (components.length === 0) throw new Error('custom-elements.json declares no elements');

/** The component a relative specifier from `fromModule` (both relative to `src/`) names, if any. */
function componentOf(fromModule, specifier) {
	if (!specifier.startsWith('.')) return undefined;
	const target = posix
		.normalize(posix.join(posix.dirname(fromModule), specifier))
		.replace(/\.(js|ts)$/, '');
	return byModule.get(target);
}

const relativeSpecifier = (fromModule, toModule) => {
	const path = posix.relative(posix.dirname(fromModule), toModule);
	return path.startsWith('.') ? path : `./${path}`;
};

/** Whether an import brings in values (not only types). */
function importsValues(node) {
	const clause = node.importClause;
	if (!clause) return true;
	if (clause.isTypeOnly) return false;
	if (clause.name) return true;
	const bindings = clause.namedBindings;
	if (!bindings) return false;
	if (ts.isNamespaceImport(bindings)) return true;
	return bindings.elements.some((element) => !element.isTypeOnly);
}

// ---------------------------------------------------------------------------------------------
// 1. Class modules and define modules.

/** Finds the `if (!customElements.get("tag")) { await X.define(...) }` statement and its call. */
function findDefineBlock(sourceFile, tag) {
	for (const statement of sourceFile.statements) {
		if (!ts.isIfStatement(statement)) continue;
		const condition = statement.expression.getText();
		if (!condition.includes('customElements.get') || !condition.includes(`"${tag}"`)) continue;
		const block = statement.thenStatement;
		const inner = ts.isBlock(block) ? block.statements : [block];
		if (inner.length !== 1 || !ts.isExpressionStatement(inner[0])) {
			throw new Error(`${tag}: the define block holds more than one statement`);
		}
		let call = inner[0].expression;
		if (ts.isAwaitExpression(call)) call = call.expression;
		if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) {
			throw new Error(`${tag}: the define block is not a define call`);
		}
		if (call.expression.name.text !== 'define') throw new Error(`${tag}: not a define call`);
		const receiver = call.expression.expression.getText();
		// FASTElement.define(Class, definition, extensions?) or Class.define(definition).
		const args = receiver === 'FASTElement' ? call.arguments.slice(1) : call.arguments;
		const [definition, extensions] = args;
		if (!definition || !ts.isObjectLiteralExpression(definition)) {
			throw new Error(`${tag}: the define call takes no definition object`);
		}
		return { statement, definition, extensions, awaitStatement: inner[0] };
	}
	return undefined;
}

/** A node's text, with every line after the first moved left by its first line's indentation. */
function dedent(text, node) {
	let lineStart = node.getStart();
	while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart -= 1;
	const by = /^ */.exec(text.slice(lineStart))[0].length;
	const source = text.slice(node.getStart(), node.getEnd());
	return by === 0 ? source : source.replace(new RegExp(`\\n {1,${by}}`, 'g'), '\n');
}

/** The indentation of a node's line. */
function indentOf(text, node) {
	let lineStart = node.getStart();
	while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart -= 1;
	return /^ */.exec(text.slice(lineStart))[0];
}

/**
 * A split class module may drift: a merge can bring back a side-effect import of another element,
 * or a value import whose element the define module does not define first. Neither registers
 * anything now, so report both rather than pass the tree as split.
 */
const drift = [];
function checkSplit(component, sourceFile, defineText) {
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const dependency = componentOf(component.module, statement.moduleSpecifier.text);
		if (!dependency || dependency === component || !importsValues(statement)) continue;
		if (!statement.importClause) {
			drift.push(
				`${component.module}.ts imports ${dependency.module} for its side effect, which registers nothing now: call ${dependency.defineName}(registry) in ${posix.basename(component.module)}.define.ts instead`
			);
		} else if (!new RegExp(`\\b${dependency.defineName}\\(registry\\)`).test(defineText)) {
			drift.push(
				`${component.module}.ts uses ${dependency.module}, but ${posix.basename(component.module)}.define.ts does not call ${dependency.defineName}(registry) first`
			);
		}
	}
	if (
		/^\s*(?:await\s+)?[\w.]+\.define\(/m.test(sourceFile.text) ||
		/customElements\.(define|get)\(/.test(sourceFile.text)
	) {
		drift.push(
			`${component.module}.ts registers an element at load; move it to ${posix.basename(component.module)}.define.ts`
		);
	}
	for (const statement of sourceFile.statements) {
		const call = ts.isExpressionStatement(statement) ? statement.expression : undefined;
		if (
			call &&
			ts.isCallExpression(call) &&
			ts.isIdentifier(call.expression) &&
			/^register\w+Icons?$/.test(call.expression.text)
		) {
			drift.push(
				`${component.module}.ts calls ${call.expression.text}() at load; call it in ${posix.basename(component.module)}.define.ts instead`
			);
		}
	}
}

function splitComponent(component) {
	const classFile = join(packageDir, 'src', `${component.module}.ts`);
	const defineFile = join(packageDir, 'src', `${component.module}.define.ts`);
	const text = read(classFile);
	const sourceFile = parse(classFile, text);
	const block = findDefineBlock(sourceFile, component.tag);
	if (!block) {
		if (!existsSync(defineFile) && !writes.has(defineFile)) {
			throw new Error(`${component.module}: no define block and no define module`);
		}
		checkSplit(component, sourceFile, read(defineFile));
		return; // Split already.
	}
	const edits = [];
	const dependencies = [];
	const icons = [];
	const iconCalls = new Set();

	// Top-level icon registrations move to the define function.
	for (const statement of sourceFile.statements) {
		if (!ts.isExpressionStatement(statement)) continue;
		const call = statement.expression;
		if (
			ts.isCallExpression(call) &&
			ts.isIdentifier(call.expression) &&
			/^registerSystem\w+Icon$/.test(call.expression.text) &&
			call.arguments.length === 0
		) {
			iconCalls.add(call.expression.text);
			edits.push([...statementRange(text, statement), '']);
		}
	}

	// Component imports: side-effect imports move to the define module; every value import of a
	// component (side-effect or named) is a dependency the define function defines first.
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const specifier = statement.moduleSpecifier.text;
		const dependency = componentOf(component.module, specifier);
		if (dependency && dependency !== component && importsValues(statement)) {
			if (!dependencies.includes(dependency)) dependencies.push(dependency);
			if (!statement.importClause) edits.push([...statementRange(text, statement), '']);
		}
	}

	// The icon functions' imports: keep the names the class module still uses.
	const removed = new Set(edits.map(([start]) => start));
	const uses = new Map();
	const count = (node) => {
		if (ts.isImportDeclaration(node)) return;
		if (ts.isExpressionStatement(node) && removed.has(statementRange(text, node)[0])) return;
		if (ts.isIdentifier(node)) uses.set(node.text, (uses.get(node.text) ?? 0) + 1);
		ts.forEachChild(node, count);
	};
	ts.forEachChild(sourceFile, count);
	const stillUsed = (name) => (uses.get(name) ?? 0) > 0;
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		const moved = bindings.elements.filter((element) => iconCalls.has(element.name.text));
		if (moved.length === 0) continue;
		const specifier = statement.moduleSpecifier.text;
		for (const element of moved) {
			const name = element.name.text;
			// From the icon barrel, import the one icon's module instead.
			const file = name
				.replace(/^register/, '')
				.replace(/Icon$/, '')
				.replace(/[A-Z]/g, (letter, index) => `${index === 0 ? '' : '-'}${letter.toLowerCase()}`);
			const barrel = /\/icon\/generated(?:\/index)?$/.test(specifier);
			icons.push({
				name,
				specifier: barrel ? `${specifier.replace(/\/index$/, '')}/icons/${file}` : specifier,
			});
		}
		const kept = bindings.elements.filter(
			(element) => !iconCalls.has(element.name.text) || stillUsed(element.name.text)
		);
		if (kept.length === 0) {
			edits.push([...statementRange(text, statement), '']);
		} else if (kept.length !== bindings.elements.length) {
			edits.push([
				bindings.getStart(),
				bindings.getEnd(),
				`{ ${kept.map((element) => element.getText()).join(', ')} }`,
			]);
		}
	}

	// The define block becomes the exported definition; its body's indentation is the file's unit.
	const indent = indentOf(text, block.awaitStatement) || '    ';
	let replacement =
		`/** The FAST definition of \`<${component.tag}>\`; \`${component.defineName}\` in \`./${posix.basename(component.module)}.define\` registers it. */\n` +
		`export const ${component.definitionName} = ${dedent(text, block.definition)} satisfies PartialFASTElementDefinition;\n`;
	if (block.extensions) {
		replacement +=
			`\n/** The FAST extensions \`<${component.tag}>\` is defined with. */\n` +
			`export const ${component.extensionsName}: FASTElementExtension[] = ${dedent(text, block.extensions)};\n`;
	}
	const [blockStart, blockEnd] = statementRange(text, block.statement);
	edits.push([blockStart, blockEnd, replacement]);

	// Type imports the definition needs.
	const typeNames = [
		'PartialFASTElementDefinition',
		...(block.extensions ? ['FASTElementExtension'] : []),
	];
	const fastImport = sourceFile.statements.find(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			statement.moduleSpecifier.text === '@lushly-dev/fast-element' &&
			statement.importClause?.namedBindings &&
			ts.isNamedImports(statement.importClause.namedBindings) &&
			!statement.importClause.isTypeOnly
	);
	if (fastImport) {
		const bindings = fastImport.importClause.namedBindings;
		const present = new Set(bindings.elements.map((element) => element.name.text));
		const added = typeNames.filter((name) => !present.has(name)).map((name) => `type ${name}`);
		if (added.length > 0) {
			const names = [...bindings.elements.map((element) => element.getText()), ...added];
			edits.push([bindings.getStart(), bindings.getEnd(), `{ ${names.join(', ')} }`]);
		}
	} else {
		edits.push([
			0,
			0,
			`import type { ${typeNames.join(', ')} } from "@lushly-dev/fast-element";\n`,
		]);
	}

	let classText = applyEdits(text, edits);
	classText = classText.replace(/\n{3,}/g, '\n\n');
	write(classFile, classText);

	// The define module.
	const base = posix.basename(component.module);
	const helper = relativeSpecifier(component.module, 'shared/define-element');
	const lines = [
		`import { defineVioletElement } from "${helper}";`,
		...dependencies.map(
			(dependency) =>
				`import { ${dependency.defineName} } from "${relativeSpecifier(component.module, dependency.module)}.define";`
		),
		...groupIcons(icons),
		`import { ${component.className}, ${component.definitionName}${block.extensions ? `, ${component.extensionsName}` : ''} } from "./${base}";`,
		'',
		'/**',
		` * Defines \`<${component.tag}>\` in \`registry\`${dependencies.length > 0 ? ', after the elements it uses' : ''}.`,
		' * Defining it again in the same registry does nothing.',
		' *',
		' * @param registry - The registry to define it in: the global one unless a scoped registry is given.',
		' */',
		`export async function ${component.defineName}(registry: CustomElementRegistry = customElements): Promise<void> {`,
		...dependencies.map((dependency) => `${indent}await ${dependency.defineName}(registry);`),
		...icons.map((icon) => `${indent}${icon.name}();`),
		`${indent}await defineVioletElement(${component.className}, ${component.definitionName}, registry${block.extensions ? `, ${component.extensionsName}` : ''});`,
		'}',
		'',
		`await ${component.defineName}();`,
		'',
	];
	write(defineFile, lines.join('\n'));
}

function groupIcons(icons) {
	const bySpecifier = new Map();
	for (const icon of icons) {
		if (!bySpecifier.has(icon.specifier)) bySpecifier.set(icon.specifier, []);
		bySpecifier.get(icon.specifier).push(icon.name);
	}
	return [...bySpecifier].map(
		([specifier, names]) => `import { ${names.join(', ')} } from "${specifier}";`
	);
}

for (const component of components) splitComponent(component);

// ---------------------------------------------------------------------------------------------
// 2. The shared helper, `all.ts` and the root barrel.

const helperFile = join(packageDir, 'src/shared/define-element.ts');
write(
	helperFile,
	`import {
  type Constructable,
  FASTElementDefinition,
  type FASTElementExtension,
  type PartialFASTElementDefinition,
} from "@lushly-dev/fast-element";

const definitions = new WeakMap<Constructable<HTMLElement>, Promise<FASTElementDefinition>>();

/**
 * Defines a Violet element in \`registry\`, composing its FAST definition once per class.
 *
 * @remarks
 * \`FASTElement.define\` composes a new definition on every call and, for a class it has defined
 * before, a subclass, so a class defined in a second registry would not be the class the first one
 * holds. One definition serves every registry instead: \`definition.define(registry)\` registers the
 * class itself and does nothing for a registry that already has the tag.
 *
 * The elements an element creates in its own shadow root still come from the global registry, so
 * a scoped registry does not isolate its children yet (#2437).
 *
 * @param type - The element class.
 * @param partial - Its name, template, styles and shadow options.
 * @param registry - The registry to define it in.
 * @param extensions - FAST extensions applied once per registry before the element is defined.
 */
export async function defineVioletElement<TType extends Constructable<HTMLElement>>(
  type: TType,
  partial: PartialFASTElementDefinition<TType>,
  registry: CustomElementRegistry = customElements,
  extensions?: FASTElementExtension[],
): Promise<void> {
  let definition = definitions.get(type);
  if (definition === undefined) {
    definition = FASTElementDefinition.compose(type, partial);
    definitions.set(type, definition);
  }
  (await definition).define(registry, extensions);
}
`
);

const indexFile = join(packageDir, 'src/index.ts');
const indexText = read(indexFile);
const indexSource = parse(indexFile, indexText);
const registered = [];
for (const statement of indexSource.statements) {
	if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
	const component = componentOf('index', statement.moduleSpecifier.text);
	if (component && !registered.includes(component)) registered.push(component);
}
for (const component of components) if (!registered.includes(component)) registered.push(component);
write(
	join(packageDir, 'src/all.ts'),
	[
		'/**',
		' * Registers every Violet element in the global registry. The root entry imports it; a product that',
		' * wants only some elements imports their `<name>/define` subpaths instead.',
		' */',
		...registered.map((component) => `import "./${component.module}.define";`),
		'',
	].join('\n')
);
if (!/^import "\.\/all";$/m.test(indexText)) {
	const lastExport = [...indexSource.statements]
		.reverse()
		.find((statement) => ts.isExportDeclaration(statement));
	const [, end] = statementRange(indexText, lastExport);
	write(
		indexFile,
		`${indexText.slice(0, end)}\n// The root entry registers every element; each \`<name>/define\` subpath registers one.\nimport "./all";\n${indexText.slice(end)}`
	);
}

// ---------------------------------------------------------------------------------------------
// 3. The package's exports and side effects.

const packageFile = join(packageDir, 'package.json');
const pkg = JSON.parse(read(packageFile));
const entry = (path) => ({
	types: `./dist/${path}.d.ts`,
	import: `./dist/${path}.js`,
	default: `./dist/${path}.js`,
});
const exportsMap = { '.': entry('index') };
for (const component of [...components].sort((a, b) => a.subpath.localeCompare(b.subpath))) {
	// `violet-theme`'s class entry is the theme barrel, which exports `VioletTheme` with the theme
	// functions, so `./theme` keeps meaning the whole (side-effect-free) theme API.
	exportsMap[`./${component.subpath}`] = entry(
		component.module === 'theme/violet-theme' ? 'theme/index' : component.module
	);
	exportsMap[`./${component.subpath}/define`] = entry(`${component.module}.define`);
}
Object.assign(exportsMap, {
	'./icon-registry': entry('icon/icon-registry'),
	'./icons/*': {
		types: './dist/icon/generated/icons/*.d.ts',
		import: './dist/icon/generated/icons/*.js',
		default: './dist/icon/generated/icons/*.js',
	},
	'./theme-css': entry('theme/violet-theme-css'),
	'./theme-runtime': entry('theme/violet-theme-runtime'),
	'./theme-builtin': entry('theme/violet-theme-builtin'),
	'./custom-elements.json': './custom-elements.json',
	'./tokens/*': './tokens/*',
	'./package.json': './package.json',
});
pkg.exports = exportsMap;
pkg.sideEffects = ['./dist/**/*.define.js', './dist/all.js', './dist/index.js'];
write(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);

// ---------------------------------------------------------------------------------------------
// 4. Specs and stories in the package import define modules.

function walk(directory, accept, found = []) {
	for (const name of readdirSync(directory)) {
		if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
		const path = join(directory, name);
		if (statSync(path).isDirectory()) walk(path, accept, found);
		else if (accept(path)) found.push(path);
	}
	return found;
}

for (const file of walk(join(packageDir, 'src'), (path) => /\.(spec|stories)\.ts$/.test(path))) {
	const module = toPosix(relative(join(packageDir, 'src'), file)).replace(/\.ts$/, '');
	const text = read(file);
	const sourceFile = parse(file, text);
	const edits = [];
	const present = new Set();
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && !statement.importClause) {
			present.add(statement.moduleSpecifier.text);
		}
	}
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const specifier = statement.moduleSpecifier.text;
		const component = componentOf(module, specifier);
		if (!component || !importsValues(statement)) continue;
		const defineSpecifier = `${specifier.replace(/\.(js|ts)$/, '')}.define`;
		if (!statement.importClause) {
			if (present.has(defineSpecifier)) {
				// An earlier named import of this component already brought in its define module.
				const [start, end] = statementRange(text, statement);
				edits.push([start, end, '']);
				continue;
			}
			edits.push([
				statement.moduleSpecifier.getStart(),
				statement.moduleSpecifier.getEnd(),
				`"${defineSpecifier}"`,
			]);
			present.add(defineSpecifier);
		} else if (!present.has(defineSpecifier)) {
			const [, end] = statementRange(text, statement);
			edits.push([end, end, `import "${defineSpecifier}";\n`]);
			present.add(defineSpecifier);
		}
	}
	// `await import("../dialog/violet-dialog")` registered the element too.
	const visitDynamic = (node) => {
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0]) &&
			componentOf(module, node.arguments[0].text) &&
			// Only an import run for its effect (`await import(...)` as a statement); one whose module is
			// used, such as `const { VioletButton } = await import(...)`, keeps the class module.
			(ts.isExpressionStatement(node.parent) ||
				(ts.isAwaitExpression(node.parent) && ts.isExpressionStatement(node.parent.parent)))
		) {
			const literal = node.arguments[0];
			edits.push([
				literal.getStart() + 1,
				literal.getEnd() - 1,
				`${literal.text.replace(/\.(js|ts)$/, '')}.define`,
			]);
		}
		ts.forEachChild(node, visitDynamic);
	};
	visitDynamic(sourceFile);
	if (edits.length > 0) write(file, applyEdits(text, edits));
}

// ---------------------------------------------------------------------------------------------
// 5. Importers elsewhere: `@lushly-dev/violet-elements/dist/...` becomes a public subpath.

const distPattern = /^@lushly-dev\/violet-elements\/dist\/(.+?)(?:\.js)?$/;
function publicSpecifier(specifier, { sideEffect }) {
	const match = specifier.match(distPattern);
	if (!match) return undefined;
	const path = match[1];
	const icon = path.match(/^icon\/generated\/icons\/([a-z0-9-]+)$/);
	if (icon) return `${packageName}/icons/${icon[1]}`;
	if (path === 'icon/icon-registry') return `${packageName}/icon-registry`;
	const theme = {
		'theme/violet-theme-css': 'theme-css',
		'theme/violet-theme-runtime': 'theme-runtime',
		'theme/violet-theme-builtin': 'theme-builtin',
		'theme/index': 'theme',
	}[path];
	if (theme) return `${packageName}/${theme}`;
	const component = byModule.get(path);
	if (!component) throw new Error(`no public subpath for ${specifier}`);
	return `${packageName}/${component.subpath}${sideEffect ? '/define' : ''}`;
}

const consumerRoots = [
	'endpoints',
	'packages/examples',
	'integrations',
	'foundations/specimen',
	'tests',
].map((path) => join(repository, path));
for (const root of consumerRoots) {
	for (const file of walk(
		root,
		(path) => /\.(ts|mts|js|mjs)$/.test(path) && !/\.d\.ts$/.test(path)
	)) {
		const text = read(file);
		if (!text.includes(`${packageName}/dist/`)) continue;
		const sourceFile = parse(file, text);
		const edits = [];
		const visit = (node) => {
			if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
				const literal = node.moduleSpecifier;
				if (literal && ts.isStringLiteral(literal)) {
					const sideEffect = ts.isImportDeclaration(node) && !node.importClause;
					const valueImport =
						ts.isImportDeclaration(node) && node.importClause && importsValues(node);
					const replacement = publicSpecifier(literal.text, { sideEffect });
					if (replacement) {
						edits.push([literal.getStart() + 1, literal.getEnd() - 1, replacement]);
						// A named value import of an element module used to register it as well.
						const component = byModule.get(literal.text.match(distPattern)?.[1] ?? '');
						if (valueImport && component) {
							const [, end] = statementRange(text, node);
							const quote = literal.getText()[0];
							edits.push([end, end, `import ${quote}${replacement}/define${quote};\n`]);
						}
					}
				}
			} else if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword &&
				node.arguments[0] &&
				ts.isStringLiteralLike(node.arguments[0])
			) {
				const literal = node.arguments[0];
				const replacement = publicSpecifier(literal.text, { sideEffect: true });
				if (replacement) edits.push([literal.getStart() + 1, literal.getEnd() - 1, replacement]);
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
		if (edits.length > 0) write(file, applyEdits(text, edits));
	}
}

// ---------------------------------------------------------------------------------------------

if (drift.length > 0) {
	console.error(`split-define: split modules drifted:\n- ${drift.join('\n- ')}`);
	process.exit(1);
}

const changed = [...writes.keys()].map((file) => toPosix(relative(repository, file))).sort();
if (checkOnly) {
	if (changed.length > 0) {
		console.log(`split-define would change ${changed.length} files:\n${changed.join('\n')}`);
		process.exit(1);
	}
	console.log('split-define: nothing to change');
} else {
	for (const [file, text] of writes) writeFileSync(file, text);
	console.log(`split-define: wrote ${changed.length} files (${components.length} components)`);
}

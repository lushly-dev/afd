/**
 * @fileoverview The Skills over MCP extension's catalog (`io.modelcontextprotocol/skills`,
 * SEP-2640; `spec/mcp-resources.md`, S1 to S8).
 *
 * A {@link SkillCatalog} is fixed when it is built: the constructor reads each skill's bytes
 * once, checks every rule of S2 and computes the digests, so a catalog that exists is one the
 * server can serve. The server serves skills as data: it reads only the frontmatter, never
 * follows instructions in a skill and never widens anything for one.
 *
 * @example
 * ```typescript
 * const skills = new SkillCatalog([
 *   {
 *     path: 'hello-greeting',
 *     files: {
 *       'SKILL.md': '---\nname: hello-greeting\ndescription: Greet a person by name.\n---\n\nCall hello-greet.\n',
 *       'references/STYLE.md': '# Style\n',
 *     },
 *   },
 * ]);
 * createMcpServer({ name: 'hello', version: '1.0.0', commands, skills });
 * ```
 */

import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { sep } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';

/** The most files one skill may have, the extension's limit. */
export const MAX_SKILL_FILES = 512;

/** The most bytes one skill may have in total, `SKILL.md` included: 16 MiB. */
export const MAX_SKILL_BYTES = 16 * 1024 * 1024;

/** The `_meta` key a resource's digest goes under, set by the server (R6). */
export const DIGEST_META_KEY = 'dev.afd/digest';

/** The Skills extension's identifier, declared in `capabilities.extensions`. */
export const SKILLS_EXTENSION_ID = 'io.modelcontextprotocol/skills';

const DIRECTORY_MIME_TYPE = 'inode/directory';

/**
 * One skill as the host gives it: a skill path and its files' bytes.
 *
 * The skill path is `/`-separated: optional prefix segments, then the skill's `name`
 * (`hello-greeting`, `acme/lint-rules`). Files are addressed by their path relative to the
 * skill's root (`SKILL.md`, `references/STYLE.md`); a string is stored as UTF-8. Nothing is
 * checked until the catalog is built.
 */
export interface Skill {
	path: string;
	files: Record<string, string | Uint8Array>;
}

/** Options of {@link SkillCatalog}. */
export interface SkillCatalogOptions {
	/**
	 * Serve `resources/directory/read` for every directory of every skill and declare
	 * `directoryRead: true` (S6).
	 *
	 * @default false
	 */
	directoryRead?: boolean;
}

interface CatalogFile {
	uri: string;
	path: string;
	bytes: Uint8Array;
	digest: string;
	mimeType: string;
	/** The `resources/list` item (S5). */
	resource: Record<string, unknown>;
}

interface CatalogSkill {
	path: string;
	entry: Record<string, unknown>;
	files: CatalogFile[];
}

/** `sha256:` and the 64 lowercase hexadecimal characters of the SHA-256 of `bytes` (R6). */
export function sha256Digest(bytes: Uint8Array): string {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const utf8 = new TextEncoder();

function toBytes(content: string | Uint8Array): Uint8Array {
	return typeof content === 'string' ? utf8.encode(content) : content;
}

/** Order two strings by their UTF-8 bytes. */
function byBytes(left: string, right: string): number {
	return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/** Whether `text` follows the Agent Skills character rule for a name (S2). */
function isName(text: string): boolean {
	return text.length >= 1 && text.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text);
}

const MIME_TYPES: Record<string, string> = {
	md: 'text/markdown',
	txt: 'text/plain',
	json: 'application/json',
	yaml: 'application/yaml',
	yml: 'application/yaml',
	toml: 'application/toml',
	csv: 'text/csv',
	html: 'text/html',
	css: 'text/css',
	js: 'text/javascript',
	mjs: 'text/javascript',
	ts: 'text/x-typescript',
	py: 'text/x-python',
	sh: 'text/x-shellscript',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	pdf: 'application/pdf',
};

/** The MIME type of a skill file by its suffix, compared case-insensitively (S5). */
export function skillMimeType(path: string): string {
	const dot = path.lastIndexOf('.');
	const suffix = dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
	return Object.hasOwn(MIME_TYPES, suffix)
		? (MIME_TYPES[suffix] as string)
		: 'application/octet-stream';
}

/** Whether `text` is well-formed UTF-16, so it has a UTF-8 form. */
function isWellFormed(text: string): boolean {
	return text.isWellFormed();
}

function checkSkill(skill: Skill): CatalogSkill {
	const { path } = skill;
	const fail = (rule: string) => new Error(`skill "${path}": ${rule}`);
	if (typeof path !== 'string' || path === '') throw fail('the skill path is empty');
	if (!isWellFormed(path)) throw fail('the skill path is not valid UTF-8');
	const segments = path.split('/');
	const last = segments[segments.length - 1] as string;
	const bad = segments.find((segment) => !isName(segment));
	if (bad !== undefined) {
		throw fail(
			`the skill path segment "${bad}" must be 1 to 64 characters of a-z, 0-9 and -, not starting or ending with -, with no --`
		);
	}
	const given = Object.entries(skill.files ?? {});
	if (given.length > MAX_SKILL_FILES) throw fail(`has more than ${MAX_SKILL_FILES} files`);
	const files = given.map(([file, content]) => {
		if (
			file === '' ||
			!isWellFormed(file) ||
			file.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
		) {
			throw fail(
				`the file path "${file}" must be relative and "/"-separated, valid UTF-8, with no empty, "." or ".." segment`
			);
		}
		if (typeof content === 'string' ? !isWellFormed(content) : !(content instanceof Uint8Array)) {
			throw fail(`the file "${file}" must hold a string of well-formed text or a Uint8Array`);
		}
		return { file, bytes: toBytes(content) };
	});
	const total = files.reduce((sum, { bytes }) => sum + bytes.length, 0);
	if (total > MAX_SKILL_BYTES) throw fail(`has more than ${MAX_SKILL_BYTES} bytes`);

	const skillMd = files.find(({ file }) => file === 'SKILL.md');
	if (!skillMd) throw fail('has no SKILL.md at its root');
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(skillMd.bytes);
	} catch {
		throw fail('SKILL.md is not valid UTF-8');
	}
	let frontmatter: Record<string, unknown>;
	try {
		frontmatter = parseFrontmatter(text);
	} catch (error) {
		throw fail(`SKILL.md: ${(error as Error).message}`);
	}
	const { name, description } = frontmatter;
	if (typeof name !== 'string') throw fail('the frontmatter needs a string "name"');
	if (!isName(name)) {
		throw fail(
			`the name "${name}" must be 1 to 64 characters of a-z, 0-9 and -, not starting or ending with -, with no --`
		);
	}
	if (name !== last) {
		throw fail(`the name "${name}" must equal the last segment of the skill path, "${last}"`);
	}
	if (typeof description !== 'string' || description === '' || [...description].length > 1024) {
		throw fail('the frontmatter needs a "description" of 1 to 1,024 characters');
	}

	// `SKILL.md` first, then the others in ascending order of their paths' UTF-8 bytes.
	const ordered = [
		skillMd,
		...files.filter((item) => item !== skillMd).sort((a, b) => byBytes(a.file, b.file)),
	];
	const prefix = `skill://${path}/`;
	const catalogFiles: CatalogFile[] = ordered.map(({ file, bytes }) => {
		const digest = sha256Digest(bytes);
		const mimeType = skillMimeType(file);
		const resource: Record<string, unknown> = {
			uri: `${prefix}${file}`,
			name: file === 'SKILL.md' ? name : file,
			...(file === 'SKILL.md' && { description }),
			mimeType,
			size: bytes.length,
			_meta: { [DIGEST_META_KEY]: digest },
		};
		return { uri: `${prefix}${file}`, path: file, bytes, digest, mimeType, resource };
	});
	const entry = {
		uri: `${prefix}SKILL.md`,
		frontmatter,
		resources: catalogFiles.map(({ uri, digest, bytes }) => ({ uri, digest, size: bytes.length })),
	};
	return { path, entry, files: catalogFiles };
}

/** Every directory of `skill` that holds a file, as a path inside the skill: the root (empty) and each subdirectory on the way to a file. */
function directoriesOf(skill: CatalogSkill): Set<string> {
	const directories = new Set<string>(['']);
	for (const file of skill.files) {
		let end = file.path.indexOf('/');
		while (end >= 0) {
			directories.add(file.path.slice(0, end));
			end = file.path.indexOf('/', end + 1);
		}
	}
	return directories;
}

/**
 * An ordered, fixed set of Agent Skills a server serves through `skills/list`, `skills/get`,
 * `resources/list` and `resources/read` (and `resources/directory/read` when enabled).
 *
 * @throws An error naming the skill and the rule, when a skill breaks one of S2's checks.
 */
export class SkillCatalog {
	readonly directoryRead: boolean;
	readonly #skills: readonly CatalogSkill[];
	readonly #files = new Map<string, CatalogFile>();
	readonly #entries = new Map<string, Record<string, unknown>>();
	readonly #directories = new Map<string, { skill: CatalogSkill; directory: string }>();

	constructor(skills: readonly Skill[], options: SkillCatalogOptions = {}) {
		this.directoryRead = options.directoryRead === true;
		const built: CatalogSkill[] = [];
		const names = new Set<string>();
		const paths = new Set<string>();
		for (const skill of skills) {
			const checked = checkSkill(skill);
			if (paths.has(checked.path)) {
				throw new Error(`skill "${checked.path}": the skill path is used twice`);
			}
			paths.add(checked.path);
			const name = (checked.entry.frontmatter as Record<string, unknown>).name as string;
			if (names.has(name)) {
				throw new Error(
					`skill "${checked.path}": the name "${name}" is used by another skill (names are unique in a catalog, even under different prefixes)`
				);
			}
			names.add(name);
			built.push(checked);
		}
		for (const skill of built) {
			this.#entries.set(skill.entry.uri as string, skill.entry);
			for (const file of skill.files) {
				if (this.#files.has(file.uri)) {
					throw new Error(
						`skill "${skill.path}": the URI ${file.uri} is also served by another skill`
					);
				}
				this.#files.set(file.uri, file);
			}
			for (const directory of directoriesOf(skill)) {
				const uri =
					directory === '' ? `skill://${skill.path}` : `skill://${skill.path}/${directory}`;
				if (this.#directories.has(uri)) {
					throw new Error(
						`skill "${skill.path}": the directory ${uri} is also a directory of another skill`
					);
				}
				this.#directories.set(uri, { skill, directory });
			}
		}
		for (const uri of this.#directories.keys()) {
			if (this.#files.has(uri))
				throw new Error(`${uri} is both a skill file and a skill directory`);
		}
		this.#skills = built;
	}

	/** The number of skills. */
	get size(): number {
		return this.#skills.length;
	}

	/** The `skills/list` entries, in catalog order (S3). */
	entries(): Record<string, unknown>[] {
		return this.#skills.map((skill) => skill.entry);
	}

	/** One `skills/list` entry by its exact `SKILL.md` URI (S4). */
	entry(uri: string): Record<string, unknown> | undefined {
		return this.#entries.get(uri);
	}

	/** Every skill file as a `resources/list` item, skill by skill and in manifest order (S5). */
	resources(): Record<string, unknown>[] {
		return this.#skills.flatMap((skill) => skill.files.map((file) => file.resource));
	}

	/** A skill file by its exact URI. */
	file(uri: string): { bytes: Uint8Array; mimeType: string } | undefined {
		return this.#files.get(uri);
	}

	/**
	 * The direct children of a skill directory, by exact URI (S6), or `undefined` when `uri` is not
	 * the root or a subdirectory holding a file of a skill.
	 */
	directory(uri: string): Record<string, unknown>[] | undefined {
		const found = this.#directories.get(uri);
		if (!found) return undefined;
		const prefix = found.directory === '' ? '' : `${found.directory}/`;
		const children = new Map<string, Record<string, unknown>>();
		for (const file of found.skill.files) {
			if (!file.path.startsWith(prefix)) continue;
			const rest = file.path.slice(prefix.length);
			const slash = rest.indexOf('/');
			if (slash < 0) children.set(rest, file.resource);
			else {
				const subdirectory = rest.slice(0, slash);
				if (!children.has(subdirectory)) {
					children.set(subdirectory, {
						uri: `${uri}/${subdirectory}`,
						name: subdirectory,
						mimeType: DIRECTORY_MIME_TYPE,
					});
				}
			}
		}
		return [...children.entries()].sort(([a], [b]) => byBytes(a, b)).map(([, child]) => child);
	}
}

/**
 * Read a skill from a directory on disk: every regular file under `dir`, addressed by its path
 * relative to `dir`. A symbolic link that leaves the directory, a link to a directory and any
 * other non-regular file is refused (S2).
 *
 * @throws An error naming the skill and the problem.
 */
export async function skillFromDirectory(path: string, dir: string): Promise<Skill> {
	const fail = (problem: string) => new Error(`skill "${path}": ${problem}`);
	const root = await realpath(dir).catch((error: Error) => {
		throw fail(`cannot read ${dir}: ${error.message}`);
	});
	const files: Record<string, Uint8Array> = {};
	let count = 0;
	let total = 0;
	const pending: Array<{ directory: string; prefix: string }> = [{ directory: root, prefix: '' }];
	for (let next = pending.pop(); next; next = pending.pop()) {
		const { directory, prefix } = next;
		for (const name of await readdir(directory)) {
			const relative = `${prefix}${name}`;
			const location = `${directory}${sep}${name}`;
			let source = location;
			let info = await lstat(location);
			if (info.isSymbolicLink()) {
				source = await realpath(location).catch((error: Error) => {
					throw fail(`cannot follow ${relative}: ${error.message}`);
				});
				if (source !== root && !source.startsWith(`${root}${sep}`)) {
					throw fail(`${relative} is a symbolic link that leaves the skill's directory`);
				}
				info = await stat(source);
				if (info.isDirectory()) throw fail(`${relative} is a symbolic link to a directory`);
			}
			if (info.isDirectory()) {
				pending.push({ directory: source, prefix: `${relative}/` });
			} else if (info.isFile()) {
				count += 1;
				if (count > MAX_SKILL_FILES) throw fail(`has more than ${MAX_SKILL_FILES} files`);
				total += info.size;
				if (total > MAX_SKILL_BYTES) throw fail(`has more than ${MAX_SKILL_BYTES} bytes`);
				files[relative] = new Uint8Array(await readFile(source));
			} else {
				throw fail(`${relative} is not a regular file`);
			}
		}
	}
	return { path, files };
}

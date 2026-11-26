/**
 * @fileoverview Claude Code's limits on skills served over MCP, checked against a server's
 * `skills/list` manifest (spec/mcp-resources.md, S3).
 *
 * AFD's Skills extension accepts up to 512 files and 16 MiB a skill (S2). Claude Code accepts
 * much less, and drops what it cannot load without telling the server, so a catalog that is valid
 * for AFD can be partly invisible in Claude Code. These checks only warn: a server may serve
 * other clients. The limits come from Claude Code's documentation
 * (https://code.claude.com/docs/en/mcp#use-skills-from-mcp-servers, read 2026-11-26), which does
 * not say whether a KB is 1,000 or 1,024 bytes; the checks use 1,000, the lower bound.
 *
 * The manifest gives each file's URI and size but not its content, so files are classified by
 * name: a binary file is recognized by its suffix only. The 100-skill cap applies to every server.
 * The size and file rules apply only to skills Claude Code scans: those from claude.ai Directory
 * connectors and from custom connectors with organization scanning on, not a server added with
 * `claude mcp add`, so their findings say so.
 */

/** Claude Code's documented limits on an MCP server's skills. */
export const CLAUDE_CODE_SKILL_LIMITS = {
	/** Skills Claude Code shows from one server. */
	skillsPerServer: 100,
	/** Bytes of one text file. */
	textFileBytes: 100_000,
	/** Bytes of one skill's counted files together. */
	skillBytes: 400_000,
} as const;

/** The client whose limits these are, named in every finding. */
export const CLAUDE_CODE_SOURCE = 'Claude Code';

/** The rules {@link checkClaudeCodeSkillLimits} applies. */
export type SkillLimitRule =
	| 'claude-code-skill-count'
	| 'claude-code-file-size'
	| 'claude-code-skill-size'
	| 'claude-code-unsupported-file';

/** One file of a skill's manifest, as `skills/list` gives it. */
export interface SkillManifestResource {
	uri: string;
	/** The file's bytes; absent for a file whose content is dynamic. */
	size?: number;
	digest?: string;
}

/** One `skills/list` entry. */
export interface SkillManifestEntry {
	/** `skill://<skill path>/SKILL.md`. */
	uri: string;
	frontmatter?: Record<string, unknown>;
	/**
	 * The skill's manifest. Anything but an array (a dynamic skill, whose files are not listed)
	 * counts toward the number of skills but has no sizes to check.
	 */
	resources?: SkillManifestResource[] | unknown;
}

/** A skill, file or catalog that Claude Code may not load. Always a warning. */
export interface SkillLimitFinding {
	rule: SkillLimitRule;
	severity: 'warning';
	/** The skill's `name` (from its frontmatter, else its path's last segment). */
	skill: string;
	/** The file's path inside the skill, for a file rule. */
	file?: string;
	/** The client whose limit this is: always `'Claude Code'`. */
	source: typeof CLAUDE_CODE_SOURCE;
	message: string;
	suggestion: string;
	evidence: Record<string, unknown>;
}

/** Suffixes Claude Code neither scans nor counts toward a skill's size. */
const UNSCANNED_SUFFIXES = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'bmp',
	'ico',
	'svg',
	'pdf',
	'woff',
	'woff2',
	'ttf',
	'eot',
	'mp3',
	'mp4',
	'wav',
	'avi',
	'mov',
]);

/** Dependency lock files, which Claude Code neither scans nor counts. */
const LOCK_FILES = new Set([
	'package-lock.json',
	'npm-shrinkwrap.json',
	'pnpm-lock.yaml',
	'yarn.lock',
	'bun.lock',
	'bun.lockb',
	'cargo.lock',
	'poetry.lock',
	'uv.lock',
	'pipfile.lock',
	'pdm.lock',
	'gemfile.lock',
	'composer.lock',
	'go.sum',
	'flake.lock',
	'package.resolved',
	'packages.lock.json',
	'pubspec.lock',
	'mix.lock',
]);

/** Archives, which keep a skill from loading. */
const ARCHIVE_SUFFIXES = new Set([
	'zip',
	'tar',
	'gz',
	'tgz',
	'bz2',
	'xz',
	'zst',
	'7z',
	'rar',
	'jar',
	'whl',
]);

/** Other binary files, which keep a skill from loading. Known by suffix only. */
const BINARY_SUFFIXES = new Set([
	'webp',
	'avif',
	'heic',
	'tif',
	'tiff',
	'otf',
	'exe',
	'dll',
	'so',
	'dylib',
	'wasm',
	'bin',
	'class',
	'pyc',
	'o',
	'a',
	'sqlite',
	'db',
]);

/** Folders whose text keeps a skill from loading. */
const UNSUPPORTED_TEXT_FOLDERS = new Set(['dist']);

type FileKind = 'counted' | 'unscanned' | 'archive' | 'binary' | 'built-text';

function classify(path: string): FileKind {
	const segments = path.split('/');
	const base = (segments.at(-1) ?? '').toLowerCase();
	const dot = base.lastIndexOf('.');
	const suffix = dot > 0 ? base.slice(dot + 1) : '';
	if (UNSCANNED_SUFFIXES.has(suffix) || LOCK_FILES.has(base)) {
		return 'unscanned';
	}
	if (ARCHIVE_SUFFIXES.has(suffix)) return 'archive';
	if (BINARY_SUFFIXES.has(suffix)) return 'binary';
	if (
		segments.slice(0, -1).some((segment) => UNSUPPORTED_TEXT_FOLDERS.has(segment.toLowerCase()))
	) {
		return 'built-text';
	}
	return 'counted';
}

/** `skill://<skill path>/SKILL.md` → `<skill path>`; `undefined` for any other URI. */
function skillPathOf(uri: string): string | undefined {
	const match = /^skill:\/\/(.+)\/SKILL\.md$/.exec(uri);
	return match?.[1];
}

function skillNameOf(entry: SkillManifestEntry, path: string | undefined): string {
	const name = entry.frontmatter?.name;
	if (typeof name === 'string' && name.length > 0) return name;
	return path?.split('/').at(-1) ?? entry.uri;
}

/**
 * A resource's path inside its skill, or its whole path when it is not under the skill: the URI's
 * path before any `?` or `#`, percent-decoded, so `vendor%2Ezip` is an archive and
 * `image.png?v=3` an image.
 */
function filePathOf(resourceUri: string, skillPath: string | undefined): string {
	const prefix = skillPath === undefined ? undefined : `skill://${skillPath}/`;
	const relative =
		prefix && resourceUri.startsWith(prefix) ? resourceUri.slice(prefix.length) : resourceUri;
	const path = relative.split(/[?#]/, 1)[0] ?? relative;
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

/** A manifest member the check can read: an object with a string `uri`. */
function isResource(value: unknown): value is SkillManifestResource {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { uri?: unknown }).uri === 'string'
	);
}

function bytes(count: number): string {
	return `${count.toLocaleString('en-US')} bytes`;
}

const UNSUPPORTED_REASONS: Record<Exclude<FileKind, 'counted' | 'unscanned'>, string> = {
	archive: 'is an archive',
	binary: 'is a binary file Claude Code does not accept',
	'built-text': 'is text in a build folder (dist/)',
};

/**
 * Check a `skills/list` manifest against Claude Code's limits: at most 100 skills a server,
 * 100 KB a text file and 400 KB a skill (images, fonts, media and dependency lock files are not
 * counted), and no archive, other binary file or text under `dist/` in a skill.
 *
 * @returns one warning per skill, file or catalog over a limit, in catalog order; empty when
 * Claude Code can load the whole catalog
 */
export function checkClaudeCodeSkillLimits(
	entries: readonly SkillManifestEntry[]
): SkillLimitFinding[] {
	const findings: SkillLimitFinding[] = [];
	const limits = CLAUDE_CODE_SKILL_LIMITS;
	const finding = (
		rule: SkillLimitRule,
		skill: string,
		message: string,
		suggestion: string,
		evidence: Record<string, unknown>,
		file?: string
	): SkillLimitFinding => ({
		rule,
		severity: 'warning',
		skill,
		...(file === undefined ? {} : { file }),
		source: CLAUDE_CODE_SOURCE,
		message,
		suggestion,
		evidence,
	});

	const names: string[] = [];
	for (const entry of entries) {
		const skillPath = skillPathOf(entry.uri);
		const skill = skillNameOf(entry, skillPath);
		names.push(skill);
		let counted = 0;
		const resources: unknown[] = Array.isArray(entry.resources) ? entry.resources : [];
		for (const resource of resources) {
			// A member without a uri cannot be named or classified; the caller reports it.
			if (!isResource(resource)) continue;
			const file = filePathOf(resource.uri, skillPath);
			const size =
				typeof resource.size === 'number' && Number.isFinite(resource.size) && resource.size > 0
					? resource.size
					: 0;
			const kind = classify(file);
			if (kind === 'unscanned') continue;
			if (kind !== 'counted') {
				findings.push(
					finding(
						'claude-code-unsupported-file',
						skill,
						`Skill '${skill}': '${file}' ${UNSUPPORTED_REASONS[kind]}, so Claude Code does not load this skill where it scans it (a claude.ai Directory connector, or a connector with organization scanning)`,
						`If the server is offered as a scanned connector, remove '${file}' from the skill or serve it outside the skill`,
						{ file, kind },
						file
					)
				);
				continue;
			}
			counted += size;
			if (size > limits.textFileBytes) {
				findings.push(
					finding(
						'claude-code-file-size',
						skill,
						`Skill '${skill}': '${file}' is ${bytes(size)}, over Claude Code's limit of 100 KB a text file for a skill it scans`,
						`If the server is offered as a scanned connector, split '${file}' into files of at most ${bytes(limits.textFileBytes)}`,
						{ file, size, limit: limits.textFileBytes },
						file
					)
				);
			}
		}
		if (counted > limits.skillBytes) {
			findings.push(
				finding(
					'claude-code-skill-size',
					skill,
					`Skill '${skill}' is ${bytes(counted)}, over Claude Code's limit of 400 KB for a skill it scans`,
					`If the server is offered as a scanned connector, shrink '${skill}' to at most ${bytes(limits.skillBytes)} of text or split it into several skills (images, fonts, media and lock files do not count)`,
					{ size: counted, limit: limits.skillBytes }
				)
			);
		}
	}

	if (names.length > limits.skillsPerServer) {
		const hidden = names.slice(limits.skillsPerServer);
		const listed = hidden.slice(0, 5).map((name) => `'${name}'`);
		const more = hidden.length > listed.length ? `, and ${hidden.length - listed.length} more` : '';
		findings.push(
			finding(
				'claude-code-skill-count',
				hidden[0] as string,
				`The catalog has ${names.length} skills; Claude Code shows up to ${limits.skillsPerServer} a server, so it may not show ${listed.join(', ')}${more}`,
				`Serve at most ${limits.skillsPerServer} skills from one server, or split the catalog across servers`,
				{ count: names.length, limit: limits.skillsPerServer, skills: hidden }
			)
		);
	}
	return findings;
}

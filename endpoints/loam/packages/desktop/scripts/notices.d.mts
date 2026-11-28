export interface Package {
	kind: 'crate' | 'npm' | 'workspace';
	name: string;
	version: string;
	license: string | null;
	authors: string[];
	url: string | null;
	files: NoticeFile[];
}

export interface NoticeFile {
	label: string;
	file: string;
}

export interface Supplement {
	label: string;
	file: string;
	ownLicense?: boolean;
}

export interface ResolvedPackage extends Package {
	standard: boolean;
	notices: { label: string; text: string }[];
}

export interface ModuleRecord {
	resolveFrom: string;
	modules: string[];
}

export const LICENSE_TEXTS: string;
export const SUPPLEMENTS: Record<string, Supplement[]>;
export const DESKTOP_TARGETS: string[];
export function normalizeText(text: string): string;
export function noticeFilesIn(
	dir: string,
	options?: { base?: string; recursive?: boolean }
): NoticeFile[];
export function licenseIds(expression: string): string[];
export function resolveNotices(
	packages: Package[],
	options?: { licenseTexts?: string; supplements?: Record<string, Supplement[]> }
): ResolvedPackage[];
export function rustCrates(metadata: unknown): Package[];
export function findPackage(name: string, from: string): string;
export function packageRootOf(path: string): string | null;
export function isFirstPartyLicense(text: string): boolean;
export function readModuleRecord(file: string): ModuleRecord;
export function npmPackages(
	records: ModuleRecord[],
	options: { repoRoot: string; extra?: string[] }
): Package[];
export function dedupePackages(packages: Package[]): Package[];
export function renderNotices(options: {
	product: string;
	version: string;
	preamble?: string[];
	sections: { title: string; packages: ResolvedPackage[] }[];
}): string;

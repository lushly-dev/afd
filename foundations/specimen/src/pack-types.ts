/** Public contracts for building, checking and exporting a component pack. */

/** One library's component pack, as `specimen pack` builds it and `specimen pack-export` stamps it. */
export interface PackConfig {
	/** The library's id in the pack, such as `example`. */
	library: string;
	/** Its name, as people read it; export writes it into the catalog. */
	title: string;
	/** The tag prefix: every component whose tag starts with it gets a record. */
	prefix: string;
	/** The committed form's root, which holds `data/` and `rules/`, relative to the configuration. */
	directory: string;
	/** The package that ships the components, whose name and version export stamps, relative to the configuration. */
	package: string;
	/**
	 * The import specifier that registers a component: `{module}` is the module the manifest names,
	 * `{tag}` the tag and `{name}` the tag without the prefix. No import is recorded without it.
	 */
	import?: string;
	/** The most examples a record keeps, the first by case id. Defaults to 3. */
	examples?: number;
}
/** Build the configured library's pack and write it, or check it against the committed one. */
export interface PackRequest {
	/**
	 * Rebuild one component's record. Its cases come from the index the last full build wrote,
	 * when the sources are unchanged since; otherwise every case runs, and the report says why.
	 */
	component?: string;
	timeoutMs?: number;
	/** Cases run at once; defaults to `test.workers` in the configuration, then 2. */
	workers?: number;
	/** Cases allowed to fail: a pack is written from a run with failed cases only when each is named. */
	allowFailed?: string[];
}
/** What a written or checked pack reports, without its files. */
export type PackReport = Omit<PackBuildRun, 'files'> & {
	/** The committed form's root. */
	directory: string;
};
export interface PackRun extends PackReport {
	/** Records and rules written, and records removed because their tag is gone. */
	written: string[];
	removed: string[];
}
export interface PackCheckRun extends PackReport {
	/** Whether the committed records are the ones this run builds, from a sound run. */
	valid: boolean;
	/** Committed files that differ, that a build adds, and that a build no longer writes. */
	changed: string[];
	added: string[];
	removed: string[];
}
/** Write the exported form, with no browser, from the committed records. */
export interface PackExportRequest {
	/** The pack's root, which `data/` and `rules/` go into; created when missing. */
	directory: string;
	/** The Git revision the records come from, recorded in the catalog. */
	revision?: string;
}
export interface PackExportRun {
	library: string;
	directory: string;
	/** The pack digest the catalog records. */
	digest: string;
	files: string[];
	/** Whether a `pack.toml` at the root was kept. */
	keptPackToml: boolean;
}
/** Which cases rendered each tag in a full build, and the sources that build ran on. */
export interface PackIndex {
	/** The bench bundle's digest: every module the cases load. */
	bundle: string;
	/** The configuration's digest. */
	config: string;
	/** Case ids by tag; a case that failed is listed under every tag, since it may render any. */
	cases: Record<string, string[]>;
}
/** Build a library's pack: every case, twice, or one component's cases. */
export interface PackBuildRequest {
	component?: string;
	timeoutMs?: number;
	/** Cases run at once; defaults to `test.workers` in the configuration, then 2. */
	workers?: number;
	/** The index a full build wrote, which narrows a one-component build to its cases. */
	index?: PackIndex;
}
/** A pack built from a run, not yet written. */
export interface PackBuildRun {
	library: string;
	/** The committed form, by path relative to the pack's root. */
	files: Record<string, string>;
	/** What `checkPack` finds in them; none when the build is sound. */
	problems: { code: string; path: string; at?: string; message: string }[];
	/** Each component's gaps: what its record is missing. */
	components: { tag: string; gaps: { kind: string; section?: string; name?: string }[] }[];
	/** What the build left out of a record, such as a manifest text over its limit. */
	omitted: { tag: string; field: string; reason: string }[];
	guides: {
		verified: number;
		authored: number;
		invalidClaims: { specimen: string; target: string; obligation: string; reason: string }[];
		claimed: number;
	};
	examples: { kept: number; leftOut: { tag: string; from: string; reason: string }[] };
	/** Which cases ran: all of them, or one component's from the index. */
	selection: {
		component: string | null;
		/** Whether the cases that ran are every case that renders the component. */
		complete: boolean;
		reason: string;
	};
	/** A full build's index, for later one-component builds. */
	index?: PackIndex;
	cases: {
		total: number;
		/** Cases that passed in both passes and showed the same both times. */
		passed: number;
		/** Cases that failed in a pass after their retry; they contribute nothing. */
		failed: { id: string; message: string }[];
		/** Cases that failed once and were run again. */
		retried: string[];
		/** Cases that passed but showed something different in each pass; they contribute nothing. */
		unstable: string[];
		skipped: number;
	};
	elapsedMs: number;
}

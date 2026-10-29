const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const RELATIVE_BASE = "http://violet.invalid/";

/**
 * Returns true when `href` is safe to render as a link target: an http(s) or
 * mailto URL, or a relative URL. Everything else (javascript:, data:, vbscript:,
 * blob:, file:, unparsable values) is rejected.
 *
 * Uses the URL parser, so obfuscated schemes such as `java\tscript:` are caught.
 */
export function isSafeLinkHref(href: string | null | undefined): boolean {
    if (!href) {
        return false;
    }

    try {
        return SAFE_PROTOCOLS.has(new URL(href, RELATIVE_BASE).protocol);
    } catch {
        return false;
    }
}

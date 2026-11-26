// Node-type checks for the runtime theme's targets. Node types, not `instanceof`: a document or
// shadow root from another window (an iframe's) is not an instance of this window's `Document` or
// `ShadowRoot`. Internal: not exported from the package root or any subpath.

/**
 * Whether `target` is a shadow root, from any window.
 *
 * @internal
 */
export function isShadowRoot(target: unknown): target is ShadowRoot {
  return (target as Node | null)?.nodeType === 11 && "host" in (target as object);
}

/**
 * Whether `target` is a document, from any window.
 *
 * @internal
 */
export function isDocument(target: unknown): target is Document {
  return (target as Node | null)?.nodeType === 9;
}

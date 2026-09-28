/**
 * @fileoverview The version of the AFD contract this package implements.
 */

/**
 * The AFD contract version (`spec/VERSION` in the repository) that this implementation follows.
 *
 * The contract covers the wire shapes, the pipeline variables, the behavior vectors and the todo
 * conformance suite that every AFD language shares. Its `MAJOR.MINOR` version is independent of
 * the package version: implementations that report the same contract version are meant to agree
 * on everything it covers. It reads `1.0-rc` until every language loads every vector file.
 *
 * `afd-help` reports it as `contractVersion`.
 */
export const AFD_CONTRACT_VERSION = '1.0-rc';

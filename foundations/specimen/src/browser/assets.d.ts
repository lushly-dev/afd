/** A file's served URL, as Vite and the native host resolve a `?url` import. */
declare module '*.css?url' {
	const url: string;
	export default url;
}

declare module '*.css?inline' {
	const css: string;
	export default css;
}

declare module '*?raw' {
	const text: string;
	export default text;
}

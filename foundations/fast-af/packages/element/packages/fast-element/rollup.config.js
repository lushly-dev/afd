import terser from "@rollup/plugin-terser";

// The bundles start from the JavaScript build:tsc emits to dist/esm, so every output comes
// from one compiler run and the build needs no TypeScript compiler API (TypeScript 7 has none).
// Run build:tsc first; pnpm run build does.

// tsc inlines its helpers as `var __rest = (this && this.__rest) || function ...`; at the top
// of an ES module `this` is undefined, so the inline function is used either way. Every other
// THIS_IS_UNDEFINED warning still reaches the log.
const onwarn = (warning, warn) => {
    const helper = /\(this && this\.__\w+\)/;
    if (warning.code === "THIS_IS_UNDEFINED" && helper.test(warning.frame ?? "")) {
        return;
    }
    warn(warning);
};

export default [
    {
        input: "dist/esm/index.rollup.js",
        output: [
            {
                file: "dist/fast-element.js",
                format: "esm",
            },
            {
                file: "dist/fast-element.min.js",
                format: "esm",
                plugins: [terser()],
            },
        ],
        onwarn,
    },
    {
        input: "dist/esm/index.rollup.debug.js",
        output: [
            {
                file: "dist/fast-element.debug.js",
                format: "esm",
            },
            {
                file: "dist/fast-element.debug.min.js",
                format: "esm",
                plugins: [terser()],
            },
        ],
        onwarn,
    },
];

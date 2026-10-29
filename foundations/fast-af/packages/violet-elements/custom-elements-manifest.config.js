import { fastAttrPlugin } from "./scripts/cem-fast-attr-plugin.mjs";

export default {
  globs: ["src/**/*.ts"],
  outdir: "./",
  packagejson: false,
  exclude: [
    "src/**/*.stories.ts",
    "src/**/*.spec.ts",
    "src/**/index.ts",
    "src/icon/generated/**/*.ts",
  ],
  plugins: [fastAttrPlugin()],
};

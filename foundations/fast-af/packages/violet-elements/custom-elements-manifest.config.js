import { fastAttrPlugin } from "./scripts/cem-fast-attr-plugin.mjs";
import { literalAliasPlugin } from "./scripts/cem-literal-alias-plugin.mjs";

export default {
  globs: ["src/**/*.ts"],
  outdir: "./",
  packagejson: false,
  exclude: [
    "src/**/*.stories.ts",
    "src/**/*.spec.ts",
    "src/**/index.ts",
    // Define modules and the register-everything module hold no element; the package's exports list them.
    "src/**/*.define.ts",
    "src/all.ts",
    "src/icon/generated/**/*.ts",
  ],
  plugins: [fastAttrPlugin(), literalAliasPlugin()],
};

import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";


export default [
  {ignores: ["dist/", "coverage/"]},
  {files: ["**/*.{js,mjs,cjs,ts}"]},
  {files: ["**/*.js"], languageOptions: {sourceType: "es2020"}},
  {languageOptions: { globals: globals.node }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Test mocks legitimately lean on `any` for flexible fakes/spies — not worth
    // the churn of precise typing across hundreds of mock call sites.
    files: ["src/__tests__/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

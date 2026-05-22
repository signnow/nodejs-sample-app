/* eslint-disable */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, es2022: true },
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "no-console": "off"
  },
  ignorePatterns: ["dist/", "node_modules/"]
};

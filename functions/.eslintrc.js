module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "lib/**/*", // Ignore built files.
    "generated/**/*", // Ignore generated files.
    "node_modules/**/*",
  ],
  plugins: [
    "@typescript-eslint",
  ],
  rules: {
    "quotes": ["error", "double"],
    "indent": ["error", 2],
    "@typescript-eslint/no-unused-expressions": "off",
    "@typescript-eslint/no-unused-vars": "off", // TypeScript handles this
    "no-unused-expressions": "off",
    "no-unused-vars": "off", // TypeScript handles this
  },
};

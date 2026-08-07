import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "lib/generated/**",
      "ignore_old/**",
      "public/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;

import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    ignores: [
      ".next/**",
      ".runtime/**",
      "out/**",
      "test-results/**",
      "playwright-report/**",
      "node_modules/**",
      "next-env.d.ts"
    ]
  }
];

export default eslintConfig;

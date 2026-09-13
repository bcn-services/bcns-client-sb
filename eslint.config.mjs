import { next } from "@bcn-services/config/eslint/next";

export default [
  ...next,
  {
    // design/ is the vendored Claude Design artboard export, not app source.
    ignores: ["node_modules/**", ".next/**", "next-env.d.ts", "design/**"],
  },
];

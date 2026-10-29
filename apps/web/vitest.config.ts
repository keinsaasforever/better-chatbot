import { defineConfig } from "vitest/config";

import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
  // Next compiles JSX with the automatic runtime (tsconfig `jsx: "preserve"`,
  // React 19), so no component imports `React`. esbuild otherwise defaults to
  // the classic transform here and every rendered component test dies on
  // "React is not defined".
  esbuild: { jsx: "automatic" },
  test: {
    exclude: ["**/tests/**", "**/node_modules/**"],
  },
});

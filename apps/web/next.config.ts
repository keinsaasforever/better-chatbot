import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const BUILD_OUTPUT = process.env.NEXT_STANDALONE_OUTPUT
  ? "standalone"
  : undefined;

export default () => {
  const nextConfig: NextConfig = {
    output: BUILD_OUTPUT,
    // Workspace packages ship TypeScript source; Next must transpile them.
    transpilePackages: [
      "@keinsaas/mcp-types",
      "@keinsaas/mcp-core",
      "@keinsaas/mcp-router",
      "@keinsaas/workflow-dashboard-kit",
    ],
    // Native binding (a .node file) used to rasterize PDF pages for vision
    // models. Bundling it breaks the require of the platform-specific binary,
    // so Next must leave it to the Node runtime to resolve.
    serverExternalPackages: ["@napi-rs/canvas"],
    cleanDistDir: true,
    devIndicators: {
      position: "bottom-right",
    },
    env: {
      NO_HTTPS: process.env.NO_HTTPS,
    },
    experimental: {
      taint: true,
      authInterrupts: true,
    },
  };
  const withNextIntl = createNextIntlPlugin();
  return withNextIntl(nextConfig);
};

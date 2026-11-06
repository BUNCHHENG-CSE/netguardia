import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,
  poweredByHeader: false,
  compress: true,
  serverExternalPackages: ["@prisma/client", "pg"],
  experimental: {
    turbopackRustReactCompiler: true,
    turbopackLazyDynamicImports: true,
    turbopackLazyDynamicImportsSSR: true,
    turbopackGc: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;


import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: currentDir,
  },
  async rewrites() {
    return [
      {
        source: "/admin/:path*",
        destination: "http://127.0.0.1:8000/admin/:path*",
      },
      {
        source: "/static/admin/:path*",
        destination: "http://127.0.0.1:8000/static/admin/:path*",
      },
    ];
  },
};

export default nextConfig;

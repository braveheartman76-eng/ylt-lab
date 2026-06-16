import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'jszip', 'canvas'],
};

export default nextConfig;

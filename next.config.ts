import type { NextConfig } from 'next';

// Optional sub-path the site is served under when fronted by a reverse proxy.
// Injected at build time by the Mobeus deploy service from `site.pathPrefix` in
// platform.yaml. Empty = serve at the domain root (the default).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;

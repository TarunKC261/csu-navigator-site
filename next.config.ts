import type { NextConfig } from 'next';

// Optional sub-path the site is served under when fronted by a reverse proxy
// (e.g. "/ai/works/ai-expert" behind a customer's CloudFront). Injected at
// build time by the deploy service from `site.pathPrefix` in platform.yaml.
// Empty = serve at the domain root (the default).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // @mediapipe/tasks-vision ships a prebuilt ESM bundle; Next must transpile it
  // so the lazily-imported AirVision chunk is emitted/served correctly.
  transpilePackages: ['@mediapipe/tasks-vision'],
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;

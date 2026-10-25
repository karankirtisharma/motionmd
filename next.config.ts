import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.MD_BUILD_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/assets/scene-manifest.json', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      // URLs carrying ?v=<content hash> (asset-versions.json) never change: cache for a year.
      { source: '/assets/:path*', has: [{ type: 'query', key: 'v' }], headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/assets/asset-versions.json', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
    ];
  },
};
export default nextConfig;

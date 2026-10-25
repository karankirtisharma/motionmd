import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.MD_BUILD_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/assets/scene-manifest.json', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
    ];
  },
};
export default nextConfig;

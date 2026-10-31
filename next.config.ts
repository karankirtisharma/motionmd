import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.MD_BUILD_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  images: { qualities: [75, 90] },
  async headers() {
    return [
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/asset-delivery/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/asset-delivery/:file*.br', headers: [{ key: 'Content-Encoding', value: 'br' }, { key: 'Content-Type', value: 'model/gltf-binary' }] },
      { source: '/asset-delivery/:file*.gz', headers: [{ key: 'Content-Encoding', value: 'gzip' }, { key: 'Content-Type', value: 'model/gltf-binary' }] },
      { source: '/assets/scene-manifest.json', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
    ];
  },
};
export default nextConfig;

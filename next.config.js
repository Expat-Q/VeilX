/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    outputFileTracingIncludes: {
      '/api/**': ['./crates/veilx-wallet/pkg/**/*'],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pbs.twimg.com',
      },
      {
        protocol: 'https',
        hostname: 'abs.twimg.com',
      },
    ],
  },
  async rewrites() {
    // 1. If running on Render itself, do NOT rewrite (prevents proxying to self in an infinite loop)
    if (process.env.RENDER === "true" || process.env.IS_RENDER === "true") {
      return [];
    }

    const rawBackendUrl = process.env.RENDER_BACKEND_URL;
    if (!rawBackendUrl || !rawBackendUrl.trim()) return [];

    // 2. Strip trailing slashes to prevent double slash (//api) 308 redirect loops
    const backendUrl = rawBackendUrl.trim().replace(/\/+$/, "");

    return [
      {
        source: '/api/cron/:path*',
        destination: `${backendUrl}/api/cron/:path*`,
      },
      {
        source: '/api/sync/:path*',
        destination: `${backendUrl}/api/sync/:path*`,
      },
      {
        source: '/api/requests/:id/retry-forward',
        destination: `${backendUrl}/api/requests/:id/retry-forward`,
      },
      {
        source: '/api/paylinks/:slug/retry-forward',
        destination: `${backendUrl}/api/paylinks/:slug/retry-forward`,
      },
      {
        source: '/api/tips/:id/claim',
        destination: `${backendUrl}/api/tips/:id/claim`,
      },
      {
        source: '/api/tips/claim-all',
        destination: `${backendUrl}/api/tips/claim-all`,
      },
    ];
  },
};

module.exports = nextConfig;

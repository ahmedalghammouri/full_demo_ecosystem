import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  // Self-contained server bundle — the production Docker stage copies
  // .next/standalone and runs `node server.js` (see apps/web/Dockerfile)
  output: 'standalone',

  // Pin the standalone file-tracing root to THIS app so the output is
  // flat (.next/standalone/server.js). Without this, Next infers the
  // tracing root from turbopack.root (the monorepo root) and nests the
  // bundle under .next/standalone/app/server.js, which breaks the
  // Docker image's `node server.js` entrypoint.
  outputFileTracingRoot: __dirname,

  // Make the Next server self-sufficient on its own port.
  //
  // The browser client deliberately calls SAME-ORIGIN so the app works from any
  // device on the network. Behind nginx that resolves correctly, but hitting the
  // Next server directly on :3000 sent /api/* to a server with no API routes —
  // the page rendered and every number came back empty, which looks exactly like
  // a broken database and is the worst possible thing to debug live.
  //
  // Proxying here means both ports work. Nginx stays the production entry point;
  // this is what stops a wrong port from looking like missing data.
  //
  // API_PROXY_TARGET is read ONCE, at build time: Next resolves rewrites() and
  // bakes the destination into routes-manifest.json. It must therefore be a
  // Docker build arg — setting it at runtime changes nothing, and the fallback
  // below then points at nothing inside the container.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET || 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${target}/socket.io/:path*` },
    ];
  },

  // Turbopack's filesystem root is THIS app, not the monorepo.
  //
  // It previously pointed two levels up so a Tailwind content glob could reach
  // `../../packages/ui` — a package that does not exist in this repository. In
  // the container only `apps/web` is mounted, so `../..` resolves above the
  // filesystem root and Turbopack panics with "leaves the filesystem root"
  // before it can write the app endpoint. The glob is gone, so the root can sit
  // where it belongs and the same config now works on the host and in Docker.
  turbopack: {
    root: __dirname,
  },

  images: {
    domains: ['localhost', 'industry360.sa', 'storage.industry360.sa', 'demo.industry360.sa', 'storage.industry360.sa'],
    formats: ['image/avif', 'image/webp'],
  },

  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'echarts',
      'recharts',
      'framer-motion',
      '@tanstack/react-query',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-tabs',
      '@radix-ui/react-popover',
    ],
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },

};

export default nextConfig;

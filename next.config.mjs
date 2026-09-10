/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output is what the Docker image copies; `next start` in local dev warns
  // about it, so it is opt-in via the build environment instead of always on.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  experimental: {
    // Server Actions are used for all mutations issued from the UI shell.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;

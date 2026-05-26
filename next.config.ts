import type { NextConfig } from 'next';

const config: NextConfig = {
  // Card art proxy → karabast-data S3. We don't want production users
  // hotlinking karabast's bucket directly; route through our own origin
  // so we control caching and can swap the source later.
  async rewrites() {
    return [
      {
        source: '/card-art/:path*',
        destination: 'https://karabast-data.s3.amazonaws.com/cards/:path*',
      },
    ];
  },
  // The lifted forceteki renderer hardcodes some <Image> srcs to
  // karabast-data S3 (resource icons, etc). Whitelist the host so
  // next/image will accept them. Long term, mirror these assets into
  // our own static dir.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'karabast-data.s3.amazonaws.com',
        pathname: '/**',
      },
    ],
  },
};

export default config;

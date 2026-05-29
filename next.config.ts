import type { NextConfig } from 'next';

const config: NextConfig = {
  // Card art proxy → karabast-data S3. We don't want production users
  // hotlinking karabast's bucket directly; route through our own origin
  // so we control caching and can swap the source later.
  //
  // Path shape on karabast's S3 is `cards/<SET>/<LANG>/standard/large/<N>.webp`.
  // Older sets (e.g. SEC) are ALSO mirrored at `cards/<SET>/standard/...`
  // without the locale segment — that's why our pre-locale builder worked
  // for old cards. Newer sets (ASH onward) are locale-only, so we need to
  // route through `en/` to find them. Inject the `en` segment ourselves
  // and keep the API surface (`/card-art/<SET>/standard/...`) unchanged.
  async rewrites() {
    return [
      {
        source: '/card-art/:set/:rest*',
        destination: 'https://karabast-data.s3.amazonaws.com/cards/:set/en/:rest*',
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
  // Test-mode dependencies that ship a runtime WASM payload — bundlers
  // mangle their internal file paths. Marking them external so they
  // load from node_modules at runtime. Prod build doesn't import them
  // (KARABUDDY_DB_DRIVER=pglite is test-only); listing them here is
  // free in production since they're never imported.
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default config;

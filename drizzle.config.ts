import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// B74: mirror Next's env precedence — .env.development.local (local Docker
// DB overrides) wins over .env.local (Vercel-pulled prod). dotenv doesn't
// overwrite already-set keys, so loading the override file FIRST makes its
// POSTGRES_URL_NON_POOLING stick; .env.local fills in anything it omits.
// So `db:migrate` hits the local dev DB when the override file is present,
// and prod (via .env.local) otherwise.
config({ path: '.env.development.local' });
config({ path: '.env.local' });

export default defineConfig({
  schema: './lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.POSTGRES_URL_NON_POOLING!,
  },
});

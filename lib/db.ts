import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export function getDb() {
  const sql = neon(process.env.POSTGRES_URL!);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof getDb>;

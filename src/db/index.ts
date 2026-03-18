/**
 * Database connection — PostgreSQL via postgres.js + Drizzle ORM
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (db) return db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  const sql = postgres(url, { max: 10 });
  db = drizzle(sql, { schema });
  return db;
}

export type Database = ReturnType<typeof getDb>;

export { schema };

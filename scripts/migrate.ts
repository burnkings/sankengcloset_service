import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { max: 1 });
try {
  const migration = await readFile(resolve(process.cwd(), 'migrations/0001_initial.sql'), 'utf8');
  await sql.unsafe(migration);
  console.log('Applied migrations/0001_initial.sql');
} finally {
  await sql.end();
}

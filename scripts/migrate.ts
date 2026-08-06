import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { max: 1 });

try {
  await sql`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const directory = resolve(process.cwd(), 'migrations');
  const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const filename of files) {
    const alreadyApplied = await sql`select 1 from schema_migrations where filename = ${filename}`;
    if (alreadyApplied.length > 0) continue;
    const migration = await readFile(resolve(directory, filename), 'utf8');
    // migration source is repository-controlled; user input never reaches unsafe().
    await sql.begin(async (tx) => {
      await tx.unsafe(migration);
      await tx`insert into schema_migrations (filename) values (${filename})`;
    });
    console.log(`Applied migrations/${filename}`);
  }
} finally {
  await sql.end();
}

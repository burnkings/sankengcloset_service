// 可重现的空库结构验证；只运行在内存PostgreSQL，不接触线上数据库。
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdir,readFile } from 'node:fs/promises';
import type { ImportDB as CatalogDB } from '../src/catalog/import-products.js';
export async function catalogTestDB() {
  const pg=new PGlite({extensions:{pg_trgm}});
  for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
    try {await pg.exec(await readFile(`migrations/${file}`,'utf8'));}
    catch(e){await pg.close();throw new Error(`Migration ${file}: ${String(e)}`);}
  }
  function wrap(client:any):CatalogDB {return {
    query:async(q,p=[]) => (await client.query(q,p)).rows,
    transaction:async fn=>client.transaction((tx:any)=>fn(wrap(tx))),
  };}
  return {pg,db:wrap(pg)};
}

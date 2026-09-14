import { it, expect } from 'vitest';
import { catalogTestDB } from '../../scripts/catalog-db.js';
import { normalizeRows, importProducts } from '../../src/catalog/import-products.js';
import { PostgresRepository } from '../../src/repositories/postgres.js';
import { MemoryRepository } from '../../src/repositories/memory.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

it('favorite ranks the entire published catalog before limit; hot uses feed score', async () => {
  const { pg, db } = await catalogTestDB();
  try {
    const ids = await importProducts(db, normalizeRows([1,2,3].map(n => ({
      '商品名称':`商品${n}`, '商品链接':`https://item.taobao.com/item.htm?id=${1000+n}`,
      '店铺名称':'店铺', '坑向':'Lolita', '商品图片':'https://example.com/image.jpg'
    }))), true);
    await db.query('UPDATE products SET feed_score=100 WHERE id=$1', [ids[0]]);
    await db.query("UPDATE products SET visibility_status='draft' WHERE id=$1", [ids[2]]);
    await db.query("INSERT INTO users(id,nickname) VALUES ('u1','用户1'),('u2','用户2')");
    await db.query("INSERT INTO user_events(id,user_id,event_type,target_type,target_id) VALUES ('e1','u1','VIEW_PRODUCT','product',$1),('e2','u2','VIEW_PRODUCT','product',$1)", [ids[0]]);
    await db.query("INSERT INTO wishlist_items(id,user_id,title,status,product_id) VALUES ('w1','u1','收藏','WISH',$1),('w2','u2','收藏','WANT',$1),('w3','u1','草稿','WISH',$2)", [ids[1],ids[2]]);
    // Run the real repository SQL against PostgreSQL in memory, with the same tagged parameters.
    const repository = Object.create(PostgresRepository.prototype) as PostgresRepository;
    Object.defineProperty(repository, 'sql', {value: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, i) => text + (i > 0 ? `$${i}` : '') + chunk, '');
      return db.query(query, values);
    }});
    const favorite = await repository.getRanking('favorite', 1);
    expect(favorite[0]?.entityId).toBe(ids[1]);
    expect(favorite[0]?.favoriteCount).toBe(2);
    expect((await repository.getRanking('hot', 1))[0]?.entityId).toBe(ids[0]);
    expect((await repository.getRanking('hot', 1))[0]?.viewCount).toBe(2);
    expect((await repository.getRanking('favorite', 100)).map(row=>row.entityId)).not.toContain(ids[2]);
    await db.query("DELETE FROM wishlist_items WHERE id='w2'");
    expect((await repository.getRanking('favorite', 1))[0]?.favoriteCount).toBe(1);
  } finally { await pg.close(); }
}, 30000);

it('favorite tab reaches repository unchanged instead of silently requesting hot', async () => {
  const repository = new MemoryRepository();
  let actual = '';
  repository.getRanking = async tab => { actual = tab; return []; };
  const config = loadConfig({NODE_ENV:'test',DATA_DRIVER:'memory',JWT_SECRET:'test-secret-that-is-longer-than-32-characters',PUBLIC_BASE_URL:'http://localhost:8787',UPLOAD_DIR:'/tmp/sankeng-api-tests'});
  const app = await buildApp({config,repository,logger:false});
  try {
    const response = await app.inject({method:'GET',url:'/api/v1/ranking?tab=favorite'});
    expect(response.statusCode).toBe(200);expect(actual).toBe('favorite');expect(response.json().data).toEqual([]);
  } finally {await app.close();}
});

import { it, expect } from 'vitest';
import { catalogTestDB } from '../scripts/catalog-db.js';
import { PostgresRepository } from '../src/repositories/postgres.js';
import { normalizeRows, importProducts } from '../src/catalog/import-products.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

it('PostgreSQL API retains wardrobe fields and updates purchase reminder; styles coexist', async () => {
  const { pg, db } = await catalogTestDB();
  // Execute actual repository SQL, including transactions, against isolated PostgreSQL.
  function tagged(client: any): any {
    const sql: any = async (parts: TemplateStringsArray, ...values: unknown[]) =>
      (await client.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''), values)).rows;
    sql.json = (value: unknown) => JSON.stringify(value);
    sql.begin = (fn: any) => client.transaction((tx: any)=>fn(tagged(tx)));
    return sql;
  }
  const repo = Object.create(PostgresRepository.prototype) as PostgresRepository;
  Object.defineProperty(repo, 'sql', { value: tagged(pg) });
  repo.close = async () => {};
  const config = loadConfig({ NODE_ENV:'test',DATA_DRIVER:'memory',JWT_SECRET:'test-secret-that-is-longer-than-32-characters',PUBLIC_BASE_URL:'http://localhost:8787',UPLOAD_DIR:'/tmp/sankeng-self-check' });
  const app = await buildApp({ config, repository: repo, logger: false });
  try {
    await db.query("INSERT INTO users(id,nickname) VALUES ('selfcheck','Self check')");
    const headers = { authorization: `Bearer ${app.jwt.sign({sub:'selfcheck',kind:'access'})}` };
    const created = await app.inject({method:'POST',url:'/api/v1/me/wardrobe',headers,payload:{id:'wd_check',name:'马面裙',category:'HANFU',style:'马面裙',silhouette:'明制',wearStatus:'FREQUENT',purchasePrice:128.50}});
    expect(created.statusCode, created.body).toBe(201);
    const edit = await app.inject({method:'PATCH',url:'/api/v1/me/wardrobe/wd_check',headers,payload:{silhouette:'宋制'}});
    expect(edit.statusCode, edit.body).toBe(200);
    const listed = await app.inject({method:'GET',url:'/api/v1/me/wardrobe',headers});
    expect(listed.json().data[0]).toMatchObject({style:'马面裙',silhouette:'宋制',wearStatus:'FREQUENT',purchasePrice:128.5});
    const cleared = await app.inject({method:'PATCH',url:'/api/v1/me/wardrobe/wd_check',headers,payload:{category:'JK',silhouette:''}});
    expect(cleared.json().data.silhouette).toBe('');
    await repo.createUserAsset('selfcheck','purchase','pur_check',{name:'订单'});
    await repo.createUserAsset('selfcheck','reminder','rem_check',{type:'BALANCE',relatedPurchaseId:'pur_check',remindDate:'2026-09-15'});
    await repo.updateUserAsset('selfcheck','purchase','pur_check',{balanceDueDate:'2026-10-01'});
    expect((await repo.getUserAsset('selfcheck','reminder','rem_check'))?.payload.remindDate).toBe('2026-10-01');
    const [id] = await importProducts(db,normalizeRows([{'商品名称':'JSK与OP','商品链接':'https://item.taobao.com/item.htm?id=101010','店铺名称':'示例','坑向':'Lolita','商品图片':'https://example.com/p.jpg'}]),true);
    await db.query("INSERT INTO product_variants(id,product_id,name,style_name,color,size) VALUES ('v_jsk',$1,'白色S','JSK','白色','S'),('v_op',$1,'白色S','OP','白色','S')",[id]);
    const detail = await app.inject({method:'GET',url:`/api/v1/products/${id}`});
    expect(detail.statusCode,detail.body).toBe(200);
    expect(detail.json().data.variants.map((v:any)=>v.styleName).sort()).toEqual(['JSK','OP']);
  } finally { await app.close(); await pg.close(); }
},30000);

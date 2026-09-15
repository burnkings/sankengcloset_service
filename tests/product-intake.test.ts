import { describe,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { ImportDB } from '../src/catalog/import-products.js';
async function catalogTestDB(){
  const pg=new PGlite();
  try {await pg.exec(await readFile('database/blueprints/next-schema.sql','utf8'));}
  catch(error){await pg.close();throw error;}
  function wrap(client:any):ImportDB{return {
    query:async(sql,params=[]) => (await client.query(sql,params)).rows,
    transaction:async fn=>client.transaction((tx:any)=>fn(wrap(tx))),
  };}
  return {pg,db:wrap(pg)};
}
import { normalizeRows,importProducts } from '../src/catalog/import-products.js';
const row={'商品名称':'古早印花甜萌款','商品链接':'https://item.taobao.com/item.htm?id=1073028229062&tracking=1','店铺名称':'花与珍珠匣','坑向':'Lolita','商品图片':'https://img.alicdn.com/a.webp\nhttps://img.alicdn.com/b.webp','商品说明':'多个部件价格不同；原预售已结束，当前状态未确认'};
describe('单表商品采集',()=>{
  it('未知价格状态保留未知，不造品牌和SKU',()=>{const p=normalizeRows([row])[0]!;expect(p.priceType).toBe('UNKNOWN');expect(p.status).toBe('UNKNOWN');expect(p.brandName).toBe('');expect(p.sourceUrl).toBe('https://item.taobao.com/item.htm?id=1073028229062');});
  it('校验小数、重复来源和危险链接',()=>{expect(()=>normalizeRows([{...row,'参考全价（元）':'1.111'}])).toThrow();expect(()=>normalizeRows([row,row])).toThrow(/重复/);expect(()=>normalizeRows([{...row,'商品图片':'javascript:alert(1)'}])).toThrow();expect(normalizeRows([{...row,'参考全价（元）':'239.90'}])[0]!.priceCents).toBe(23990);});
  it('新14表建库、内嵌图片、重复更新与回滚',async()=>{
    const {pg,db}=await catalogTestDB();try{
      const products=normalizeRows([row]);const ids=await importProducts(db,products);
      const before=(await db.query('SELECT * FROM products WHERE id=$1',[ids[0]]))[0]!;
      expect(before.brand_id).toBeNull();expect(before.shop_name).toBe('花与珍珠匣');expect(before.visibility_status).toBe('draft');
      expect(await importProducts(db,products,true)).toEqual(ids);
      const after=(await db.query('SELECT * FROM products WHERE id=$1',[ids[0]]))[0]!;
      expect(after.visibility_status).toBe('published');expect(after.version).toBe(2);
      expect(after.images).toEqual(['https://img.alicdn.com/a.webp','https://img.alicdn.com/b.webp']);
      expect(after.price_cents).toBeNull();
      expect(after.variants).toEqual([]);
      const tables=await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      expect(tables).toHaveLength(14);
      expect(tables.map(t=>t.tablename)).not.toContain('price_snapshots');
      expect((await db.query('SELECT * FROM brands')).length).toBe(0);

      expect((await db.query('SELECT * FROM product_releases')).length).toBe(0);
      const bad={...products[0]!,pit:'INVALID',externalId:'another'};
      await expect(importProducts(db,[{...products[0]!,title:'应回滚'},bad],true)).rejects.toThrow();
      expect((await db.query('SELECT title FROM products WHERE id=$1',[ids[0]]))[0]!.title).toBe(row['商品名称']);
    }finally{await pg.close();}
  },30000);
});

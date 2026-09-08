import { createHash } from 'node:crypto';
export interface ImportDB {
  query(sql:string,params?:unknown[]):Promise<Record<string,any>[]>;
  transaction<T>(fn:(db:ImportDB)=>Promise<T>):Promise<T>;
}
const statuses:Record<string,string>={'未确认':'UNKNOWN','预告':'UPCOMING','现货':'ON_SALE','预售':'PRE_ORDER','售罄':'SOLD_OUT','已结束':'ENDED'};
const pits:Record<string,string>={'JK':'JK','Lolita':'LOLITA','LOLITA':'LOLITA','汉服':'HANFU'};
const id=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
function url(value:string){const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('链接须为 HTTP(S) 地址');return u;}
/** 一行一条来源商品；不推断 SKU、品牌、定金比例或发售时间。 */
export function normalizeRow(row:Record<string,string>){
  const get=(key:string)=>String(row[key]??'').trim();
  const title=get('商品名称'),shopName=get('店铺名称'),pit=pits[get('坑向')];
  if(!title||!shopName||!pit)throw new Error('请填写商品名称、店铺名称和坑向');
  const source=url(get('商品链接')),taobao=['item.taobao.com','detail.tmall.com'].includes(source.hostname);
  const externalId=taobao?source.searchParams.get('id'):null;
  if(taobao&&!/^\d+$/.test(externalId??''))throw new Error('商品链接缺少有效 id');
  source.hash='';if(taobao)source.search='?id='+externalId;
  const sourceUrl=source.toString(),platform=source.hostname==='detail.tmall.com'?'TMALL':taobao?'TAOBAO':'USER_SUBMIT';
  const images=[...new Set(get('商品图片').split(/[\n|]+/).map(s=>s.trim()).filter(Boolean))];
  if(!images.length||images.length>30)throw new Error('请填写 1—30 张商品图片链接，第一张为封面');images.forEach(v=>url(v));
  const price=get('参考全价（元）');
  if(price&&!/^\d+(\.\d{1,2})?$/.test(price))throw new Error('参考全价须为非负数，最多两位小数；定金或多款不同价请写商品说明');
  const cents=price?Math.round(Number(price)*100):0;if(cents>2147483647)throw new Error('价格超出支持范围');
  const status=statuses[get('销售状态')||'未确认'];if(!status)throw new Error('销售状态不在可选范围内');
  return {title,shopName,pit,sourceUrl,platform,externalId:externalId??id(sourceUrl),brandName:get('品牌名称'),subCategory:get('商品分类'),priceCents:cents,priceType:price?'FULL':'UNKNOWN',status,images,description:get('商品说明'),colors:[...new Set(get('颜色').split(/[、,，|\n]+/).map(s=>s.trim()).filter(Boolean))]};
}
export function normalizeRows(rows:Record<string,string>[]){
  const seen=new Set<string>();return rows.map((row,i)=>{try{const p=normalizeRow(row),key=p.platform+':'+p.externalId;if(seen.has(key))throw new Error('同一商品链接重复，请合并为一行');seen.add(key);return p;}catch(e){throw new Error(`第 ${i+2} 行：${String(e)}`);}});
}
/** 全表事务，保留已有商品 ID 和用户关系。默认待审草稿。 */
export async function importProducts(db:ImportDB,products:ReturnType<typeof normalizeRows>,publish=false){
  return db.transaction(async tx=>{const ids:string[]=[];
    for(const p of products){
      let brandId:string|null=null;
      if(p.brandName){const brands=await tx.query('SELECT id FROM brands WHERE name=$1 AND category=$2::pit_type AND deleted_at IS NULL',[p.brandName,p.pit]);if(brands.length)brandId=String(brands[0]!.id);else{brandId='brand_'+id(p.pit+':'+p.brandName);await tx.query('INSERT INTO brands(id,name,category) VALUES($1,$2,$3::pit_type)',[brandId,p.brandName,p.pit]);}}
      const rows=await tx.query(`INSERT INTO products
        (id,canonical_name,display_name,brand_id,shop_name,pit_type,category,source_platform,external_id,source_url,canonical_url,cover_url,images,description,color_tags,current_price,price_type,sale_status,visibility_status,review_status)
        VALUES($1,$2,$2,$3,$4,$5::pit_type,$6,$7::data_source,$8,$9,$9,$10,$11::text[],$12,$13::text[],$14,$15::price_type,$16::sale_status,$17::visibility_status,$18::review_status)
        ON CONFLICT(source_platform,external_id) WHERE external_id <> '' AND deleted_at IS NULL DO UPDATE SET
        canonical_name=excluded.canonical_name,display_name=excluded.display_name,brand_id=excluded.brand_id,
        shop_name=excluded.shop_name,pit_type=excluded.pit_type,category=excluded.category,source_url=excluded.source_url,
        canonical_url=excluded.canonical_url,cover_url=excluded.cover_url,images=excluded.images,description=excluded.description,
        color_tags=excluded.color_tags,current_price=excluded.current_price,price_type=excluded.price_type,
        original_price=0,deposit_price=0,balance_price=0,sale_status=excluded.sale_status,
        visibility_status=excluded.visibility_status,review_status=excluded.review_status,updated_at=now(),version=products.version+1
        RETURNING id`,['prod_'+id(p.platform+':'+p.externalId),p.title,brandId,p.shopName,p.pit,p.subCategory,p.platform,p.externalId,p.sourceUrl,p.images[0],p.images,p.description,p.colors,p.priceCents,p.priceType,p.status,publish?'published':'draft',publish?'APPROVED':'PENDING']);
      const productId=String(rows[0]!.id);ids.push(productId);
      await tx.query('DELETE FROM product_images WHERE product_id=$1',[productId]);
      for(const [i,image]of p.images.entries())await tx.query('INSERT INTO product_images(id,product_id,url,source_url,sort_order,is_cover) VALUES($1,$2,$3,$3,$4,$5)',['image_'+id(productId+':'+i),productId,image,i,i===0]);
    }return ids;
  });
}

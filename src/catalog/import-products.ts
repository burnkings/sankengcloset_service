import { createHash } from 'node:crypto';
export interface ImportDB {
  query(sql:string,params?:unknown[]):Promise<Record<string,any>[]>;
  transaction<T>(fn:(db:ImportDB)=>Promise<T>):Promise<T>;
}
const statuses:Record<string,string>={'未确认':'UNKNOWN','预告':'UPCOMING','现货':'ON_SALE','预售':'PRE_ORDER','售罄':'SOLD_OUT','已结束':'ENDED'};
const pits:Record<string,string>={'JK':'JK','Lolita':'LOLITA','LOLITA':'LOLITA','汉服':'HANFU'};
const id=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
function url(value:string){const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('链接须为 HTTP(S) 地址');return u;}

/** One source product row; no SKU inference, no brand/price guessing. */
export function normalizeRow(row:Record<string,string>){
  const get=(key:string)=>String(row[key]??'').trim();
  const title=get('商品名称'),shopName=get('店铺名称'),pit=pits[get('坑向')];
  if(!title||!shopName||!pit)throw new Error('请填写商品名称、店铺名称和坑向');
  const source=url(get('商品链接')),taobao=['item.taobao.com','detail.tmall.com'].includes(source.hostname);
  const externalId=taobao?source.searchParams.get('id'):null;
  if(taobao&&!/^\d+$/.test(externalId??''))throw new Error('商品链接缺少有效 id');
  source.hash='';if(taobao)source.search='?id='+externalId;
  const sourceUrl=source.toString(),platform=source.hostname==='detail.tmall.com'?'TMALL':taobao?'TAOBAO':'USER_SUBMIT';
  const rawImages=[...new Set(get('商品图片').split(/[\n|]+/).map(s=>s.trim()).filter(Boolean))];
  if(!rawImages.length||rawImages.length>30)throw new Error('请填写 1—30 张商品图片链接，第一张为封面');rawImages.forEach(v=>url(v));
  // Convert to image objects
  const images=rawImages.map(u=>({url:u,thumbnailUrl:null,width:null,height:null,sizeBytes:null,objectKey:null}));
  const price=get('参考全价（元）');
  if(price&&!/^\d+(\.\d{1,2})?$/.test(price))throw new Error('参考全价须为非负数，最多两位小数');
  const cents=price?Math.round(Number(price)*100):0;if(cents>2147483647)throw new Error('价格超出支持范围');
  const status=statuses[get('销售状态')||'未确认'];if(!status)throw new Error('销售状态不在可选范围内');
  return {title,shopName,pit,sourceUrl,platform,externalId:externalId??id(sourceUrl),brandName:get('品牌名称'),subCategory:get('商品分类'),priceCents:cents,priceType:price?'FULL':'UNKNOWN',status,images,description:get('商品说明'),colors:[...new Set(get('颜色').split(/[、,，|\n]+/).map(s=>s.trim()).filter(Boolean))]};
}

export function normalizeRows(rows:Record<string,string>[]){
  const seen=new Set<string>();return rows.map((row,i)=>{try{const p=normalizeRow(row),key=p.platform+':'+p.externalId;if(seen.has(key))throw new Error('同一商品链接重复，请合并为一行');seen.add(key);return p;}catch(e){throw new Error(`第 ${i+2} 行：${String(e)}`);}});
}

/** Full table transaction; preserves existing product IDs. Default draft. */
export async function importProducts(db:ImportDB,products:ReturnType<typeof normalizeRows>,publish=false){
  return db.transaction(async tx=>{const ids:string[]=[];
    for(const p of products){
      let brandId:string|null=null;
      if(p.brandName){const brands=await tx.query('SELECT id FROM brands WHERE name=$1 AND category=$2 AND deleted_at IS NULL',[p.brandName,p.pit]);if(brands.length)brandId=String(brands[0]!.id);else{brandId='brand_'+id(p.pit+':'+p.brandName);await tx.query('INSERT INTO brands(id,name,category) VALUES($1,$2,$3)',[brandId,p.brandName,p.pit]);}}
      const rows=await tx.query(`INSERT INTO products
        (id,title,brand_id,shop_name,category,sub_category,source_platform,external_id,canonical_url,
         images,description,color_tags,price_cents,price_type,sale_status,visibility_status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9::jsonb,$10,$11::text[],$12,$13,$14,$15)
        ON CONFLICT(source_platform,external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL DO UPDATE SET
        title=excluded.title,brand_id=excluded.brand_id,shop_name=excluded.shop_name,
        category=excluded.category,sub_category=excluded.sub_category,canonical_url=excluded.canonical_url,
        images=excluded.images,description=excluded.description,color_tags=excluded.color_tags,
        price_cents=excluded.price_cents,price_type=excluded.price_type,
        sale_status=excluded.sale_status,visibility_status=excluded.visibility_status,
        updated_at=now(),version=products.version+1
        RETURNING id`,['prod_'+id(p.platform+':'+p.externalId),p.title,brandId,p.shopName,p.pit,p.subCategory,p.platform,p.externalId,p.sourceUrl,JSON.stringify(p.images),p.description,p.colors,p.priceCents,p.priceType,p.status,publish?'published':'draft']);
      ids.push(String(rows[0]!.id));
    }return ids;
  });
}

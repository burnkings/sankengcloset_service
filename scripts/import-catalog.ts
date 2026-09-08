import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { readWorkbook } from '../src/catalog/workbook.js';
import { normalizeRows, importProducts, type ImportDB } from '../src/catalog/import-products.js';
const args=process.argv.slice(2),file=args.find(s=>!s.startsWith('--'));
if(!file)throw new Error('用法 npm run catalog:import -- 商品.xlsx [--apply] [--publish]；默认仅校验');
if(args.some(s=>s.startsWith('--')&&!['--apply','--publish'].includes(s)))throw new Error('不支持的参数');
const products=normalizeRows((await readWorkbook(await readFile(file)))['商品']!);
if(!args.includes('--apply'))console.log(JSON.stringify({mode:'dry-run',count:products.length,products},null,2));
else {
  if(!process.env.DATABASE_URL)throw new Error('缺少 DATABASE_URL');
  const sql=postgres(process.env.DATABASE_URL,{max:1});
  const wrap=(client:any):ImportDB=>({query:async(q,p=[])=>[...await client.unsafe(q,p)],transaction:fn=>client.begin((tx:any)=>fn(wrap(tx)))});
  try {console.log(JSON.stringify({ids:await importProducts(wrap(sql),products,args.includes('--publish'))}));}
  finally {await sql.end();}
}

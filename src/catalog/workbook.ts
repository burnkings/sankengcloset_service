import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { Readable } from 'node:stream';

const array=(v:any):any[]=>v==null?[]:Array.isArray(v)?v:[v];
const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,trimValues:false});
/** 读取固定模板的数据sheet；不计算Excel公式，不接受金额/身份字段中的公式。 */
export async function readWorkbook(bytes:Buffer):Promise<Record<string,Record<string,string>[]>> {
  if(bytes.length>10*1024*1024)throw new Error('工作簿超过10MB');
  const zip=await JSZip.loadAsync(bytes); let total=0;
  const xml=async(path:string)=>{
    const f=zip.file(path); if(!f)throw new Error(`工作簿缺少${path}`);
    const chunks:Buffer[]=[];
    await new Promise<void>((resolve,reject)=>{
      const stream=f.nodeStream() as Readable;
      stream.on('data',(part:Buffer)=>{
        const b=Buffer.from(part);total+=b.length;
        if(total>30*1024*1024){stream.destroy();reject(new Error('解压内容超过限制'));return;}
        chunks.push(b);
      });
      stream.on('end',resolve);stream.on('error',reject);
    });
    const text=Buffer.concat(chunks).toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('不支持XML实体声明');
    return parser.parse(text);
  };
  const wb=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');
  const strings=zip.file('xl/sharedStrings.xml')?array((await xml('xl/sharedStrings.xml')).sst?.si).map(v=>String(v.t?.['#text']??v.t??array(v.r).map(r=>r.t?.['#text']??r.t??'').join(''))):[];
  const result:Record<string,Record<string,string>[]>={};
  for(const sheet of array(wb.workbook?.sheets?.sheet)){
    const name=String(sheet['@_name']);if(!['商品'].includes(name))continue;
    const rel=array(rels.Relationships?.Relationship).find(r=>r['@_Id']===sheet['@_id']);
    if(!rel || rel['@_TargetMode']==='External')throw new Error('非法工作表关系');
    const target=String(rel['@_Target']);if(target.includes('..'))throw new Error('非法工作表路径');
    const path=target.startsWith('/')?target.slice(1):'xl/'+target;
    const rows=array((await xml(path)).worksheet?.sheetData?.row);
    if(rows.length>10001)throw new Error('单表最多10000条记录');
    let headers:Record<string,string>={}; const records:Record<string,string>[]=[];
    for(const [i,row]of rows.entries()){
      const record:Record<string,string>={};
      for(const c of array(row.c)){
        const col=String(c['@_r']).replace(/\d/g,'');
        const value=String(c['@_t']==='s'?strings[Number(c.v)]:c['@_t']==='inlineStr'?(c.is?.t?.['#text']??c.is?.t??''):c.v??'');
        if(i===0){if(value && Object.values(headers).includes(value))throw new Error('重复列名');headers[col]=value;}
        else if(headers[col]){
          if(c.f!==undefined && headers[col]!=='校验')throw new Error(`${name} ${c['@_r']} 不接受公式输入`);
          record[headers[col]!]=value;
        }
      }
      if(i>0 && Object.values(record).some(v=>v.trim()!==''))records.push(record);
    }
    result[name]=records;
  }
  for(const name of ['商品'])if(!result[name])throw new Error(`缺少工作表：${name}`);
  return result;
}

/** Fixed-origin, read-only Registry API. Shared by the hosted server and tests. */
import {ADDRESS_RE,VERSION_RE} from '../web/lib/registry.js';
export const REGISTRY='https://registry.terraform.io/v1/modules';
const MAX_BYTES=16*1024*1024, TTL=300000, MAX_CACHE_BYTES=24*1024*1024;
const cache=new Map();let cacheBytes=0;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':status===200?'public, max-age=300':'no-store','X-Content-Type-Options':'nosniff'}});
export function upstreamURL(url){
  const operation=url.pathname.split('/').filter(Boolean).at(-1),params=url.searchParams;
  if(operation==='health')return null;
  let path='',query=new URLSearchParams();
  if(operation==='search'){
    const q=(params.get('q')||'').trim(),provider=params.get('provider')||'',offset=params.get('offset')||'0',limit=params.get('limit')||'24';
    if(q.length>100||/[\x00-\x1f]/.test(q)||provider&&!/^[A-Za-z0-9_-]{1,64}$/.test(provider)||!/^\d{1,7}$/.test(offset)||!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>50)throw new Error('Érvénytelen keresési paraméter.');
    path=q?'/search':'';if(q)query.set('q',q);if(provider)query.set('provider',provider);query.set('offset',String(Number(offset)));query.set('limit',String(Number(limit)));
  }else if(operation==='versions'||operation==='module'){
    const module=params.get('module')||'';
    if(!ADDRESS_RE.test(module))throw new Error('Érvénytelen modulcím.');
    if(operation==='versions')path=`/${module}/versions`;
    else{const version=params.get('version')||'';if(!VERSION_RE.test(version))throw new Error('Érvénytelen verzió.');path=`/${module}/${encodeURIComponent(version)}`;}
  }else throw new Error('Ismeretlen Registry API-művelet.');
  return `${REGISTRY}${path}${query.size?'?'+query:''}`;
}
export async function handleRegistry(request,fetcher=fetch){
  if(request.method!=='GET')return json({error:'Csak GET kérés engedélyezett.'},405);
  let url;try{url=upstreamURL(new URL(request.url));}catch(error){return json({error:error.message},400);}
  if(!url)return json({ok:true,service:'ModuleLens Registry proxy',registry:REGISTRY});
  const now=Date.now(),hit=cache.get(url);
  if(hit&&hit.expires>now)return new Response(hit.body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
  try{
    const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json','User-Agent':'ModuleLens/2.0'},redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(!response.ok){const status=response.status===404?404:response.status===429?503:502;return json({error:status===404?'A modul vagy verzió nem található a Terraform Registryben.':response.status===429?'A Registry lekérési korlátját elértük. Próbáld újra később.':`A Registry nem érhető el (HTTP ${response.status}).`},status);}
    if(Number(response.headers.get('Content-Length'))>MAX_BYTES)return json({error:'A Registry válasza meghaladja a méretkorlátot.'},502);
    const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,body='';
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return json({error:'A Registry válasza túl nagy.'},502);}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}finally{reader.releaseLock();}
    const data=JSON.parse(body);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Unexpected response');
    if(hit){cacheBytes-=hit.size;cache.delete(url);}
    while(cache.size>=64||cacheBytes+size>MAX_CACHE_BYTES){const key=cache.keys().next().value;if(key===undefined)break;cacheBytes-=cache.get(key).size;cache.delete(key);}
    if(size<=MAX_CACHE_BYTES){cache.set(url,{body,size,expires:Date.now()+TTL});cacheBytes+=size;}
    return new Response(body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
  }catch{return json({error:'A Terraform Registry nem érhető el, időtúllépés történt vagy hibás választ adott.'},502);}
}

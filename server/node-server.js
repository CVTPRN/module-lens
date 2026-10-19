/** Dependency-free Node.js 22+ server for the same complete application. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleRegistry} from './registry-proxy.js';
const web=fileURLToPath(new URL('../web/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.gz':'application/gzip'};
export function startServer({port=8080,host='127.0.0.1'}={}){
  return createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/registry/')){
        const response=await handleRegistry(new Request(url,{method:req.method}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
      const path=decodeURIComponent(url.pathname),file=resolve(web,'.'+(path==='/'?'/index.html':path));
      if(path.includes('\0')||path.split('/').some(p=>p.startsWith('.'))||!file.startsWith(web.endsWith(sep)?web:web+sep)){res.writeHead(404);res.end('Not found');return;}
      const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':data.length,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"Not found"}');}
  }).listen(port,host);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||8080),host=process.env.HOST||'127.0.0.1';startServer({port,host});process.stdout.write(`ModuleLens: http://${host}:${port}\n`);
}

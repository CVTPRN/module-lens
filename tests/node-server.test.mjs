import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {startServer} from '../server/node-server.js';
test('standalone Node server serves Registry UI, same-origin API and rejects file traversal',async()=>{
  const server=startServer({port:0});await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const html=await fetch(origin+'/');assert.equal(html.status,200);assert.match(await html.text(),/registry-app.js/);
    assert.equal((await (await fetch(origin+'/api/registry/health')).json()).ok,true);
    assert.equal((await fetch(origin+'/%2e%2e/app.py')).status,404);
    assert.equal((await fetch(origin+'/api/registry/search',{method:'POST'})).status,405);
    assert.equal((await fetch(origin+'/opentofu.html')).status,200);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

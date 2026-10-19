import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const root=new URL('../web/',import.meta.url),fixtures=new URL('fixtures/registry/',import.meta.url);
const fixture=async name=>JSON.parse(await readFile(new URL(name+'.json',fixtures),'utf8'));
async function environment(url){
  const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url,pretendToBeVisual:true}),window=dom.window;
  for(const name of ['window','document','location','history','localStorage','Option'])globalThis[name]=name==='window'?window:window[name];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:window.navigator});
  window.HTMLElement.prototype.scrollIntoView=()=>{};
  let clipboard='';Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async text=>{clipboard=text;}}});
  return {dom,window,$:id=>window.document.getElementById(id),clipboard:()=>clipboard};
}
async function wait(condition){for(let i=0;i<150;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Registry UI did not settle');}
test('live Registry flow supports all-catalog pagination, non-curated modules, full versions, comparisons and stale responses',async()=>{
  const {dom,window,$,clipboard}=await environment('https://example.github.io/module-lens/');
  const [versions,before,after,search]=await Promise.all(['versions','before','after','search'].map(fixture));
  const calls=[];let defer=false,release;
  globalThis.fetch=async input=>{
    const url=new URL(input,window.document.baseURI);calls.push(url);assert.equal(url.origin,'https://example.github.io');
    if(url.pathname.endsWith('site.json'))return new Response('{}');
    if(url.pathname.endsWith('/health'))return new Response('{"ok":true}');
    if(url.pathname.endsWith('/search'))return new Response(JSON.stringify({...search,meta:{next_offset:url.searchParams.get('offset')==='0'?24:null}}));
    if(url.pathname.endsWith('/versions')){if(defer){defer=false;return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify(versions)));});}return new Response(JSON.stringify(versions));}
    if(url.pathname.endsWith('/module'))return new Response(JSON.stringify(url.searchParams.get('version')==='5.0.0'?before:after));
    throw new Error('Unexpected request: '+url);
  };
  const {ready}=await import('../web/registry-app.js?flow');await ready;
  assert.equal($('registry-grid').children.length,2);assert.equal($('load-more').hidden,false);
  $('load-more').click();await wait(()=>$('registry-grid').children.length===4);
  assert.ok(calls.some(url=>url.searchParams.get('offset')==='24'));
  $('provider-filter').value='azurerm';$('provider-filter').dispatchEvent(new window.Event('change'));await wait(()=>$('catalog-status').textContent.includes('azurerm'));
  $('module-input').value='terraform-aws-modules/ec2-instance/aws';$('load-module').click();await wait(()=>!$('from-version').disabled);
  assert.ok($('from-version').options.length>50);assert.equal($('from-version').options.length,versions.modules[0].versions.length);
  $('from-version').value='5.0.0';$('to-version').value='6.0.0';$('to-version').dispatchEvent(new window.Event('change'));assert.equal($('compare').disabled,false);
  $('compare').click();await wait(()=>!$('results').hidden);
  assert.match($('comparison-label').textContent,/ec2-instance/);assert.match($('comparison-label').textContent,/5.0.0 → 6.0.0/);
  assert.match($('change-list').textContent,/When (?:this applies|does this affect you)/);assert.match($('change-list').textContent,/Action/);
  assert.ok($('change-list').querySelector('a[href^="https://registry.terraform.io/modules/"]'));
  $('share-report').click();await wait(()=>clipboard().length>0);assert.match(clipboard(),/module=terraform-aws-modules%2Fec2-instance%2Faws/);
  assert.match($('scope-text').textContent,/not a guarantee of compatibility/);
  const hintFilter=window.document.querySelector('[data-filter="hint"]');hintFilter.click();assert.equal(hintFilter.getAttribute('aria-pressed'),'true');
  defer=true;$('load-module').click();await wait(()=>!!release);
  $('module-input').value='virtualnetwork';$('module-input').dispatchEvent(new window.Event('input'));release();
  await new Promise(resolve=>setTimeout(resolve,450));assert.equal($('from-version').disabled,true);assert.equal($('results').hidden,true);
  assert.ok(calls.every(url=>!url.href.startsWith('https://registry.terraform.io')),'Browser must use the same-origin API rather than a CORS-blocked Registry request');
  dom.window.close();
});
test('static Pages deployment clearly links to a working server instead of claiming live search works',async()=>{
  const {dom,$}=await environment('https://example.github.io/module-lens/');
  globalThis.fetch=async input=>String(input).includes('site.json')?new Response('{"registry_app_url":"https://module-lens-registry.azurebeech10.chatgpt.site"}'):new Response('<html>Not found</html>',{status:404});
  const {ready}=await import('../web/registry-app.js?static');await ready;
  assert.equal($('hosting-note').hidden,false);assert.match($('hosting-note').textContent,/GitHub Pages/);
  assert.equal($('hosting-note').querySelector('a').hostname,'module-lens-registry.azurebeech10.chatgpt.site');
  assert.equal($('results').hidden,true);dom.window.close();
});

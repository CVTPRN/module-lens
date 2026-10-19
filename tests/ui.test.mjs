/** DOM behavior tests. No browser or browser-rendering claims. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('complete page flow: boot, real report, filtering, docs, engine, catalog, invalid range and sharing',async()=>{
  const root=new URL('../web/',import.meta.url);
  const html=await readFile(new URL('opentofu.html',root),'utf8');
  const dom=new JSDOM(html,{url:'https://example.github.io/module-lens/opentofu.html?engine=opentofu',pretendToBeVisual:true});
  const {window}=dom;
  for(const name of ['window','document','location','history','localStorage'])globalThis[name]=name==='window'?window:window[name];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:window.navigator});
  window.DecompressionStream=globalThis.DecompressionStream;
  window.scrollTo=()=>{};
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
  let clipboard='';
  Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async value=>{clipboard=value;}}});
  globalThis.fetch=async input=>{
    const url=new URL(input,window.document.baseURI);
    assert.equal(url.origin,'https://example.github.io','Browser must only fetch static site data');
    const relative=url.pathname.replace(/^\/module-lens\//,'');
    try{return new Response(await readFile(new URL(relative,root)),{status:200});}
    catch{return new Response('Not found',{status:404});}
  };
  const $=id=>window.document.getElementById(id);
  const wait=async condition=>{for(let i=0;i<200;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('UI did not settle');};
  const {ready}=await import('../web/app.js');await ready;
  assert.equal($('message').hidden,true,$('message').textContent);
  assert.equal($('results').hidden,false);
  assert.match($('report-title').textContent,/EKS.*v20.37.1.*v21.0.0/);
  assert.match($('findings-list').textContent,/cluster_name → name/);
  assert.match(window.location.search,/module=aws-eks/);
  assert.equal($('module-select').options.length,5);
  $('finding-search').value='cluster_name';$('finding-search').dispatchEvent(new window.Event('input'));
  assert.match($('findings-list').textContent,/cluster_name → name/);
  $('finding-search').value='absolutely-no-such-variable';$('finding-search').dispatchEvent(new window.Event('input'));
  assert.match($('findings-list').textContent,/Nincs a szűrésnek/);
  $('finding-search').value='';$('finding-search').dispatchEvent(new window.Event('input'));
  $('level-filter').value='info';$('level-filter').dispatchEvent(new window.Event('change'));
  assert.ok([...$('findings-list').querySelectorAll('.finding')].every(el=>el.classList.contains('info')));
  $('tab-docs').click();assert.equal($('docs-panel').hidden,false);assert.equal($('changes-panel').hidden,true);
  assert.ok($('docs-list').querySelectorAll('details').length>0);
  $('tab-docs').dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal($('changes-panel').hidden,false);
  $('engine-opentofu').click();await wait(()=>!$('results').hidden&&$('report-subtitle').textContent.startsWith('OpenTofu'));
  assert.equal($('engine-opentofu').getAttribute('aria-pressed'),'true');
  $('share-button').click();await wait(()=>clipboard.length>0);assert.match(clipboard,/engine=opentofu/);
  $('theme-toggle').click();assert.equal(window.document.documentElement.dataset.theme,'dark');
  $('nav-method').click();assert.equal($('method-dialog').open,true);$('close-method').click();assert.equal($('method-dialog').open,false);
  $('nav-catalog').click();assert.equal($('catalog-view').hidden,false);assert.equal($('compare-view').hidden,true);
  $('catalog-search').value='gke';$('catalog-search').dispatchEvent(new window.Event('input'));
  assert.equal([...$('catalog-grid').children].filter(el=>!el.hidden).length,1);
  $('nav-compare').click();assert.equal($('compare-view').hidden,false);
  $('to-select').value=$('from-select').value;$('to-select').dispatchEvent(new window.Event('change'));
  await wait(()=>!$('compare-button').disabled);$('compare-button').click();await wait(()=>!$('message').hidden);
  assert.match($('message').textContent,/újabb/);assert.equal($('results').hidden,true);
  for(const a of window.document.querySelectorAll('a[target="_blank"]'))assert.ok(a.rel.includes('noopener'));
  await wait(()=>$('toast').hidden); // Verify the clipboard notification expires before tearing down the DOM.
  dom.window.close();
});

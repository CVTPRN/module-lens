import {moduleAddress,versionInfo,versionCompare,compareRegistry,registryMarkdown} from './lib/registry.js';
const $=id=>document.getElementById(id),input=$('module-input'),suggestions=$('suggestions'),fromSelect=$('from-version'),toSelect=$('to-version'),subSelect=$('submodule'),compareButton=$('compare');
let activeModule='',versionData=[],lastResult=null,filter='all',searchTimer,catalogSequence=0,searchSequence=0,loadSequence=0,comparisonSequence=0,nextOffset=null,apiAvailable=true,site={};
const cache=new Map(),PAGE_SIZE=24;
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;};
function status(text,type=''){$('status').textContent=text;$('status').className=`status ${type}`;}
function safeLink(url,text){try{const value=new URL(url);if(value.protocol!=='https:')throw new Error();const a=el('a','source-reference',text);a.href=value.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return el('span','',text);}}
function closeSuggestions(){suggestions.hidden=true;suggestions.replaceChildren();input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
function clearVersions(){comparisonSequence++;activeModule='';versionData=[];for(const select of [fromSelect,toSelect]){select.replaceChildren(new Option('Choose a module first',''));select.disabled=true;}subSelect.replaceChildren(new Option('Root module',''));subSelect.disabled=true;compareButton.disabled=true;$('results').hidden=true;}
async function api(operation,params={}){
  const url=new URL(`./api/registry/${operation}`,document.baseURI);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
  let response;try{response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});}catch{throw new Error('The live Registry server is unavailable. Please try again later.');}
  let data;try{data=await response.json();}catch{throw new Error('The live Registry API is unavailable on this host. GitHub Pages only serves static files.');}
  if(!response.ok)throw new Error(data.error||`API-hiba (HTTP ${response.status}).`);return data;
}
async function detail(module,version){
  const key=`${module}/${version}`;if(!cache.has(key)){const pending=api('module',{module,version}).catch(error=>{cache.delete(key);throw error;});cache.set(key,pending);if(cache.size>12)cache.delete(cache.keys().next().value);}return cache.get(key);
}
function updateSubmodules(preferred=subSelect.value){
  comparisonSequence++;
  const a=versionData.find(v=>v.version===fromSelect.value),b=versionData.find(v=>v.version===toSelect.value);
  const paths=[...new Set([...(a?.submodules||[]),...(b?.submodules||[])])].sort();
  subSelect.replaceChildren(new Option('Root module',''),...paths.map(path=>new Option(path,path)));subSelect.value=paths.includes(preferred)?preferred:'';subSelect.disabled=!paths.length;
  compareButton.disabled=!activeModule||!fromSelect.value||!toSelect.value||versionCompare(fromSelect.value,toSelect.value)>=0;
  $('results').hidden=true;
  status(compareButton.disabled?'The target version must be newer than the current version.':`${activeModule} · ${versionData.length} published versions. Ready to compare.`,compareButton.disabled?'error':'success');
}
async function loadModule(value,selected={}){
  const current=++loadSequence;++searchSequence;clearTimeout(searchTimer);closeSuggestions();
  let parsed;try{parsed=moduleAddress(value);}catch(error){clearVersions();status(error.message,'error');return;}
  const module=parsed.address;input.value=module;clearVersions();$('load-module').disabled=true;status('Loading all published versions from the Registry…');
  try{
    const data=await api('versions',{module});if(current!==loadSequence)return;
    const versions=versionInfo(data,module);if(versions.length<2)throw new Error('The module must have at least two published versions.');
    activeModule=module;versionData=versions;
    for(const select of [fromSelect,toSelect]){select.replaceChildren(...versions.map(v=>new Option(v.version,v.version)));select.disabled=false;}
    const stable=versions.filter(v=>!v.version.includes('-')),choices=stable.length>=2?stable:versions;
    toSelect.value=selected.to||parsed.version||choices[0].version;
    if(!toSelect.value)throw new Error('The requested target version was not found in the Registry.');
    const older=versions.find(v=>versionCompare(v.version,toSelect.value)<0);fromSelect.value=selected.from||older?.version||choices[1].version;
    if(!fromSelect.value)throw new Error('The requested current version was not found in the Registry.');
    updateSubmodules(selected.submodule||parsed.submodule);
    if(selected.compare)await compare();
  }catch(error){if(current===loadSequence){clearVersions();status(error.message,'error');}}
  finally{if(current===loadSequence)$('load-module').disabled=false;}
}
function moduleCard(entry){
  const module=[entry.namespace,entry.name,entry.provider].join('/'),card=el('button','registry-card');card.type='button';
  const top=el('div','registry-card-top');top.append(el('span','provider-tag',entry.provider),el('span','',entry.verified?'✓ Partner module':''));
  card.append(top,el('strong','',module),el('p','',entry.description||'No description available.'),el('small','',`v${entry.version} · Select versions →`));
  card.addEventListener('click',()=>{void loadModule(module);document.querySelector('.setup-panel').scrollIntoView({behavior:'smooth',block:'start'});});return card;
}
async function loadCatalog(append=false){
  if(!apiAvailable)return;
  const current=++catalogSequence,q=input.value.trim(),provider=$('provider-filter').value,offset=append?nextOffset:0;
  if(append&&offset===null)return;
  $('load-more').disabled=true;$('catalog-status').textContent='Loading from the full public Terraform Registry…';
  try{
    const data=await api('search',{q,provider,offset:String(offset),limit:String(PAGE_SIZE)});if(current!==catalogSequence)return;
    const modules=(data.modules||[]).filter(m=>m.namespace&&m.name&&m.provider);
    if(!append)$('registry-grid').replaceChildren();
    for(const module of modules)$('registry-grid').append(moduleCard(module));
    nextOffset=Number.isInteger(data.meta?.next_offset)?data.meta.next_offset:null;
    $('load-more').hidden=nextOffset===null;$('catalog-status').textContent=modules.length?`${$('registry-grid').children.length} modules loaded${q?' · Search: '+q:''}${provider?' · Provider: '+provider:''}. Load more to see additional results.`:'No results. You can also enter an exact namespace/name/provider address.';
  }catch(error){if(current===catalogSequence){$('catalog-status').textContent=error.message;$('load-more').hidden=true;}}
  finally{if(current===catalogSequence)$('load-more').disabled=false;}
}
async function searchModules(query){
  const current=++searchSequence;if(query.length<2){closeSuggestions();return;}
  try{
    const data=await api('search',{q:query,provider:$('provider-filter').value,limit:'8',offset:'0'});if(current!==searchSequence||input.value.trim()!==query)return;
    suggestions.replaceChildren();
    for(const [i,entry]of (data.modules||[]).entries()){
      if(!entry.namespace||!entry.name||!entry.provider)continue;
      const module=[entry.namespace,entry.name,entry.provider].join('/'),button=el('button','suggestion');button.type='button';button.id=`suggestion-${i}`;button.setAttribute('role','option');button.setAttribute('aria-selected','false');
      const body=el('span');body.append(el('strong','',module),el('small','',entry.description||''));button.append(body,el('span','',`v${entry.version}`));button.addEventListener('click',()=>void loadModule(module));suggestions.append(button);
    }
    if(!suggestions.children.length)suggestions.append(el('div','suggestion-empty','No results. You can also enter an exact module address.'));
    suggestions.hidden=false;input.setAttribute('aria-expanded','true');
  }catch(error){if(current===searchSequence){closeSuggestions();status(error.message,'error');}}
}
input.addEventListener('input',()=>{
  ++loadSequence;++comparisonSequence;++catalogSequence;++searchSequence;clearVersions();$('load-module').disabled=false;closeSuggestions();clearTimeout(searchTimer);
  const q=input.value.trim();searchTimer=setTimeout(()=>{void loadCatalog();if(q.length>=2)void searchModules(q);},350);
});
input.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeSuggestions();return;}
  const options=[...suggestions.querySelectorAll('button')],active=options.findIndex(o=>o.id===input.getAttribute('aria-activedescendant'));
  if(['ArrowDown','ArrowUp'].includes(event.key)&&!suggestions.hidden&&options.length){event.preventDefault();const index=event.key==='ArrowDown'?(active+1)%options.length:(active-1+options.length)%options.length;for(const [i,o]of options.entries())o.setAttribute('aria-selected',String(i===index));input.setAttribute('aria-activedescendant',options[index].id);return;}
  if(event.key==='Enter'){event.preventDefault();if(!suggestions.hidden&&active>=0)options[active].click();else void loadModule(input.value);}
});
document.addEventListener('click',event=>{if(!event.target.closest('.search-wrap'))closeSuggestions();});
$('load-module').addEventListener('click',()=>void loadModule(input.value));
for(const button of document.querySelectorAll('.quick-pick'))button.addEventListener('click',()=>void loadModule(button.dataset.module));
$('provider-filter').addEventListener('change',()=>{++searchSequence;closeSuggestions();void loadCatalog();});$('load-more').addEventListener('click',()=>void loadCatalog(true));
for(const select of [fromSelect,toSelect])select.addEventListener('change',()=>updateSubmodules());
subSelect.addEventListener('change',()=>{++comparisonSequence;$('results').hidden=true;});

function fieldBox(label,payload){
  const pane=el('div','diff-pane');pane.append(el('strong','',label));
  if(!payload||!Object.keys(payload).length)pane.append(el('em','',payload?'No further data in the Registry':'Not present in this version'));
  else{const dl=el('dl');for(const[key,value]of Object.entries(payload)){const row=el('div');row.append(el('dt','',({type:'Type',default:'Default',required:'Required',description:'Description',sensitive:'Sensitive',version:'Version constraint',source:'Source',resources:'Resources'})[key]||key),el('dd','',typeof value==='string'?value:JSON.stringify(value,null,2)));dl.append(row);}pane.append(dl);}return pane;
}
function changeCard(change){
  const card=el('details',`change ${change.kind}`),summary=el('summary'),heading=el('div','change-heading');
  heading.append(el('div','change-title',change.title),el('div','change-sub',change.note));
  const badges=el('div','change-badges');badges.append(el('span','badge',({inputs:'INPUT',outputs:'OUTPUT',submodules:'SUBMODULE',dependencies:'DEPENDENCY',resources:'RESOURCE'})[change.category]),el('span',`badge ${change.level}`,({attention:'CONDITIONAL ACTION',review:'NEEDS REVIEW',info:'INFORMATION'})[change.level]));
  summary.append(el('span','change-mark',({added:'+',removed:'−',changed:'~',hint:'?'})[change.kind]),heading,badges,el('span','chevron','⌄'));
  const body=el('div','change-body');const condition=el('p','condition-text');condition.append(el('strong','','When does this affect you? '),document.createTextNode(change.condition));
  const action=el('p','action-text');action.append(el('strong','','Action: '),document.createTextNode(change.action));
  const grid=el('div','diff-grid');grid.append(fieldBox(lastResult.from,change.before),fieldBox(lastResult.to,change.after));const sources=el('div','source-links');change.sources.forEach((url,i)=>sources.append(safeLink(url,`${i?'New':'Previous'} version in Registry ↗`)));
  body.append(condition,action,grid,sources);card.append(summary,body);return card;
}
function renderChanges(){
  const changes=lastResult.changes.filter(c=>filter==='all'||(filter==='hint'?c.kind==='hint':c.category===filter&&c.kind!=='hint'));
  $('change-list').replaceChildren(...changes.map(changeCard));$('empty-result').hidden=!!changes.length;
}
function renderResult(data){
  lastResult=data;filter='all';for(const button of document.querySelectorAll('.filter')){const selected=button.dataset.filter==='all';button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));}
  $('comparison-label').textContent=`${data.module}${data.submodule?'//'+data.submodule:''} · ${data.from} → ${data.to}`;$('registry-link').href=data.registry_url;
  for(const key of ['added','removed','changed','hints'])$(`${key==='hints'?'hint':key}-count`).textContent=data.summary[key];
  $('all-count').textContent=data.summary.total+data.summary.hints;$('scope-text').textContent=data.scope;$('report-provenance').textContent=`Source: registry.terraform.io · Fetched: ${new Date(data.fetched_at).toLocaleString('en-US')} · Analysis: Registry metadata.`;
  renderChanges();$('results').hidden=false;$('results').scrollIntoView({behavior:'smooth',block:'start'});
}
async function compare(){
  const current=++comparisonSequence,module=activeModule,from=fromSelect.value,to=toSelect.value,submodule=subSelect.value;compareButton.disabled=true;status('Comparing live Registry data for the two versions…');
  try{
    const [oldData,newData]=await Promise.all([detail(module,from),detail(module,to)]);if(current!==comparisonSequence)return;
    const data=compareRegistry(module,from,to,submodule,oldData,newData);renderResult(data);
    const url=new URL(location.href);for(const[key,value]of Object.entries({module,from,to,submodule}))value?url.searchParams.set(key,value):url.searchParams.delete(key);history.replaceState(null,'',url);status('Comparison complete.','success');
  }catch(error){if(current===comparisonSequence){$('results').hidden=true;status(error.message,'error');}}
  finally{if(current===comparisonSequence)compareButton.disabled=!activeModule||versionCompare(fromSelect.value,toSelect.value)>=0;}
}
compareButton.addEventListener('click',()=>void compare());
for(const button of document.querySelectorAll('.filter'))button.addEventListener('click',()=>{filter=button.dataset.filter;for(const b of document.querySelectorAll('.filter')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}if(lastResult)renderChanges();});
$('share-report').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);status('Report link copied.','success');}catch{status('Shareable link: '+location.href);}});
for(const format of ['json','md'])$(`export-${format}`).addEventListener('click',()=>{
  if(!lastResult)return;const content=format==='json'?JSON.stringify(lastResult,null,2):registryMarkdown(lastResult),blob=new Blob([content],{type:format==='json'?'application/json':'text/markdown'}),url=URL.createObjectURL(blob),a=el('a');
  a.href=url;a.download=`modulelens-${lastResult.module.replaceAll('/','-')}-${lastResult.from}-${lastResult.to}.${format}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

async function boot(){
  try{const response=await fetch(new URL('./site.json',document.baseURI));if(response.ok)site=await response.json();}catch{/* Branding is optional. */}
  try{await api('health');}catch(error){
    apiAvailable=false;status(error.message,'error');const note=$('hosting-note');note.hidden=false;note.append(el('strong','','Live Registry search requires a server-side API.'),el('p','','GitHub Pages is a static host. Use the Python server or the hosted application for full functionality.'));
    if(site.registry_app_url)note.append(safeLink(site.registry_app_url,'Open the live Registry application ↗'));
    $('catalog-status').textContent='The live Registry API is not enabled on this host.';return;
  }
  const params=new URLSearchParams(location.search),oldIds={'aws-eks':'terraform-aws-modules/eks/aws','aws-vpc':'terraform-aws-modules/vpc/aws','aws-s3':'terraform-aws-modules/s3-bucket/aws','gcp-network':'terraform-google-modules/network/google','gcp-gke':'terraform-google-modules/kubernetes-engine/google'};
  const module=params.get('module');await loadCatalog();
  if(module)await loadModule(oldIds[module]||module,{from:params.get('from')?.replace(/^v/,''),to:params.get('to')?.replace(/^v/,''),submodule:params.get('submodule')||params.get('scope')?.replace(/^\.$/,'')||'',compare:!!params.get('from')&&!!params.get('to')});
}
export const ready=boot();

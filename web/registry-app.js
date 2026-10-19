import {moduleAddress,versionInfo,versionCompare,compareRegistry,registryMarkdown} from './lib/registry.js';
const $=id=>document.getElementById(id),input=$('module-input'),suggestions=$('suggestions'),fromSelect=$('from-version'),toSelect=$('to-version'),subSelect=$('submodule'),compareButton=$('compare');
let activeModule='',versionData=[],lastResult=null,filter='all',searchTimer,catalogSequence=0,searchSequence=0,loadSequence=0,comparisonSequence=0,nextOffset=null,apiAvailable=true,site={};
const cache=new Map(),PAGE_SIZE=24;
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;};
function status(text,type=''){$('status').textContent=text;$('status').className=`status ${type}`;}
function safeLink(url,text){try{const value=new URL(url);if(value.protocol!=='https:')throw new Error();const a=el('a','source-reference',text);a.href=value.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return el('span','',text);}}
function closeSuggestions(){suggestions.hidden=true;suggestions.replaceChildren();input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
function clearVersions(){comparisonSequence++;activeModule='';versionData=[];for(const select of [fromSelect,toSelect]){select.replaceChildren(new Option('Előbb válassz modult',''));select.disabled=true;}subSelect.replaceChildren(new Option('Gyökérmodul',''));subSelect.disabled=true;compareButton.disabled=true;$('results').hidden=true;}
async function api(operation,params={}){
  const url=new URL(`./api/registry/${operation}`,document.baseURI);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
  let response;try{response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});}catch{throw new Error('Az élő Registry-kiszolgáló nem érhető el. Próbáld újra később.');}
  let data;try{data=await response.json();}catch{throw new Error('Az élő Registry API nem elérhető ezen a tárhelyen. A GitHub Pages csak statikus fájlokat szolgál ki.');}
  if(!response.ok)throw new Error(data.error||`API-hiba (HTTP ${response.status}).`);return data;
}
async function detail(module,version){
  const key=`${module}/${version}`;if(!cache.has(key)){const pending=api('module',{module,version}).catch(error=>{cache.delete(key);throw error;});cache.set(key,pending);if(cache.size>12)cache.delete(cache.keys().next().value);}return cache.get(key);
}
function updateSubmodules(preferred=subSelect.value){
  comparisonSequence++;
  const a=versionData.find(v=>v.version===fromSelect.value),b=versionData.find(v=>v.version===toSelect.value);
  const paths=[...new Set([...(a?.submodules||[]),...(b?.submodules||[])])].sort();
  subSelect.replaceChildren(new Option('Gyökérmodul',''),...paths.map(path=>new Option(path,path)));subSelect.value=paths.includes(preferred)?preferred:'';subSelect.disabled=!paths.length;
  compareButton.disabled=!activeModule||!fromSelect.value||!toSelect.value||versionCompare(fromSelect.value,toSelect.value)>=0;
  $('results').hidden=true;
  status(compareButton.disabled?'A célverzió legyen újabb a jelenlegi verziónál.':`${activeModule} · ${versionData.length} publikált verzió. Készen áll az összehasonlításra.`,compareButton.disabled?'error':'success');
}
async function loadModule(value,selected={}){
  const current=++loadSequence;++searchSequence;clearTimeout(searchTimer);closeSuggestions();
  let parsed;try{parsed=moduleAddress(value);}catch(error){clearVersions();status(error.message,'error');return;}
  const module=parsed.address;input.value=module;clearVersions();$('load-module').disabled=true;status('Összes publikált verzió betöltése a Registryből…');
  try{
    const data=await api('versions',{module});if(current!==loadSequence)return;
    const versions=versionInfo(data,module);if(versions.length<2)throw new Error('A modulhoz legalább két publikált verzió szükséges.');
    activeModule=module;versionData=versions;
    for(const select of [fromSelect,toSelect]){select.replaceChildren(...versions.map(v=>new Option(v.version,v.version)));select.disabled=false;}
    const stable=versions.filter(v=>!v.version.includes('-')),choices=stable.length>=2?stable:versions;
    toSelect.value=selected.to||parsed.version||choices[0].version;
    if(!toSelect.value)throw new Error('A megadott célverzió nem található a Registryben.');
    const older=versions.find(v=>versionCompare(v.version,toSelect.value)<0);fromSelect.value=selected.from||older?.version||choices[1].version;
    if(!fromSelect.value)throw new Error('A megadott kiinduló verzió nem található a Registryben.');
    updateSubmodules(selected.submodule||parsed.submodule);
    if(selected.compare)await compare();
  }catch(error){if(current===loadSequence){clearVersions();status(error.message,'error');}}
  finally{if(current===loadSequence)$('load-module').disabled=false;}
}
function moduleCard(entry){
  const module=[entry.namespace,entry.name,entry.provider].join('/'),card=el('button','registry-card');card.type='button';
  const top=el('div','registry-card-top');top.append(el('span','provider-tag',entry.provider),el('span','',entry.verified?'✓ Partner modul':''));
  card.append(top,el('strong','',module),el('p','',entry.description||'Nincs rövid leírás.'),el('small','',`v${entry.version} · Verziók kiválasztása →`));
  card.addEventListener('click',()=>{void loadModule(module);document.querySelector('.setup-panel').scrollIntoView({behavior:'smooth',block:'start'});});return card;
}
async function loadCatalog(append=false){
  if(!apiAvailable)return;
  const current=++catalogSequence,q=input.value.trim(),provider=$('provider-filter').value,offset=append?nextOffset:0;
  if(append&&offset===null)return;
  $('load-more').disabled=true;$('catalog-status').textContent='Lekérés a teljes nyilvános Terraform Registryből…';
  try{
    const data=await api('search',{q,provider,offset:String(offset),limit:String(PAGE_SIZE)});if(current!==catalogSequence)return;
    const modules=(data.modules||[]).filter(m=>m.namespace&&m.name&&m.provider);
    if(!append)$('registry-grid').replaceChildren();
    for(const module of modules)$('registry-grid').append(moduleCard(module));
    nextOffset=Number.isInteger(data.meta?.next_offset)?data.meta.next_offset:null;
    $('load-more').hidden=nextOffset===null;$('catalog-status').textContent=modules.length?`${$('registry-grid').children.length} betöltött modul${q?' · Keresés: '+q:''}${provider?' · Provider: '+provider:''}. További találatok lapozással érhetők el.`:'Nincs találat. Pontos névtér/név/provider címet is megadhatsz.';
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
    if(!suggestions.children.length)suggestions.append(el('div','suggestion-empty','Nincs találat. Pontos modulcímet is megadhatsz.'));
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
  if(!payload||!Object.keys(payload).length)pane.append(el('em','',payload?'Nincs további adat a Registryben':'Ebben a verzióban nincs jelen'));
  else{const dl=el('dl');for(const[key,value]of Object.entries(payload)){const row=el('div');row.append(el('dt','',({type:'Típus',default:'Alapérték',required:'Kötelező',description:'Leírás',sensitive:'Érzékeny',version:'Verziókorlát',source:'Forrás',resources:'Erőforrások'})[key]||key),el('dd','',typeof value==='string'?value:JSON.stringify(value,null,2)));dl.append(row);}pane.append(dl);}return pane;
}
function changeCard(change){
  const card=el('details',`change ${change.kind}`),summary=el('summary'),heading=el('div','change-heading');
  heading.append(el('div','change-title',change.title),el('div','change-sub',change.note));
  const badges=el('div','change-badges');badges.append(el('span','badge',({inputs:'BEMENET',outputs:'OUTPUT',submodules:'ALMODUL',dependencies:'FÜGGŐSÉG',resources:'ERŐFORRÁS'})[change.category]),el('span',`badge ${change.level}`,({attention:'FELTÉTELES TEENDŐ',review:'ELLENŐRIZENDŐ',info:'INFORMÁCIÓ'})[change.level]));
  summary.append(el('span','change-mark',({added:'+',removed:'−',changed:'~',hint:'?'})[change.kind]),heading,badges,el('span','chevron','⌄'));
  const body=el('div','change-body');const condition=el('p','condition-text');condition.append(el('strong','','Mikor érint? '),document.createTextNode(change.condition));
  const action=el('p','action-text');action.append(el('strong','','Teendő: '),document.createTextNode(change.action));
  const grid=el('div','diff-grid');grid.append(fieldBox(lastResult.from,change.before),fieldBox(lastResult.to,change.after));const sources=el('div','source-links');change.sources.forEach((url,i)=>sources.append(safeLink(url,`${i?'Új':'Régi'} verzió a Registryben ↗`)));
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
  $('all-count').textContent=data.summary.total+data.summary.hints;$('scope-text').textContent=data.scope;$('report-provenance').textContent=`Forrás: registry.terraform.io · Lekérve: ${new Date(data.fetched_at).toLocaleString('hu-HU')} · Elemzés: Registry-metaadatok.`;
  renderChanges();$('results').hidden=false;$('results').scrollIntoView({behavior:'smooth',block:'start'});
}
async function compare(){
  const current=++comparisonSequence,module=activeModule,from=fromSelect.value,to=toSelect.value,submodule=subSelect.value;compareButton.disabled=true;status('A két verzió élő Registry-adatainak összehasonlítása…');
  try{
    const [oldData,newData]=await Promise.all([detail(module,from),detail(module,to)]);if(current!==comparisonSequence)return;
    const data=compareRegistry(module,from,to,submodule,oldData,newData);renderResult(data);
    const url=new URL(location.href);for(const[key,value]of Object.entries({module,from,to,submodule}))value?url.searchParams.set(key,value):url.searchParams.delete(key);history.replaceState(null,'',url);status('Az összehasonlítás elkészült.','success');
  }catch(error){if(current===comparisonSequence){$('results').hidden=true;status(error.message,'error');}}
  finally{if(current===comparisonSequence)compareButton.disabled=!activeModule||versionCompare(fromSelect.value,toSelect.value)>=0;}
}
compareButton.addEventListener('click',()=>void compare());
for(const button of document.querySelectorAll('.filter'))button.addEventListener('click',()=>{filter=button.dataset.filter;for(const b of document.querySelectorAll('.filter')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}if(lastResult)renderChanges();});
$('share-report').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);status('A riport linkjét kimásoltuk.','success');}catch{status('Megosztható link: '+location.href);}});
for(const format of ['json','md'])$(`export-${format}`).addEventListener('click',()=>{
  if(!lastResult)return;const content=format==='json'?JSON.stringify(lastResult,null,2):registryMarkdown(lastResult),blob=new Blob([content],{type:format==='json'?'application/json':'text/markdown'}),url=URL.createObjectURL(blob),a=el('a');
  a.href=url;a.download=`modulelens-${lastResult.module.replaceAll('/','-')}-${lastResult.from}-${lastResult.to}.${format}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

async function boot(){
  try{const response=await fetch(new URL('./site.json',document.baseURI));if(response.ok)site=await response.json();}catch{/* Branding is optional. */}
  try{await api('health');}catch(error){
    apiAvailable=false;status(error.message,'error');const note=$('hosting-note');note.hidden=false;note.append(el('strong','','Az élő Registry-kereséshez szerveroldali API szükséges.'),el('p','','A GitHub Pages statikus tárhely. A teljes alkalmazás a Python-szerverrel vagy a hosztolt webes változatban működik.'));
    if(site.registry_app_url)note.append(safeLink(site.registry_app_url,'Működő Registry-alkalmazás megnyitása ↗'));
    $('catalog-status').textContent='Az élő Registry API ezen a tárhelyen nincs bekapcsolva.';return;
  }
  const params=new URLSearchParams(location.search),oldIds={'aws-eks':'terraform-aws-modules/eks/aws','aws-vpc':'terraform-aws-modules/vpc/aws','aws-s3':'terraform-aws-modules/s3-bucket/aws','gcp-network':'terraform-google-modules/network/google','gcp-gke':'terraform-google-modules/kubernetes-engine/google'};
  const module=params.get('module');await loadCatalog();
  if(module)await loadModule(oldIds[module]||module,{from:params.get('from')?.replace(/^v/,''),to:params.get('to')?.replace(/^v/,''),submodule:params.get('submodule')||params.get('scope')?.replace(/^\.$/,'')||'',compare:!!params.get('from')&&!!params.get('to')});
}
export const ready=boot();

import {compareSnapshots, compareVersions, migrationDocuments, markdownReport, hcl} from './lib/compare.js';

const $ = id => document.getElementById(id);
const paths = {
  compare:'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  book:'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v16h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4zM12 5v16',
  arrow:'M4 12h16m-6-6 6 6-6 6',
  external:'M14 3h7v7M21 3l-9 9M10 3H4v17h16v-6',
  alert:'M12 3 2 21h20L12 3zM12 9v5m0 3v.2',
  edit:'m14 4 6 6M4 20l5-1L21 7l-4-4L5 15z',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  sparkles:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM21 2v4m-2-2h4',
  shield:'m12 2 8 4v6c0 5-8 9-8 9s-8-4-8-9V6zM8 11l3 3 5-5',
  check:'m5 12 4 4L20 5',
  info:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 11v6m0-10v.1',
  link:'m10 13 4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0m-2 5 6 6',
  sun:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2'
};
function icon(name) {const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.info);svg.append(path);return svg;}
for (const node of document.querySelectorAll('[data-icon]')) node.append(icon(node.dataset.icon));
function element(tag, cls, text) {const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;}
function safeLink(url, label, cls='') {
  const a=element('a',cls,label);
  try {const parsed=new URL(url);if(parsed.protocol!=='https:' || parsed.hostname!=='github.com') throw new Error();a.href=parsed.href;a.target='_blank';a.rel='noopener noreferrer';}
  catch {return element('span',cls,label);}
  return a;
}
const levelLabels={required:'Kötelező teendő',conditional:'Feltételes módosítás',review:'Ellenőrizendő',info:'Új lehetőség'};
const categoryLabels={input:'Bemenet',output:'Output',dependency:'Függőség',internal:'Belső működés',state:'State',module:'Almodul'};
const levelIcons={required:'alert',conditional:'edit',review:'eye',info:'sparkles'};
const state={catalog:null,module:null,engine:'terraform',report:null,documents:[],cache:new Map(),loadId:0,reportId:0};
const params=new URLSearchParams(location.search);
let toastTimer;

function toast(text) {$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},3500);}
function message(text,error=false) {$('message').textContent=text;$('message').classList.toggle('error',error);$('message').hidden=!text;}
async function fetchJSON(url) {
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Az adatfájl nem érhető el (${response.status}). Próbáld újra, vagy ellenőrizd a katalógus frissítését.`);
  if(String(url).endsWith('.gz')) {
    if(!('DecompressionStream' in window))throw new Error('A böngésző nem támogatja a tömörített pillanatképek olvasását. Használj aktuális Chrome, Firefox, Edge vagy Safari böngészőt.');
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  }
  return response.json();
}
function snapshot(entry, engine=state.engine) {
  const url=entry.snapshots[engine];
  // All catalog paths must remain within this static site, including imported data.
  if(!/^data\/[a-zA-Z0-9_.-]+\/(terraform|opentofu)\/v?\d+\.\d+\.\d+\.json\.gz$/.test(url))throw new Error('Érvénytelen katalógusútvonal.');
  if(!state.cache.has(url)) {const pending=fetchJSON(new URL(url,document.baseURI)).catch(error=>{state.cache.delete(url);throw error;});state.cache.set(url,pending);}
  return state.cache.get(url);
}
function option(value,text) {const o=element('option','',text);o.value=value;return o;}
function selectValue(select,value,fallback) {select.value=value;if(select.value!==value)select.value=fallback;}
function dateLabel(value) {const date=new Date(value);return Number.isNaN(date.getTime())?'ismeretlen':date.toLocaleDateString('hu-HU',{year:'numeric',month:'short',day:'numeric'});}
function setNav(view) {const isCatalog=view==='catalog';$('compare-view').hidden=isCatalog;$('catalog-view').hidden=!isCatalog;$('nav-compare').classList.toggle('active',!isCatalog);$('nav-catalog').classList.toggle('active',isCatalog);$('breadcrumb-current').textContent=isCatalog?'Modulkatalógus':'Összehasonlítás';}
function invalidateReport() {state.reportId++;$('results').hidden=true;state.report=null;$('loading').hidden=true;message('');}

function fillCatalog() {
  const quick=$('quick-modules'), grid=$('catalog-grid'), select=$('module-select');
  quick.replaceChildren();grid.replaceChildren();select.replaceChildren();
  for(const module of state.catalog.modules) {
    select.append(option(module.id,`${module.provider==='aws'?'AWS':'Google Cloud'} · ${module.name}`));
    const provider=()=>element('span',`provider-square ${module.provider==='google'?'google':''}`,module.provider==='aws'?'aws':'G');
    const button=element('button','quick-module');button.type='button';button.append(provider(),document.createTextNode(module.name));button.addEventListener('click',()=>openModule(module.id));quick.append(button);
    const card=element('button','catalog-card');card.type='button';card.dataset.search=`${module.id} ${module.name} ${module.provider} ${module.repository} ${module.description}`.toLowerCase();
    card.append(provider(),element('h2','',module.name),element('p','',module.description),element('span','card-meta',`${module.versions.length} indexelt verzió · ${module.scopes.length} modulútvonal`),element('span','card-action','Verziók összehasonlítása →'));
    card.addEventListener('click',()=>openModule(module.id));grid.append(card);
  }
  $('nav-count').textContent=state.catalog.modules.length;
  select.disabled=false;
}

function openModule(id) {$('module-select').value=id;setNav('compare');void chooseModule(id);window.scrollTo({top:0,behavior:'smooth'});}
async function chooseModule(id, from, to, scope) {
  invalidateReport();const loadId=++state.loadId;
  state.module=state.catalog.modules.find(m=>m.id===id)||state.catalog.modules[0];
  const module=state.module, versions=module.versions;
  $('module-select').value=module.id;
  for(const select of [$('from-select'),$('to-select')]) {select.replaceChildren(...versions.map(v=>option(v.tag,v.tag)));select.disabled=false;}
  const example=module.id==='aws-eks' && versions.some(v=>v.tag==='v20.37.1') && versions.some(v=>v.tag==='v21.0.0');
  const defaultFrom=example?'v20.37.1':versions[1]?.tag||versions[0].tag;
  const defaultTo=example?'v21.0.0':versions[0].tag;
  selectValue($('from-select'),from||defaultFrom,defaultFrom);selectValue($('to-select'),to||defaultTo,defaultTo);
  $('upstream-link').href=`https://github.com/${module.repository}`;$('upstream-link').hidden=false;
  $('indexed-count').textContent=`${versions.length} indexelt verzió`;
  $('version-coverage').textContent=`Katalógus: ${dateLabel(module.updated_at)} · Válogatott stabil kiadások; nem minden verzió érhető el. Egy további kiadás az anchors listával indexelhető.${module.stale?' Figyelem: az utolsó adatfrissítés sikertelen, korábbi adatokat látsz.':''}`;
  $('compare-button').disabled=true;$('scope-select').disabled=true;
  try {await fillScopes(scope,loadId);if(loadId!==state.loadId)return;$('compare-button').disabled=false;await runComparison();}
  catch(error) {if(loadId===state.loadId)message(error.message,true);}
}

async function fillScopes(preferred='.',loadId=state.loadId) {
  const module=state.module, engine=state.engine;
  const selected=[module.versions.find(v=>v.tag===$('from-select').value),module.versions.find(v=>v.tag===$('to-select').value)];
  if(selected.some(v=>!v))throw new Error('A kiválasztott verzió nem található a katalógusban.');
  const snaps=await Promise.all(selected.map(entry=>snapshot(entry,engine)));
  if(loadId!==state.loadId)return;
  const scopes=[...new Set(snaps.flatMap(s=>Object.keys(s.scopes)))].sort((a,b)=>a==='.'?-1:b==='.'?1:a.localeCompare(b));
  $('scope-select').replaceChildren(...scopes.map(path=>option(path,path==='.'?'Főmodul':path)));
  selectValue($('scope-select'),preferred,scopes.includes('.')?'.':scopes[0]);$('scope-select').disabled=false;
}

async function versionChanged() {const previous=$('scope-select').value;invalidateReport();const loadId=++state.loadId;$('compare-button').disabled=true;try {await fillScopes(previous,loadId);if(loadId===state.loadId)$('compare-button').disabled=false;}catch(error){if(loadId===state.loadId)message(error.message,true);}}

async function runComparison() {
  const reportId=++state.reportId, module=state.module, engine=state.engine;
  if(!module)return;
  const from=$('from-select').value,to=$('to-select').value,scope=$('scope-select').value;
  message('');$('results').hidden=true;$('loading').hidden=false;$('compare-button').disabled=true;
  try {
    if(compareVersions(from,to)>=0)throw new Error('Válassz a jelenlegi verziónál újabb célverziót.');
    const entries=module.versions.filter(v=>v.tag===from||compareVersions(v.tag,from)>0&&compareVersions(v.tag,to)<=0);
    const snaps=await Promise.all(entries.map(v=>snapshot(v,engine)));
    if(reportId!==state.reportId)return;
    const before=snaps.find(s=>s.tag===from),after=snaps.find(s=>s.tag===to);
    const report=compareSnapshots(before,after,scope);
    state.documents=migrationDocuments(snaps,from,to);
    state.report={...report,catalog_updated_at:module.updated_at,catalog_stale:!!module.stale,
      documentation_coverage:'Indexed snapshots and version-filtered changelog; intermediate semantics are not fully evaluated.'};
    renderReport();
    const url=new URL(location.href);for(const[k,v]of Object.entries({module:module.id,engine,from,to,scope}))url.searchParams.set(k,v);history.replaceState(null,'',url);
  } catch(error) {if(reportId===state.reportId){state.report=null;message(error.message,true);}}
  finally {if(reportId===state.reportId){$('loading').hidden=true;$('compare-button').disabled=false;}}
}

function renderReport() {
  const r=state.report;
  $('results').hidden=false;$('report-title').textContent=`${state.module.name} · ${r.from} → ${r.to}`;
  $('report-subtitle').textContent=`${r.engine==='terraform'?'Terraform':'OpenTofu'} · ${r.scope==='.'?'Főmodul':r.scope} · ${r.findings.length} azonosított eltérés`;
  for(const level of Object.keys(levelLabels))$(`count-${level}`).textContent=r.counts[level];
  $('total-count').textContent=r.findings.length;$('docs-count').textContent=state.documents.length;
  const verdicts={incomplete:['Az elemzés hiányos — kézi felülvizsgálat szükséges.','Egy vagy több forrásfájlt nem tudtunk teljesen értelmezni. A feltárt változások mellett további eltérések is lehetnek.'],
    required:['Módosítást igénylő változást találtunk.','Ellenőrizd az egyes tételek érintettségi feltételét, és készítsd elő a szükséges módosításokat.'],
    conditional:['Bizonyos beállítások használatakor módosítás szükséges.','A saját kódod nélkül nem dönthető el, mely tételek érintenek. Minden változásnál megmutatjuk a feltételt.'],
    review:['Ellenőrizendő működésbeli vagy függőségi eltérések vannak.','A bemenetek átírása nélkül is változhat a működés. Nézd át a dokumentációt és a plan eredményét.'],
    'no-breaking-found':['A vizsgált deklarációkban nem találtunk kötelező módosítást.','Ez nem bizonyít teljes kompatibilitást. Ellenőrizd a dokumentációt és a plan eredményét.']};
  const [title,body]=verdicts[r.status],content=element('div');content.append(element('strong','',title),element('p','',body));$('verdict').replaceChildren(icon('info'),content);
  const warnings=$('parse-warnings');warnings.hidden=!r.warnings.length;
  warnings.replaceChildren(element('strong','','Feldolgozási korlátok'));
  const ul=element('ul');for(const w of r.warnings){const li=element('li','',`${w.file}: ${w.message} `);if(w.source)li.append(safeLink(w.source,'Forrás ↗'));ul.append(li);}warnings.append(ul);
  $('finding-search').value='';$('level-filter').value='all';$('category-filter').value='all';
  renderFindings();renderDocs();selectTab('changes');
  const provenance=$('provenance');provenance.replaceChildren();
  for(const[label,text]of [['Elemzés','Deklarációk + dokumentáció'],['Katalógus',dateLabel(r.catalog_updated_at)],['Kiinduló commit',r.from_sha.slice(0,12)],['Cél commit',r.to_sha.slice(0,12)],['Forrás',r.repository]]) {
    const dd=element('dd');if(label.includes('commit'))dd.append(safeLink(`https://github.com/${r.repository}/commit/${label==='Cél commit'?r.to_sha:r.from_sha}`,text));else dd.textContent=text;provenance.append(element('dt','',label),dd);
  }
  for(const input of document.querySelectorAll('.checklist input'))input.checked=false;
}

function cleanDeclaration(value) {if(Array.isArray(value))return value.map(cleanDeclaration);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!k.startsWith('_')).map(([k,v])=>[k,cleanDeclaration(v)]));return value;}
function renderFindings() {
  if(!state.report)return;
  const query=$('finding-search').value.toLocaleLowerCase('hu'),level=$('level-filter').value,category=$('category-filter').value;
  const filtered=state.report.findings.filter(f=>(level==='all'||f.level===level)&&(category==='all'||f.category===category)&&`${f.title} ${f.detail} ${f.condition} ${f.action}`.toLocaleLowerCase('hu').includes(query));
  const rank={required:0,conditional:1,review:2,info:3};filtered.sort((a,b)=>rank[a.level]-rank[b.level]);
  $('filter-count').textContent=`${filtered.length} / ${state.report.findings.length} változás`;
  const list=$('findings-list');list.replaceChildren();
  if(!filtered.length){const empty=element('div','empty-state');empty.append(element('strong','',state.report.findings.length?'Nincs a szűrésnek megfelelő változás.':'Nem találtunk eltérő deklarációt.'),document.createTextNode(state.report.findings.length?'Módosítsd a keresést vagy a szűrőket.':'A migrációs dokumentumokat és a működésbeli hatásokat ettől még ellenőrizd.'));list.append(empty);return;}
  filtered.forEach((f,index)=>{
    const item=element('details',`finding ${f.level}`);item.open=index<2;
    const summary=element('summary'),symbol=element('span','finding-icon');symbol.append(icon(levelIcons[f.level]));
    const heading=element('div'),labels=element('div','finding-labels');labels.append(element('span',`badge ${f.level}`,levelLabels[f.level]),element('span','category-label',categoryLabels[f.category]));heading.append(element('div','finding-title',f.title),labels);summary.append(symbol,heading);
    const body=element('div','finding-body');body.append(element('p','',f.detail));
    const condition=element('div','condition');condition.append(element('strong','','Mikor érint? '),document.createTextNode(f.condition));body.append(condition);
    const action=element('p','action');action.append(element('strong','','Teendő: '),document.createTextNode(f.action));body.append(action);
    const pair=element('div','code-pair');
    const codeBefore=f.sample?.before??(f.before===null?'# Nincs deklaráció':hcl(cleanDeclaration(f.before)));
    const codeAfter=f.sample?.after??(f.after===null?'# Nincs deklaráció':hcl(cleanDeclaration(f.after)));
    for(const[label,text,cls]of [[f.sample?'Előtte · általános példa':'Régi deklaráció',codeBefore,'old'],[f.sample?'Utána · általános példa':'Új deklaráció',codeAfter,'new']]) {const box=element('div',`code-box ${cls}`);box.append(element('div','code-label',label),element('pre','',text));pair.append(box);}body.append(pair);
    const sources=element('div','sources');sources.append(element('span','','Bizonyíték:'));
    f.sources.forEach((url,i)=>{const a=safeLink(url,`Forrás ${i+1}`);a.append(icon('external'));sources.append(a);});body.append(sources);
    item.append(summary,body);list.append(item);
  });
}

function renderDocs() {
  const list=$('docs-list');list.replaceChildren();
  if(!state.documents.length){const empty=element('div','empty-state');empty.append(element('strong','','Nem találtunk releváns migrációs dokumentumot.'),document.createTextNode('Ez nem jelenti azt, hogy nincs szükség migrációra. Ellenőrizd a modul karbantartójának dokumentációját.'));list.append(empty);return;}
  for(const doc of state.documents){const details=element('details','document');details.append(element('summary','',`${doc.kind==='guide'?'Útmutató':'Changelog'} · ${doc.path}`),safeLink(doc.url,`Eredeti dokumentum · ${doc.tag} ↗`),element('pre','',doc.text));list.append(details);}
}

function selectTab(tab,focus=false) {for(const name of ['changes','docs']) {const active=tab===name;$(`tab-${name}`).classList.toggle('selected',active);$(`tab-${name}`).setAttribute('aria-selected',String(active));$(`tab-${name}`).tabIndex=active?0:-1;$(`${name}-panel`).hidden=!active;if(active&&focus)$(`tab-${name}`).focus();}}
function showMethod() {$('method-dialog').showModal();document.body.classList.add('dialog-open');}
function closeMethod() {$('method-dialog').close();}
function exportReport(kind) {
  if(!state.report)return;
  if(kind==='print') {
    const details=[...document.querySelectorAll('#findings-list details')],previous=details.map(d=>d.open);
    details.forEach(d=>d.open=true);window.addEventListener('afterprint',()=>details.forEach((d,i)=>d.open=previous[i]),{once:true});window.print();return;
  }
  const content=kind==='json'?JSON.stringify({...state.report,documents:state.documents.map(({text,...doc})=>doc)},null,2):markdownReport(state.report,state.documents);
  const blob=new Blob([content],{type:kind==='json'?'application/json;charset=utf-8':'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download=`modulelens-${state.module.id}-${state.report.from}-${state.report.to}.${kind==='json'?'json':'md'}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

$('nav-compare').addEventListener('click',()=>setNav('compare'));
$('nav-catalog').addEventListener('click',()=>setNav('catalog'));
for(const id of ['nav-method','footer-method','catalog-method-button'])$(id).addEventListener('click',showMethod);
for(const id of ['close-method','method-done'])$(id).addEventListener('click',closeMethod);
$('method-dialog').addEventListener('close',()=>document.body.classList.remove('dialog-open'));
$('module-select').addEventListener('change',()=>void chooseModule($('module-select').value));
$('from-select').addEventListener('change',()=>void versionChanged());$('to-select').addEventListener('change',()=>void versionChanged());
$('scope-select').addEventListener('change',invalidateReport);
$('compare-button').addEventListener('click',()=>void runComparison());
for(const engine of ['terraform','opentofu'])$(`engine-${engine}`).addEventListener('click',()=>{if(engine==='terraform'){location.assign('./');return;}if(state.engine===engine)return;state.engine=engine;updateEngine();if(state.module)void chooseModule(state.module.id,$('from-select').value,$('to-select').value,$('scope-select').value);});
function updateEngine() {for(const engine of ['terraform','opentofu']){$(`engine-${engine}`).classList.toggle('selected',state.engine===engine);$(`engine-${engine}`).setAttribute('aria-pressed',String(state.engine===engine));}}
for(const id of ['finding-search','level-filter','category-filter'])$(id).addEventListener(id==='finding-search'?'input':'change',renderFindings);
for(const name of ['changes','docs'])$(`tab-${name}`).addEventListener('click',()=>selectTab(name));
document.querySelector('.tabs').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();selectTab(event.key==='Home'?'changes':event.key==='End'?'docs':$('tab-changes').getAttribute('aria-selected')==='true'?'docs':'changes',true);}});
$('catalog-search').addEventListener('input',()=>{const query=$('catalog-search').value.toLowerCase();for(const card of $('catalog-grid').children)card.hidden=!card.dataset.search.includes(query);});
$('export-select').addEventListener('change',()=>{exportReport($('export-select').value);$('export-select').value='';});
$('share-button').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);toast('A riport linkjét kimásoltuk.');}catch{message(`A másolás nem engedélyezett. A riport megosztható linkje: ${location.href}`);}});
$('theme-toggle').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(theme);try{localStorage.setItem('modulelens-theme',theme);}catch{/* Storage may be disabled. */}});
function applyTheme(theme) {document.documentElement.dataset.theme=theme;$('theme-label').textContent=theme==='dark'?'Világos megjelenés':'Sötét megjelenés';}
try{applyTheme(localStorage.getItem('modulelens-theme')||'light');}catch{applyTheme('light');}

async function boot() {
  try {
    const catalog=await fetchJSON('./data/catalog.json');
    if(catalog.schema_version!==1||!Array.isArray(catalog.modules)||!catalog.modules.length)throw new Error('A modulkatalógus üres vagy nem támogatott formátumú.');
    state.catalog=catalog;fillCatalog();
    $('catalog-state').textContent=`${catalog.modules.length} modul · ${dateLabel(catalog.generated_at)}`;
    state.engine='opentofu';updateEngine();
    const id=params.get('module')||catalog.modules[0].id;
    await chooseModule(id,params.get('from'),params.get('to'),params.get('scope')||'.');
    if(catalog.errors?.length)message('A katalógus frissítése nem minden modulnál sikerült. Az érintett modulok korábbi adatai szerepelhetnek.');
  } catch(error) {$('catalog-state').textContent='Katalógus nem érhető el';message(`${error.message} Helyi futtatáshoz HTTP-kiszolgálót használj (npm run serve).`,true);}
  try {const site=await fetchJSON('./site.json');if(site.repository_url){const link=safeLink(site.repository_url,'Forráskód a GitHubon ↗','source-link');link.id='project-link';$('project-link').replaceWith(link);}}
  catch {/* Repository branding is optional for local use. */}
}
export const ready = boot();

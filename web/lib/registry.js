/** Terraform Registry metadata comparison, adapted from the supplied Python prototype. */
export const ADDRESS_RE=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const VERSION_RE=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const registryURL=(module,version,submodule='')=>`https://registry.terraform.io/modules/${module}/${encodeURIComponent(version)}${submodule?'/submodules/'+submodule.replace(/^modules\//,'').split('/').map(encodeURIComponent).join('/'):''}`;

export function moduleAddress(value){
  let input=value.trim(),submodule='',version='';
  if(/^https?:\/\//i.test(input)){
    const url=new URL(input);
    if(url.protocol!=='https:'||url.hostname!=='registry.terraform.io'||url.username||url.password||url.port)throw new Error('Csak a hivatalos Terraform Registry modul-URL-je használható.');
    const parts=url.pathname.replace(/^\/modules\//,'').replace(/\/$/,'').split('/');
    input=parts.slice(0,3).join('/');version=parts[3]&&VERSION_RE.test(parts[3])?parts[3]:'';
    const at=parts.indexOf('submodules');if(at!==-1&&parts[at+1])submodule='modules/'+parts.slice(at+1).join('/');
  }else{
    input=input.replace(/^registry\.terraform\.io\//,'');
    const pieces=input.split('//');input=pieces[0];submodule=pieces[1]||'';
  }
  if(!ADDRESS_RE.test(input))throw new Error('A modul formátuma: névtér/név/provider. Registry-oldal URL-jét is megadhatod.');
  if(submodule&&!/^[\w-]+(?:\/[\w-]+)*$/.test(submodule))throw new Error('Érvénytelen almodulútvonal.');
  return {address:input,submodule,version};
}

export function versionCompare(a,b){
  const pa=VERSION_RE.exec(a),pb=VERSION_RE.exec(b);
  if(!pa||!pb)throw new Error('A Registry szemverziós verzióját válaszd.');
  for(let i=1;i<=3;i++){const x=BigInt(pa[i]),y=BigInt(pb[i]);if(x!==y)return x<y?-1:1;}
  if(!pa[4]&&!pb[4])return 0;if(!pa[4])return 1;if(!pb[4])return -1;
  const aa=pa[4].split('.'),bb=pb[4].split('.');
  for(let i=0;i<Math.max(aa.length,bb.length);i++){
    if(aa[i]===undefined)return -1;if(bb[i]===undefined)return 1;if(aa[i]===bb[i])continue;
    const an=/^\d+$/.test(aa[i]),bn=/^\d+$/.test(bb[i]);
    if(an&&bn)return BigInt(aa[i])<BigInt(bb[i])?-1:1;
    if(an!==bn)return an?-1:1;
    return aa[i]<bb[i]?-1:1;
  }return 0;
}

export function versionInfo(payload,module){
  const entry=payload.modules?.find(item=>String(item.source).toLowerCase()===module.toLowerCase());
  if(!entry||!Array.isArray(entry.versions))throw new Error('A Registry nem adott érvényes verziólistát.');
  const versions=entry.versions.filter(v=>typeof v.version==='string'&&VERSION_RE.test(v.version)).map(v=>({version:v.version,submodules:[...new Set((v.submodules||[]).map(s=>s.path).filter(p=>typeof p==='string'&&/^[\w-]+(?:\/[\w-]+)*$/.test(p)))].sort()}));
  return [...new Map(versions.map(v=>[v.version,v])).values()].sort((a,b)=>versionCompare(b.version,a.version));
}
const labels={type:'típus',default:'alapérték',required:'kötelező jelölés',description:'leírás',sensitive:'érzékenység',version:'verziókorlát',source:'forrás',aliases:'aliasok'};
const required=item=>item.required===true||item.required==='true'?true:item.required===false||item.required==='false'?false:null;
function signature(item,category){
  const keys=category==='inputs'?['type','default','required','description','sensitive']:category==='outputs'?['description','sensitive']:['name','type','namespace','source','version','aliases'];
  return Object.fromEntries(keys.filter(key=>has(item,key)).map(key=>[key,item[key]]));
}
function similarity(a,b){
  const rows=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)rows[i][j]=a[i-1]===b[j-1]?rows[i-1][j-1]+1:Math.max(rows[i-1][j],rows[i][j-1]);
  return 2*rows[a.length][b.length]/(a.length+b.length||1);
}

export function compareRegistry(module,from,to,submodule,oldData,newData){
  if(!ADDRESS_RE.test(module)||!VERSION_RE.test(from)||!VERSION_RE.test(to))throw new Error('Érvénytelen modul vagy verzió.');
  if(versionCompare(from,to)>=0)throw new Error('A célverziónak újabbnak kell lennie a jelenlegi verziónál.');
  for(const [data,version]of [[oldData,from],[newData,to]]){
    if(data.version!==version||`${data.namespace}/${data.name}/${data.provider}`.toLowerCase()!==module.toLowerCase())throw new Error('A Registry válasza nem a kiválasztott modulverzióhoz tartozik.');
  }
  const part=data=>submodule?(data.submodules||[]).find(item=>item.path===submodule):data.root;
  const old=part(oldData),next=part(newData),changes=[];
  const sources=[registryURL(module,from,submodule),registryURL(module,to,submodule)];
  const add=change=>changes.push({...change,sources});
  if(!old&&!next)throw new Error('Az almodul egyik kiválasztott verzióban sem található.');
  if(!old||!next){
    add({category:'submodules',kind:next?'added':'removed',level:'attention',name:submodule,title:`${next?'Új':'Eltávolított'} almodul: ${submodule||'gyökérmodul'}`,note:next?'Az útvonal csak a célverzióban létezik.':'Ez az almodul nincs jelen a célverzióban.',condition:'Ha közvetlenül ezt az almodulútvonalat használod.',action:next?'Olvasd el az új almodul dokumentációját.':'Módosítsd a source útvonalat dokumentált helyettesítőre, vagy válassz másik célverziót.',before:old?{path:submodule}:null,after:next?{path:submodule}:null});
  }else{
    for(const category of ['inputs','outputs']){
      const a=Object.fromEntries((old[category]||[]).filter(x=>typeof x.name==='string').map(x=>[x.name,x]));
      const b=Object.fromEntries((next[category]||[]).filter(x=>typeof x.name==='string').map(x=>[x.name,x]));
      const label=category==='inputs'?'bemenet':'output';
      for(const name of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){
        const x=a[name],y=b[name];
        if(!x){
          const req=category==='inputs'?required(y):false;
          add({category,kind:'added',level:req===true?'attention':req===null?'review':'info',name,title:`Új ${req===true?'kötelező ':''}${label}: ${name}`,note:req===null?'A Registry nem közli egyértelműen a kötelezőséget.':'Új elem a célverzióban.',condition:req===true?'Minden modulhívásnál.':req===null?'A karbantartó deklarációja alapján.':'Ha használni szeretnéd az új lehetőséget.',action:req===true?`Add meg a(z) ${name} bemenetet a modulhívásban.`:req===null?'Ellenőrizd a változó deklarációját a forrásban.':'A használatához opcionálisan módosíthatod a kódot.',before:null,after:signature(y,category)});
        }else if(!y){
          add({category,kind:'removed',level:'attention',name,title:`Eltávolított ${label}: ${name}`,note:'Ez a név nem szerepel a célverzióban.',condition:category==='inputs'?`Ha átadod a(z) ${name} bemenetet.`:`Ha hivatkozol a module.<név>.${name} outputra.`,action:category==='inputs'?'Távolítsd el a régi argumentumot, és ellenőrizd a dokumentált helyettesítést.':'Módosítsd a kimenetre épülő hivatkozásokat dokumentált helyettesítőre.',before:signature(x,category),after:null});
        }else{
          const before=signature(x,category),after=signature(y,category);
          const fields=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!same(before[key],after[key]));
          if(!fields.length)continue;
          const availability=fields.some(key=>!has(before,key)||!has(after,key));
          const important=fields.some(key=>['type','default','required','sensitive'].includes(key));
          const defaultChange=fields.includes('default'),typeChange=fields.includes('type');
          add({category,kind:'changed',level:availability?'review':important?'attention':'info',name,title:`Módosult ${label}: ${name}`,note:`Változott: ${fields.map(f=>labels[f]||f).join(', ')}.${availability?' Egyes mezők korábban vagy most nincsenek közzétéve; ez metaadat-eltérés is lehet.':''}`,condition:defaultChange?`Ha a(z) ${name} értékét nem adod meg külön.`:`Ha használod a(z) ${name} ${label}et.`,action:availability?'Ellenőrizd a forrást: egy hiányzó Registry-mező nem bizonyít kódváltozást.':typeChange?'Igazítsd az átadott értéket az új típushoz, amennyiben a jelenlegi érték nem kompatibilis.':defaultChange?'Döntsd el, megfelelő-e az új alapérték. A régi viselkedés megőrzéséhez adj meg explicit értéket.':fields.includes('required')?'Ellenőrizd, hogy az új verzióban kötelező-e explicit értéket átadni.':'Nézd át a frissített leírást és a jelzett tulajdonságot.',before:Object.fromEntries(fields.map(f=>[f,has(before,f)?before[f]:'(nem közölt mező)'])),after:Object.fromEntries(fields.map(f=>[f,has(after,f)?after[f]:'(nem közölt mező)']))});
        }
      }
    }
    for(const [key,label]of [['provider_dependencies','Providerkövetelmény'],['dependencies','Belső modulfüggőség']]){
      const id=item=>item.name||item.source||[item.namespace,item.provider].filter(Boolean).join('/')||JSON.stringify(item);
      const a=Object.fromEntries((old[key]||[]).map(item=>[id(item),signature(item,key)])),b=Object.fromEntries((next[key]||[]).map(item=>[id(item),signature(item,key)]));
      for(const name of new Set([...Object.keys(a),...Object.keys(b)]))if(!same(a[name],b[name]))add({category:'dependencies',kind:!a[name]?'added':!b[name]?'removed':'changed',level:'review',name,title:`${label}: ${name}`,note:'A Registryben közzétett forrás vagy verziókorlát eltér.',condition:'A használt provider- és modulverziók függvényében.',action:'Egyeztesd a projekt verziókorlátjait, és ellenőrizd a függőség migrációs dokumentációját.',before:a[name]||null,after:b[name]||null});
    }
    const resourceSet=p=>(p.resources||[]).map(r=>`${r.type}.${r.name}`).sort();
    if(!same(resourceSet(old),resourceSet(next)))add({category:'resources',kind:'changed',level:'review',name:'resources',title:'Belső erőforráslista változott',note:'Az erőforrások Registryben megadott nevei vagy típusai eltérnek. Ez nem Terraform plan.',condition:'Az érintett erőforrások használatától függően.',action:'Nézd át a forráskülönbséget és a saját környezetben készített plan eredményét. A tényleges létrehozás vagy törlés ebből nem állapítható meg.',before:{resources:resourceSet(old)},after:{resources:resourceSet(next)}});
    for(const category of ['inputs','outputs']){
      const removed=changes.filter(c=>c.category===category&&c.kind==='removed'),added=changes.filter(c=>c.category===category&&c.kind==='added');
      const candidates=[];
      for(const a of removed)for(const b of added){const x=String(a.before.description||'').trim().toLowerCase(),y=String(b.after.description||'').trim().toLowerCase();if(x.length>=30&&x===y&&similarity(a.name,b.name)>=.5)candidates.push([a,b]);}
      for(const[a,b]of candidates)if(candidates.filter(([x])=>x===a).length===1&&candidates.filter(([,y])=>y===b).length===1)add({category,kind:'hint',level:'review',name:`${a.name} → ${b.name}`,title:`Lehetséges átnevezés: ${a.name} → ${b.name}`,note:'Hasonló név és azonos, részletes leírás. Ez nem dokumentált átnevezés.',condition:`Ha a(z) ${a.name} elemet használod.`,action:'A migrációs útmutatóban vagy a forrásban igazold a megfeleltetést, mielőtt átnevezed. A két elem külön törlésként és hozzáadásként is szerepel.',before:a.before,after:b.after});
    }
  }
  changes.sort((a,b)=>({attention:0,review:1,info:2}[a.level]-{attention:0,review:1,info:2}[b.level])||a.name.localeCompare(b.name));
  return {schema_version:2,analysis:'registry-metadata',module,from,to,submodule,changes,
    summary:{total:changes.filter(c=>c.kind!=='hint').length,added:changes.filter(c=>c.kind==='added').length,removed:changes.filter(c=>c.kind==='removed').length,changed:changes.filter(c=>c.kind==='changed').length,hints:changes.filter(c=>c.kind==='hint').length},
    registry_url:registryURL(module,to,submodule),source_url:typeof newData.source==='string'&&/^https:\/\//.test(newData.source)?newData.source:null,
    fetched_at:new Date().toISOString(),scope:'Az élő Terraform Registryben közzétett inputok, outputok, providerkövetelmények, modulfüggőségek és erőforráslisták összevetése. Az outputértékeket, validációkat, belső kifejezéseket, state-migrációt és a köztes kiadások migrációs lépéseit nem értékeli. A hiányzó eltérés nem kompatibilitási garancia.'};
}

export function registryMarkdown(report){
  const lines=['# ModuleLens — Terraform Registry riport','',`Modul: ${report.module}`,`Verziók: ${report.from} → ${report.to}`,`Almodul: ${report.submodule||'gyökérmodul'}`,`Lekérve: ${report.fetched_at}`,'',report.scope,''];
  for(const c of report.changes)lines.push(`## ${c.title}`,'',c.note,'',`Mikor érint: ${c.condition}`,'',`Teendő: ${c.action}`,'',`Régi metaadat: ${JSON.stringify(c.before)}`,`Új metaadat: ${JSON.stringify(c.after)}`,'',...c.sources.map(url=>`- ${url}`),'');
  return lines.join('\n');
}

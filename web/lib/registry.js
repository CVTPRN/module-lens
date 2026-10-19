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
    if(url.protocol!=='https:'||url.hostname!=='registry.terraform.io'||url.username||url.password||url.port)throw new Error('Only official Terraform Registry module URLs are supported.');
    const parts=url.pathname.replace(/^\/modules\//,'').replace(/\/$/,'').split('/');
    input=parts.slice(0,3).join('/');version=parts[3]&&VERSION_RE.test(parts[3])?parts[3]:'';
    const at=parts.indexOf('submodules');if(at!==-1&&parts[at+1])submodule='modules/'+parts.slice(at+1).join('/');
  }else{
    input=input.replace(/^registry\.terraform\.io\//,'');
    const pieces=input.split('//');input=pieces[0];submodule=pieces[1]||'';
  }
  if(!ADDRESS_RE.test(input))throw new Error('Use namespace/name/provider, or paste a Registry page URL.');
  if(submodule&&!/^[\w-]+(?:\/[\w-]+)*$/.test(submodule))throw new Error('Invalid submodule path.');
  return {address:input,submodule,version};
}

export function versionCompare(a,b){
  const pa=VERSION_RE.exec(a),pb=VERSION_RE.exec(b);
  if(!pa||!pb)throw new Error('Choose a semantic version from the Registry.');
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
  if(!entry||!Array.isArray(entry.versions))throw new Error('The Registry did not return a valid version list.');
  const versions=entry.versions.filter(v=>typeof v.version==='string'&&VERSION_RE.test(v.version)).map(v=>({version:v.version,submodules:[...new Set((v.submodules||[]).map(s=>s.path).filter(p=>typeof p==='string'&&/^[\w-]+(?:\/[\w-]+)*$/.test(p)))].sort()}));
  return [...new Map(versions.map(v=>[v.version,v])).values()].sort((a,b)=>versionCompare(b.version,a.version));
}
const labels={type:'type',default:'default',required:'required flag',description:'description',sensitive:'sensitivity',version:'version constraint',source:'source',aliases:'aliases'};
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
  if(!ADDRESS_RE.test(module)||!VERSION_RE.test(from)||!VERSION_RE.test(to))throw new Error('Invalid module or version.');
  if(versionCompare(from,to)>=0)throw new Error('The target version must be newer than the current version.');
  for(const [data,version]of [[oldData,from],[newData,to]]){
    if(data.version!==version||`${data.namespace}/${data.name}/${data.provider}`.toLowerCase()!==module.toLowerCase())throw new Error('The Registry response does not match the selected module version.');
  }
  const part=data=>submodule?(data.submodules||[]).find(item=>item.path===submodule):data.root;
  const old=part(oldData),next=part(newData),changes=[];
  const sources=[registryURL(module,from,submodule),registryURL(module,to,submodule)];
  const add=change=>changes.push({...change,sources});
  if(!old&&!next)throw new Error('The submodule was not found in either selected version.');
  if(!old||!next){
    add({category:'submodules',kind:next?'added':'removed',level:'attention',name:submodule,title:`${next?'New':'Removed'} submodule: ${submodule||'root module'}`,note:next?'This path exists only in the target version.':'This submodule is not present in the target version.',condition:'If you use this submodule path directly.',action:next?'Read the new submodule documentation.':'Update the source path to a documented replacement or choose another target version.',before:old?{path:submodule}:null,after:next?{path:submodule}:null});
  }else{
    for(const category of ['inputs','outputs']){
      const a=Object.fromEntries((old[category]||[]).filter(x=>typeof x.name==='string').map(x=>[x.name,x]));
      const b=Object.fromEntries((next[category]||[]).filter(x=>typeof x.name==='string').map(x=>[x.name,x]));
      const label=category==='inputs'?'input':'output';
      for(const name of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){
        const x=a[name],y=b[name];
        if(!x){
          const req=category==='inputs'?required(y):false;
          add({category,kind:'added',level:req===true?'attention':req===null?'review':'info',name,title:`New ${req===true?'required ':''}${label}: ${name}`,note:req===null?'The Registry does not clearly indicate whether this input is required.':'Added in the target version.',condition:req===true?'For every module call.':req===null?'Depending on the maintainer declaration.':'If you want to use the new capability.',action:req===true?`Provide the ${name} input in your module call.`:req===null?'Check the variable declaration in the source.':'You can optionally update your code to use it.',before:null,after:signature(y,category)});
        }else if(!y){
          add({category,kind:'removed',level:'attention',name,title:`Removed ${label}: ${name}`,note:'This name is not present in the target version.',condition:category==='inputs'?`If you pass the ${name} input.`:`If you reference the module.<name>.${name} output.`,action:category==='inputs'?'Remove the old argument and check the documented replacement.':'Update references to this output to use a documented replacement.',before:signature(x,category),after:null});
        }else{
          const before=signature(x,category),after=signature(y,category);
          const fields=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!same(before[key],after[key]));
          if(!fields.length)continue;
          const availability=fields.some(key=>!has(before,key)||!has(after,key));
          const important=fields.some(key=>['type','default','required','sensitive'].includes(key));
          const defaultChange=fields.includes('default'),typeChange=fields.includes('type');
          add({category,kind:'changed',level:availability?'review':important?'attention':'info',name,title:`Changed ${label}: ${name}`,note:`Changed: ${fields.map(f=>labels[f]||f).join(', ')}.${availability?' Some fields are unpublished in one version; this may be a metadata difference.':''}`,condition:defaultChange?`If you do not explicitly set ${name}.`:`If you use the ${name} ${label}.`,action:availability?'Check the source: a missing Registry field does not prove a code change.':typeChange?'Adapt the supplied value to the new type if the current value is incompatible.':defaultChange?'Decide whether the new default is suitable. Set an explicit value to preserve the previous behavior.':fields.includes('required')?'Check whether the new version requires an explicit value.':'Review the updated description and the indicated property.',before:Object.fromEntries(fields.map(f=>[f,has(before,f)?before[f]:'(field not published)'])),after:Object.fromEntries(fields.map(f=>[f,has(after,f)?after[f]:'(field not published)']))});
        }
      }
    }
    for(const [key,label]of [['provider_dependencies','Provider requirement'],['dependencies','Internal module dependency']]){
      const id=item=>item.name||item.source||[item.namespace,item.provider].filter(Boolean).join('/')||JSON.stringify(item);
      const a=Object.fromEntries((old[key]||[]).map(item=>[id(item),signature(item,key)])),b=Object.fromEntries((next[key]||[]).map(item=>[id(item),signature(item,key)]));
      for(const name of new Set([...Object.keys(a),...Object.keys(b)]))if(!same(a[name],b[name]))add({category:'dependencies',kind:!a[name]?'added':!b[name]?'removed':'changed',level:'review',name,title:`${label}: ${name}`,note:'The published Registry source or version constraint differs.',condition:'Depending on the provider and module versions you use.',action:'Align your project version constraints and review the dependency migration documentation.',before:a[name]||null,after:b[name]||null});
    }
    const resourceSet=p=>(p.resources||[]).map(r=>`${r.type}.${r.name}`).sort();
    if(!same(resourceSet(old),resourceSet(next)))add({category:'resources',kind:'changed',level:'review',name:'resources',title:'Internal resource list changed',note:'Resource names or types listed in the Registry differ. This is not a Terraform plan.',condition:'Depending on your use of the affected resources.',action:'Review the source diff and a plan from your own environment. Actual resource creation or deletion cannot be determined from this list.',before:{resources:resourceSet(old)},after:{resources:resourceSet(next)}});
    for(const category of ['inputs','outputs']){
      const removed=changes.filter(c=>c.category===category&&c.kind==='removed'),added=changes.filter(c=>c.category===category&&c.kind==='added');
      const candidates=[];
      for(const a of removed)for(const b of added){const x=String(a.before.description||'').trim().toLowerCase(),y=String(b.after.description||'').trim().toLowerCase();if(x.length>=30&&x===y&&similarity(a.name,b.name)>=.5)candidates.push([a,b]);}
      for(const[a,b]of candidates)if(candidates.filter(([x])=>x===a).length===1&&candidates.filter(([,y])=>y===b).length===1)add({category,kind:'hint',level:'review',name:`${a.name} → ${b.name}`,title:`Possible rename: ${a.name} → ${b.name}`,note:'Similar names and identical detailed descriptions. This is not a documented rename.',condition:`If you use ${a.name}.`,action:'Confirm the mapping in the migration guide or source before renaming. Both items are also listed separately as a removal and an addition.',before:a.before,after:b.after});
    }
  }
  changes.sort((a,b)=>({attention:0,review:1,info:2}[a.level]-{attention:0,review:1,info:2}[b.level])||a.name.localeCompare(b.name));
  return {schema_version:2,analysis:'registry-metadata',module,from,to,submodule,changes,
    summary:{total:changes.filter(c=>c.kind!=='hint').length,added:changes.filter(c=>c.kind==='added').length,removed:changes.filter(c=>c.kind==='removed').length,changed:changes.filter(c=>c.kind==='changed').length,hints:changes.filter(c=>c.kind==='hint').length},
    registry_url:registryURL(module,to,submodule),source_url:typeof newData.source==='string'&&/^https:\/\//.test(newData.source)?newData.source:null,
    fetched_at:new Date().toISOString(),scope:'Compares inputs, outputs, provider requirements, module dependencies and resource lists published in the live Terraform Registry. Output values, validations, internal expressions, state migrations and migration steps for intermediate releases are not evaluated. Finding no differences is not a guarantee of compatibility.'};
}

export function registryMarkdown(report){
  const lines=['# ModuleLens — Terraform Registry report','',`Module: ${report.module}`,`Versions: ${report.from} → ${report.to}`,`Submodule: ${report.submodule||'root module'}`,`Fetched: ${report.fetched_at}`,'',report.scope,''];
  for(const c of report.changes)lines.push(`## ${c.title}`,'',c.note,'',`When this applies: ${c.condition}`,'',`Action: ${c.action}`,'',`Previous metadata: ${JSON.stringify(c.before)}`,`New metadata: ${JSON.stringify(c.after)}`,'',...c.sources.map(url=>`- ${url}`),'');
  return lines.join('\n');
}

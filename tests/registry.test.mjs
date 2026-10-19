import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {moduleAddress,versionCompare,versionInfo,compareRegistry,registryMarkdown} from '../web/lib/registry.js';
import {upstreamURL,handleRegistry} from '../server/registry-proxy.js';
const module='example/network/aws';
const data=(version,root={})=>({version,namespace:'example',name:'network',provider:'aws',root:{inputs:[],outputs:[],provider_dependencies:[],dependencies:[],resources:[],...root},submodules:[]});
const compare=(a,b)=>compareRegistry(module,'1.0.0','2.0.0','',data('1.0.0',a),data('2.0.0',b));
test('Registry addresses and full URLs are accepted without allowing arbitrary origins',()=>{
  assert.equal(moduleAddress('registry.terraform.io/Azure/network/azurerm').address,'Azure/network/azurerm');
  assert.deepEqual(moduleAddress('https://registry.terraform.io/modules/example/network/aws/2.0.0/submodules/child'),{address:module,submodule:'modules/child',version:'2.0.0'});
  assert.equal(moduleAddress(module+'//modules/child').submodule,'modules/child');
  for(const value of ['https://evil.test/modules/a/b/c','https://registry.terraform.io.evil.test/modules/a/b/c','a/b/c/../../secret','a/b/c//../../file'])assert.throws(()=>moduleAddress(value));
});
test('full SemVer precedence handles prereleases and ignores build metadata',()=>{
  assert.equal(versionCompare('2.10.0','2.9.0'),1);assert.equal(versionCompare('1.0.0','1.0.0-rc.10'),1);
  assert.equal(versionCompare('1.0.0-rc.10','1.0.0-rc.2'),1);assert.equal(versionCompare('1.0.0-1','1.0.0-alpha'),-1);
  assert.equal(versionCompare('1.0.0+one','1.0.0+two'),0);assert.throws(()=>versionCompare('2.0','2.0.0'));
});
test('all published module versions are returned, without curated version limits',()=>{
  const versions=Array.from({length:1200},(_,i)=>({version:`1.${i}.0`,submodules:[{path:'modules/child'}]}));
  const result=versionInfo({modules:[{source:module,versions}]},module);
  assert.equal(result.length,1200);assert.equal(result[0].version,'1.1199.0');assert.deepEqual(result[0].submodules,['modules/child']);
});
test('Registry required flag is authoritative; ambiguous default strings do not imply optionality',()=>{
  const r=compare({}, {inputs:[{name:'unknown',default:''},{name:'required',required:true},{name:'optional',required:false,default:'null'}]});
  assert.equal(r.changes.find(c=>c.name==='unknown').level,'review');
  assert.equal(r.changes.find(c=>c.name==='required').level,'attention');
  assert.equal(r.changes.find(c=>c.name==='optional').level,'info');
});
test('removed inputs and outputs include caller-specific conditions and actions',()=>{
  const r=compare({inputs:[{name:'old',required:false}],outputs:[{name:'removed'}]},{});
  assert.match(r.changes.find(c=>c.name==='old').condition,/Ha átadod/);assert.match(r.changes.find(c=>c.name==='removed').condition,/Ha hivatkozol/);
  assert.ok(r.changes.every(c=>c.sources.every(s=>s.startsWith('https://registry.terraform.io/'))));
});
test('newly available metadata is reported as review rather than a certain breaking code change',()=>{
  const r=compare({inputs:[{name:'x',default:'null'}]},{inputs:[{name:'x',default:'null',type:'string'}]});
  assert.equal(r.changes[0].level,'review');assert.match(r.changes[0].action,/nem bizonyít/);
});
test('default, type and required changes are detected',()=>{
  const r=compare({inputs:[{name:'x',type:'any',default:'null',required:false}]},{inputs:[{name:'x',type:'string',default:'"new"',required:true}]});
  assert.match(r.changes[0].note,/típus/);assert.match(r.changes[0].note,/alapérték/);assert.match(r.changes[0].note,/kötelező/);
});
test('provider requirements and resource inventories appear without claiming a plan',()=>{
  const r=compare({provider_dependencies:[{name:'aws',version:'>=4'}],resources:[{type:'aws_vpc',name:'old'}]},{provider_dependencies:[{name:'aws',version:'>=5'}],resources:[{type:'aws_vpc',name:'new'}]});
  assert.ok(r.changes.some(c=>c.category==='dependencies'));assert.match(r.changes.find(c=>c.category==='resources').note,/nem Terraform plan/);
});
test('potential rename remains a hint and does not suppress separate addition or removal',()=>{
  const description='The human readable name of this particular network infrastructure resource.';
  const r=compare({inputs:[{name:'cluster_name',description,required:false}]},{inputs:[{name:'name',description,required:false}]});
  assert.equal(r.summary.hints,1);assert.equal(r.summary.added,1);assert.equal(r.summary.removed,1);assert.match(r.changes.find(c=>c.kind==='hint').note,/nem dokumentált/);
});
test('submodule removal is detected, and unrelated module or missing versions are rejected',()=>{
  const a=data('1.0.0'),b=data('2.0.0');a.submodules=[{path:'modules/child',inputs:[],outputs:[]}];
  assert.equal(compareRegistry(module,'1.0.0','2.0.0','modules/child',a,b).changes[0].kind,'removed');
  b.namespace='other';assert.throws(()=>compareRegistry(module,'1.0.0','2.0.0','',a,b));
});
test('Markdown includes actionable conditions, Registry evidence and scope limitation',()=>{
  const report=compare({inputs:[{name:'old'}]},{}),md=registryMarkdown(report);
  assert.match(md,/Mikor érint/);assert.match(md,/Teendő/);assert.match(md,/registry.terraform.io/);assert.match(md,/nem kompatibilitási garancia/);
});
test('real EC2 module, outside the initial catalog, compares published 5.0.0 and 6.0.0 data',()=>{
  const get=name=>JSON.parse(readFileSync(new URL(`fixtures/registry/${name}.json`,import.meta.url),'utf8'));
  const result=compareRegistry('terraform-aws-modules/ec2-instance/aws','5.0.0','6.0.0','',get('before'),get('after'));
  assert.ok(result.changes.length>0);assert.ok(versionInfo(get('versions'),'terraform-aws-modules/ec2-instance/aws').length>50);
});
test('proxy search supports full listing, arbitrary provider, query and offset pagination',()=>{
  const url=upstreamURL(new URL('https://site.test/api/registry/search?q=&provider=random_provider&offset=480&limit=24'));
  assert.match(url,/https:\/\/registry.terraform.io\/v1\/modules\?/);assert.match(url,/offset=480/);assert.match(url,/provider=random_provider/);
});
test('proxy rejects path traversal, invalid pagination, excessive query length and arbitrary URLs',()=>{
  for(const params of ['module=https://evil.test','module=a/b/c/../../secret','module=a/b/c&version=../../x'])assert.throws(()=>upstreamURL(new URL('https://site.test/api/registry/module?'+params)));
  for(const params of ['offset=-1','limit=1000','q='+'x'.repeat(101)])assert.throws(()=>upstreamURL(new URL('https://site.test/api/registry/search?'+params)));
});
test('health and method rejection never contact upstream',async()=>{
  const fail=()=>assert.fail('Unexpected upstream request');
  assert.equal((await handleRegistry(new Request('https://site.test/api/registry/health'),fail)).status,200);
  assert.equal((await handleRegistry(new Request('https://site.test/api/registry/search',{method:'POST'}),fail)).status,405);
});
test('proxy follows no redirects and forwards no visitor credentials',async()=>{
  const response=await handleRegistry(new Request('https://site.test/api/registry/search?q=safe-proxy-test',{headers:{Cookie:'secret',Authorization:'Bearer private'}}),async(url,options)=>{
    assert.ok(url.startsWith('https://registry.terraform.io/v1/modules/'));assert.equal(options.redirect,'manual');assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Authorization,undefined);
    return new Response(JSON.stringify({modules:[],meta:{}}));
  });assert.equal(response.status,200);
});
test('proxy translates 404, rate limiting, bad JSON and oversize replies into actionable errors',async()=>{
  for(const [key,status,expected]of [['missing',404,404],['limit',429,503],['redirect',302,502]]){
    const r=await handleRegistry(new Request(`https://site.test/api/registry/search?q=proxy-${key}`),async()=>new Response('',{status}));assert.equal(r.status,expected);
  }
  assert.equal((await handleRegistry(new Request('https://site.test/api/registry/search?q=proxy-invalid'),async()=>new Response('not JSON'))).status,502);
  assert.equal((await handleRegistry(new Request('https://site.test/api/registry/search?q=proxy-large'),async()=>new Response('{}',{headers:{'Content-Length':'20000000'}}))).status,502);
});
test('proxy caches public results to avoid repeated Registry requests',async()=>{
  let calls=0;const request=new Request('https://site.test/api/registry/search?q=proxy-cache-test'),fetcher=async()=>{calls++;return new Response('{"modules":[]}');};
  await handleRegistry(request,fetcher);await handleRegistry(request,fetcher);assert.equal(calls,1);
});

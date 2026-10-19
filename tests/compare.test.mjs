import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {compareSnapshots,compareVersions,migrationDocuments,markdownReport} from '../web/lib/compare.js';

function scope(extra={}) {return {inputs:{},outputs:{},providers:{},requirements:[],language:[],resources:{},children:{},moves:[],removals:[],imports:[],warnings:[],files:[],...extra};}
function snap(tag,extra={},scopePath='.') {return {schema_version:1,tag,sha:tag==='v1.0.0'?'a'.repeat(40):'b'.repeat(40),engine:'terraform',repository:'example/module',scopes:{[scopePath]:scope(extra)},documents:[],renames:[]};}
function compare(a,b) {return compareSnapshots(snap('v1.0.0',a),snap('v2.0.0',b));}

test('semantic version ordering, including 2.10 versus 2.9',()=>{assert.equal(compareVersions('v2.10.0','v2.9.0'),1);assert.equal(compareVersions('1.0.0','v1.0.0'),0);assert.throws(()=>compareVersions('v1.0.0-beta','2.0.0'));});
test('identical declarations with different evidence URLs are not changes',()=>{const r=compare({inputs:{x:{default:null,_source:'old'}}},{inputs:{x:{default:null,_source:'new'}}});assert.equal(r.findings.length,0);assert.equal(r.status,'no-breaking-found');});
test('explicit null makes a new input optional',()=>{const r=compare({},{inputs:{x:{default:null}}});assert.equal(r.counts.info,1);assert.equal(r.counts.required,0);});
test('new input without default is mandatory',()=>{assert.equal(compare({},{inputs:{x:{type:'string'}}}).counts.required,1);});
test('removing a default is conditional on the caller omitting the input',()=>{const r=compare({inputs:{x:{default:null}}},{inputs:{x:{}}});assert.equal(r.counts.required,1);assert.match(r.findings[0].condition,/previously omitted/);});
test('removed input is conditional rather than universally breaking',()=>{const r=compare({inputs:{x:{default:1}}},{});assert.equal(r.counts.conditional,1);assert.match(r.findings[0].condition,/If you pass/);});
test('default change surfaces behavior risk',()=>{const r=compare({inputs:{x:{default:false}}},{inputs:{x:{default:true}}});assert.equal(r.counts.review,1);});
test('type and validation changes are detected separately',()=>{const r=compare({inputs:{x:{type:'string',validation:[{condition:'a'}]}}},{inputs:{x:{type:'number',validation:[{condition:'b'}]}}});assert.equal(r.counts.conditional,2);});
test('documented rename requires actual removed/added inputs',()=>{const a=snap('v1.0.0',{inputs:{old:{default:1}}}),b=snap('v2.0.0',{inputs:{next:{default:1}}});b.renames=[{from:'old',to:'next',source:'https://github.com/a/b/blob/sha/docs.md'}];const r=compareSnapshots(a,b);assert.equal(r.findings.length,1);assert.match(r.findings[0].title,/old → next/);assert.ok(r.findings[0].sample);});
test('no rename guessed from similar names',()=>{const r=compare({inputs:{old_name:{default:1}}},{inputs:{new_name:{default:1}}});assert.equal(r.findings.length,2);assert.ok(r.findings.every(f=>!f.title.includes('→')));});
test('ambiguous documented rename stays as independent changes',()=>{const a=snap('v1.0.0',{inputs:{old:{default:1}}}),b=snap('v2.0.0',{inputs:{a:{default:1},b:{default:1}}});b.renames=[{from:'old',to:'a'},{from:'old',to:'b'}];assert.equal(compareSnapshots(a,b).findings.length,3);});
test('removed output affects only callers referencing it',()=>{assert.equal(compare({outputs:{x:{value:'abc'}}},{}).counts.conditional,1);});
test('provider and CLI constraints compared as declarations',()=>{const r=compare({providers:{aws:{requirement:{version:'>=4'},source:'old'}},requirements:[{constraint:'>=1.0'}]},{providers:{aws:{requirement:{version:'>=5'},source:'new'}},requirements:[{constraint:'>=1.5'}]});assert.equal(r.counts.review,2);});
test('same language setting at different commits does not create false positives',()=>{assert.equal(compare({language:[{settings:{edition:'1.10'},source:'old'}]},{language:[{settings:{edition:'1.10'},source:'new'}]}).findings.length,0);});
test('resource changes do not assert actual destruction or replacement',()=>{const r=compare({resources:{'aws_vpc.this':{hash:'old',source:'a'}}},{resources:{'aws_vpc.this':{hash:'new',source:'b'}}});assert.equal(r.counts.review,1);assert.match(r.findings[0].action,/cannot be determined/);});
test('moved declarations are visible without recommending automatic state mutation',()=>{const r=compare({},{moves:[{body:{from:'old',to:'new'},source:'evidence'}]});assert.equal(r.findings[0].category,'state');assert.match(r.findings[0].action,/does not require manual/);});
test('parser warning overrides a clean verdict',()=>{assert.equal(compare({},{warnings:[{file:'x.tf',message:'parse failed'}]}).status,'incomplete');});
test('file-level safety net exposes unmodeled locals or data-source changes',()=>{const r=compare({files:[{path:'locals.tf',sha256:'old',url:'a'}]},{files:[{path:'locals.tf',sha256:'new',url:'b'}]});assert.equal(r.counts.review,1);assert.match(r.findings[0].detail,/locals/);});
test('removed submodule is reported explicitly',()=>{const b=snap('v2.0.0');b.scopes={};assert.equal(compareSnapshots(snap('v1.0.0'),b).status,'required');});
test('invalid direction, different modules or engine cannot be compared',()=>{assert.throws(()=>compareSnapshots(snap('v2.0.0'),snap('v1.0.0')));const b=snap('v2.0.0');b.engine='opentofu';assert.throws(()=>compareSnapshots(snap('v1.0.0'),b));});
test('changelog is filtered to full intermediate range with correct numerical ordering',()=>{const b=snap('v2.10.0');b.documents=[{path:'CHANGELOG.md',url:'x',text:'# 2.11.0\nFuture\n# 2.10.0\nTen\n# 2.9.0\nNine\n# 2.8.0\nEight'}];const docs=migrationDocuments([b],'v2.8.0','v2.10.0');assert.match(docs[0].text,/Ten/);assert.match(docs[0].text,/Nine/);assert.doesNotMatch(docs[0].text,/Future|Eight/);});
test('major guides outside the upgrade range are excluded',()=>{const b=snap('v3.0.0');b.documents=[1,2,3,4].map(n=>({path:`docs/UPGRADE-${n}.0.md`,url:'x',text:`Guide ${n}`}));assert.deepEqual(migrationDocuments([b],'v1.0.0','v3.0.0').map(d=>d.path),['docs/UPGRADE-2.0.md','docs/UPGRADE-3.0.md']);});
test('Markdown report preserves conditions and immutable provenance',()=>{const r=compare({inputs:{x:{default:1}}},{}),md=markdownReport(r);assert.match(md,/If you pass/);assert.match(md,/a{40}/);assert.match(md,/does not guarantee/);});

test('real EKS v20 to v21 upgrade includes verified renames and dependency changes',()=>{
  const get=(tag)=>JSON.parse(gunzipSync(readFileSync(new URL(`../web/data/aws-eks/terraform/${tag}.json.gz`,import.meta.url))));
  const r=compareSnapshots(get('v20.37.1'),get('v21.0.0'));
  assert.ok(r.findings.some(f=>f.title==='cluster_name → name'));
  assert.ok(r.findings.some(f=>f.title==='cluster_version → kubernetes_version'));
  assert.ok(r.findings.some(f=>f.category==='dependency'&&f.title.includes('aws')));
  assert.equal(r.warnings.length,0);
});

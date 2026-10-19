/** Pure comparison engine; upstream HCL is parsed by the Python collector. */
export function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Nem támogatott stabil verzió: ${version}`);
  return match.slice(1).map(Number);
}

export function compareVersions(a, b) {
  const av = versionParts(a), bv = versionParts(b);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
  return 0;
}

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => !k.startsWith('_')).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function hcl(value, indent = 0) {
  if (value === undefined) return '<érték>';
  if (typeof value === 'string' && /^\$\{[\s\S]*\}$/.test(value)) return value.slice(2, -1);
  if (Array.isArray(value)) return `[${value.map(v => hcl(v, indent)).join(', ')}]`;
  if (value && typeof value === 'object') return `{\n${Object.entries(value).map(([k,v]) => `${' '.repeat(indent + 2)}${/^[\w-]+$/.test(k) ? k : JSON.stringify(k)} = ${hcl(v, indent + 2)}`).join('\n')}\n${' '.repeat(indent)}}`;
  return JSON.stringify(value);
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const changes = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

export function compareSnapshots(before, after, scope = '.') {
  if (before.schema_version !== 1 || after.schema_version !== 1) throw new Error('Nem támogatott pillanatkép-formátum.');
  if (before.repository !== after.repository || before.engine !== after.engine) throw new Error('Csak azonos modul és futtatókörnyezet hasonlítható össze.');
  if (compareVersions(before.tag, after.tag) >= 0) throw new Error('A célverziónak újabbnak kell lennie a jelenlegi verziónál.');
  const a = before.scopes[scope], b = after.scopes[scope];
  const findings = [];
  let serial = 0;
  const add = (level, category, title, detail, condition, action, old, next, sources = [], sample = null) => {
    findings.push({id: `change-${++serial}`, level, category, title, detail, condition, action,
      before: old, after: next, sources: [...new Set(sources.filter(Boolean))], sample});
  };
  if (!a && !b) throw new Error('A kiválasztott almodul egyik verzióban sem található.');
  if (!a || !b) {
    add(b ? 'review' : 'required', 'module', b ? 'Új almodul' : 'Az almodul megszűnt',
      b ? 'Ez az almodul a kiinduló verzióban nem érhető el.' : 'A célverzió nem tartalmazza ezt az almodult.',
      'Ha közvetlenül ezt az almodult hívod.', b ? 'Ellenőrizd az új almodul használati útmutatóját.' : 'Válassz dokumentált helyettesítőt vagy másik célverziót.',
      a ? scope : null, b ? scope : null, (b || a).files.map(f => f.url));
    return finish();
  }

  const removed = Object.keys(a.inputs).filter(n => !has(b.inputs, n));
  const added = Object.keys(b.inputs).filter(n => !has(a.inputs, n));
  const renameCandidates = new Map();
  for (const rename of after.renames || []) {
    if (removed.includes(rename.from) && added.includes(rename.to)) {
      const list = renameCandidates.get(rename.from) || [];
      if (!list.some(r => r.to === rename.to)) list.push(rename);
      renameCandidates.set(rename.from, list);
    }
  }
  const renamedOld = new Set(), renamedNew = new Set();
  for (const [old, candidates] of renameCandidates) {
    if (candidates.length !== 1 || [...renameCandidates.values()].flat().filter(r => r.to === candidates[0].to).length !== 1) continue;
    const rename = candidates[0], next = rename.to;
    renamedOld.add(old); renamedNew.add(next);
    add('conditional', 'input', `${old} → ${next}`, 'Dokumentált átnevezés; a régi bemenet már nincs jelen.',
      `Ha átadod a(z) ${old} paramétert.`, `Nevezd át erre: ${next}. Az új típus- és alapérték-elvárásokat is ellenőrizd.`,
      a.inputs[old], b.inputs[next], [a.inputs[old]._source, b.inputs[next]._source, rename.source],
      {before: `${old} = var.${old}`, after: `${next} = var.${old}`});
  }

  for (const name of changes(a.inputs, b.inputs)) {
    const old = a.inputs[name], next = b.inputs[name];
    if (!next) {
      if (renamedOld.has(name)) continue;
      add('conditional', 'input', `Törölt bemenet: ${name}`, 'A célverzió már nem deklarálja ezt a bemenetet.',
        `Ha átadod a(z) ${name} paramétert.`, 'Távolítsd el a modulhívásból, és keresd meg a funkció dokumentált helyettesítőjét.', old, null, [old._source]);
    } else if (!old) {
      if (renamedNew.has(name)) continue;
      const required = !has(next, 'default');
      add(required ? 'required' : 'info', 'input', `${required ? 'Új kötelező' : 'Új opcionális'} bemenet: ${name}`,
        required ? 'A bemenethez nincs alapértelmezett érték.' : 'Új konfigurációs lehetőség érhető el.',
        required ? 'Minden hívásnál, amely ezt a modulverziót használja.' : 'Ha használni szeretnéd az új funkciót.',
        required ? `Egészítsd ki a modulhívást a(z) ${name} paraméterrel.` : 'A funkció használata nélkül nincs szükség kódmódosításra.',
        null, next, [next._source], required ? {after: `${name} = var.${name}`} : null);
    } else {
      for (const [field, label] of [['type', 'Típus'], ['default', 'Alapérték'], ['nullable', 'Null érték kezelése'], ['validation', 'Validáció'], ['sensitive', 'Érzékenység'], ['ephemeral', 'Ephemeral beállítás']]) {
        if (stable(old[field]) === stable(next[field])) continue;
        let level = 'conditional', action = 'Ellenőrizd az átadott értéket az új deklaráció szerint.', condition = `Ha használod a(z) ${name} bemenetet.`;
        if (field === 'default') {
          if (!has(next, 'default')) { level = 'required'; condition = `Ha eddig elhagytad a(z) ${name} bemenetet.`; action = 'Adj meg explicit értéket; a bemenet kötelezővé vált.'; }
          else { level = 'review'; condition = `Ha a(z) ${name} értékét nem állítod be külön.`; action = 'Döntsd el, megfelelő-e az új alapérték. A régi működés megőrzéséhez szükség lehet explicit értékre.'; }
        }
        add(level, 'input', `${label} változott: ${name}`, 'A két verzió deklarációja eltér.', condition, action,
          has(old, field) ? old[field] : '(nincs deklarálva)', has(next, field) ? next[field] : '(nincs deklarálva)', [old._source, next._source]);
      }
    }
  }

  for (const name of changes(a.outputs, b.outputs)) {
    const old = a.outputs[name], next = b.outputs[name];
    if (!next) add('conditional', 'output', `Törölt output: ${name}`, 'Ez a kimenet már nem érhető el.',
      `Ha hivatkozol a module.<név>.${name} kimenetre.`, 'Módosítsd a hivatkozást dokumentált helyettesítőre.', old, null, [old._source]);
    else if (!old) add('info', 'output', `Új output: ${name}`, 'Új kimeneti érték érhető el.', 'Ha használni szeretnéd.', 'Opcionálisan hivatkozhatsz az új outputra.', null, next, [next._source]);
    else if (stable({...old, description: undefined}) !== stable({...next, description: undefined})) add('review', 'output', `Megváltozott output: ${name}`,
      'A kimenet kifejezése vagy tulajdonságai megváltoztak; a visszaadott érték típusa statikusan nem garantálható.',
      `Ha használod a(z) ${name} kimenetet.`, 'Ellenőrizd a kimenetre épülő hivatkozásokat és elvárt értékeket.', old, next, [old._source, next._source]);
  }
  for (const name of changes(a.providers, b.providers)) {
    const old = a.providers[name], next = b.providers[name];
    if (stable(old?.requirement) !== stable(next?.requirement)) add('review', 'dependency', `Providerkövetelmény: ${name}`,
      'Megváltozott a provider forrása vagy verziókorlátja.', 'Ha a projekted providerbeállításait ehhez a modulhoz használod.',
      'Egyeztesd a root modul és a többi modul verziókorlátjait. Providerfrissítésnél annak migrációs útmutatóját is ellenőrizd.',
      old?.requirement ?? null, next?.requirement ?? null, [old?.source, next?.source]);
  }
  if (stable(a.requirements.map(r => r.constraint)) !== stable(b.requirements.map(r => r.constraint))) add('review', 'dependency', 'Futtatókörnyezet verziókorlátja változott',
    'Megváltozott a modul required_version beállítása.', 'Ha a használt Terraform/OpenTofu-verziód nem felel meg az új korlátnak.',
    'Ellenőrizd a helyi és CI-környezet CLI-verzióját. Az azonos szintaxis önmagában nem bizonyít kétmotoros kompatibilitást.',
    a.requirements.map(r => r.constraint), b.requirements.map(r => r.constraint), [...a.requirements, ...b.requirements].map(r => r.source));
  if (stable(a.language.map(x => x.settings)) !== stable(b.language.map(x => x.settings))) add('review', 'dependency', 'OpenTofu language beállítás változott',
    'A nyelvi kompatibilitási deklaráció eltér.', 'Ha OpenTofu alatt használod a modult.', 'Ellenőrizd a megkövetelt nyelvi és CLI-verziókat.', a.language, b.language,
    [...a.language, ...b.language].map(x => x.source));

  for (const name of changes(a.children, b.children)) {
    const old = a.children[name], next = b.children[name];
    if (old?.hash !== next?.hash) add('review', 'internal', `Belső modulhívás: ${name}`, 'A belső modul forrása, verziója vagy konfigurációja eltér.',
      'A belső modul feltételeitől és a konfigurációdtól függően.', 'Nézd át a függőség változásait; az erőforrásokra gyakorolt hatást plan alapján ellenőrizd.',
      old ? {source: old.source, version: old.version} : null, next ? {source: next.source, version: next.version} : null,
      [old?.evidence, next?.evidence]);
  }
  const resourceChanges = changes(a.resources, b.resources).filter(n => a.resources[n]?.hash !== b.resources[n]?.hash);
  if (resourceChanges.length) add('review', 'internal', `${resourceChanges.length} belső erőforrás-deklaráció változott`,
    'Hozzáadott, törölt vagy módosult deklarációk; ez nem azonos a tényleges plan műveleteivel.', 'Az érintett erőforrások létrehozási feltételeitől függően.',
    'Ellenőrizd a plan eredményét. A forráskülönbségből önmagában nem állapítható meg erőforráscsere vagy leállás.',
    resourceChanges.filter(n => a.resources[n]), resourceChanges.filter(n => b.resources[n]),
    resourceChanges.flatMap(n => [a.resources[n]?.source, b.resources[n]?.source]));
  for (const [key, label] of [['moves', 'State-cím áthelyezési deklaráció'], ['removals', 'State-eltávolítási deklaráció'], ['imports', 'Importdeklaráció']]) {
    const old = a[key] || [], next = b[key] || [];
    if (stable(old.map(r => r.body)) !== stable(next.map(r => r.body))) add('review', 'state', label,
      'A state kezelésére vonatkozó blokkok változtak.', 'Az érintett erőforrások és a jelenlegi state alapján.',
      'Olvasd el a migrációs útmutatót és ellenőrizd a plan eredményét. A deklaráció megléte önmagában nem igényel kézi state-módosítást.',
      old.map(r => r.body), next.map(r => r.body), [...old, ...next].map(r => r.source));
  }
  // Keep a raw-file safety net: locals, data sources, provider configuration,
  // functions or comments can change without changing the public interface.
  const oldFiles=Object.fromEntries(a.files.map(file=>[file.path,file]));
  const newFiles=Object.fromEntries(b.files.map(file=>[file.path,file]));
  const changedFiles=changes(oldFiles,newFiles).filter(path=>oldFiles[path]?.sha256!==newFiles[path]?.sha256);
  if(changedFiles.length) add('review','internal',`${changedFiles.length} konfigurációs forrásfájl változott`,
    'A teljes fájltartalom hash-e eltér. A felsorolt deklarációkon túl locals, data source, providerbeállítás vagy akár formázás is változhatott.',
    'A modul által használt belső kifejezések és erőforrások függvényében.',
    'Nézd át az eredeti forráskülönbséget és a migrációs dokumentációt. A fájleltérés önmagában nem bizonyít működésbeli törést.',
    changedFiles.filter(path=>oldFiles[path]),changedFiles.filter(path=>newFiles[path]),
    changedFiles.flatMap(path=>[oldFiles[path]?.url,newFiles[path]?.url]));

  return finish();
  function finish() {
    const warnings = [...(a?.warnings || []), ...(b?.warnings || [])];
    const counts = Object.fromEntries(['required', 'conditional', 'review', 'info'].map(k => [k, findings.filter(f => f.level === k).length]));
    const status = warnings.length ? 'incomplete' : counts.required ? 'required' : counts.conditional ? 'conditional' : counts.review ? 'review' : 'no-breaking-found';
    return {schema_version: 1, repository: before.repository, engine: before.engine, scope,
      from: before.tag, to: after.tag, from_sha: before.sha, to_sha: after.sha,
      generated_at: new Date().toISOString(), status, counts, warnings, findings};
  }
}

/** Documentation is evidence, never an automatically authoritative migration recipe. */
export function migrationDocuments(snapshots, from, to) {
  const byPath = new Map();
  for (const snapshot of [...snapshots].sort((a,b) => compareVersions(a.tag, b.tag))) {
    if (compareVersions(snapshot.tag, from) <= 0 || compareVersions(snapshot.tag, to) > 0) continue;
    for (const doc of snapshot.documents || []) {
      if (/changelog|changes\.md/i.test(doc.path)) {
        const headings = [...doc.text.matchAll(/^#{1,6}\s+\[?v?(\d+\.\d+\.\d+)(?![\d.-])/gm)];
        const relevant = [];
        for (let i=0; i<headings.length; i++) {
          const version = headings[i][1];
          if (compareVersions(version, from)>0 && compareVersions(version,to)<=0)
            relevant.push(doc.text.slice(headings[i].index, headings[i+1]?.index ?? doc.text.length));
        }
        if (relevant.length) byPath.set(doc.path, {...doc, text: relevant.join('\n'), kind: 'changelog', tag: snapshot.tag});
        continue;
      }
      const major = /(?:upgrade|migrat[^/]*)[-_v]?(\d+)(?:\.\d+)?/i.exec(doc.path)?.[1];
      if (major && !(Number(major)>versionParts(from)[0] && Number(major)<=versionParts(to)[0])) continue;
      byPath.set(doc.path, {...doc, kind: 'guide', tag: snapshot.tag});
    }
  }
  return [...byPath.values()].sort((a,b) => (a.kind === 'guide' ? 0 : 1) - (b.kind === 'guide' ? 0 : 1) || a.path.localeCompare(b.path));
}

export function markdownReport(report, documents = []) {
  const fence = text => {const ticks = '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map(m => m[0].length + 1))); return `${ticks}hcl\n${text}\n${ticks}`;};
  const lines = [`# ModuleLens migrációs riport`, '', `Modul: ${report.repository}`, `Verziók: ${report.from} → ${report.to}`, `Motor: ${report.engine}`, `Almodul: ${report.scope}`, '',
    `Forrás commitok: ${report.from_sha} → ${report.to_sha}`, `Készült: ${report.generated_at}`, '',
    'A riport a modul forrásait hasonlítja össze. Nem vizsgál felhasználói konfigurációt vagy state-et, és nem garantál problémamentes frissítést.', ''];
  for (const warning of report.warnings) lines.push(`FIGYELEM: ${warning.file}: ${warning.message}`, '');
  for (const f of report.findings) {
    lines.push(`## ${f.title}`, '', `Besorolás: ${f.level}`, '', f.detail, '', `Mikor érint: ${f.condition}`, '', `Teendő: ${f.action}`, '');
    if (f.sample?.before) lines.push('Előtte:', fence(f.sample.before), '');
    if (f.sample?.after) lines.push('Utána:', fence(f.sample.after), '');
    if (!f.sample) lines.push('Régi deklaráció:', fence(hcl(f.before)), '', 'Új deklaráció:', fence(hcl(f.after)), '');
    lines.push(...f.sources.map(url => `- ${url}`), '');
  }
  lines.push('## Migrációs dokumentumok', '', ...documents.map(d => `- ${d.path}: ${d.url}`));
  return lines.join('\n');
}

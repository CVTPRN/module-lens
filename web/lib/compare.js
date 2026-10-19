/** Pure comparison engine; upstream HCL is parsed by the Python collector. */
export function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unsupported stable version: ${version}`);
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
  if (value === undefined) return '<value>';
  if (typeof value === 'string' && /^\$\{[\s\S]*\}$/.test(value)) return value.slice(2, -1);
  if (Array.isArray(value)) return `[${value.map(v => hcl(v, indent)).join(', ')}]`;
  if (value && typeof value === 'object') return `{\n${Object.entries(value).map(([k,v]) => `${' '.repeat(indent + 2)}${/^[\w-]+$/.test(k) ? k : JSON.stringify(k)} = ${hcl(v, indent + 2)}`).join('\n')}\n${' '.repeat(indent)}}`;
  return JSON.stringify(value);
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const changes = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

export function compareSnapshots(before, after, scope = '.') {
  if (before.schema_version !== 1 || after.schema_version !== 1) throw new Error('Unsupported snapshot format.');
  if (before.repository !== after.repository || before.engine !== after.engine) throw new Error('Only the same module and runtime can be compared.');
  if (compareVersions(before.tag, after.tag) >= 0) throw new Error('The target version must be newer than the current version.');
  const a = before.scopes[scope], b = after.scopes[scope];
  const findings = [];
  let serial = 0;
  const add = (level, category, title, detail, condition, action, old, next, sources = [], sample = null) => {
    findings.push({id: `change-${++serial}`, level, category, title, detail, condition, action,
      before: old, after: next, sources: [...new Set(sources.filter(Boolean))], sample});
  };
  if (!a && !b) throw new Error('The selected submodule was not found in either version.');
  if (!a || !b) {
    add(b ? 'review' : 'required', 'module', b ? 'New submodule' : 'Submodule removed',
      b ? 'This submodule is unavailable in the current version.' : 'The target version does not include this submodule.',
      'If you call this submodule directly.', b ? 'Review the usage guide for the new submodule.' : 'Choose a documented replacement or another target version.',
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
    add('conditional', 'input', `${old} → ${next}`, 'Documented rename; the old input is no longer present.',
      `If you pass the ${old} argument.`, `Rename it to ${next}. Also check the new type and default requirements.`,
      a.inputs[old], b.inputs[next], [a.inputs[old]._source, b.inputs[next]._source, rename.source],
      {before: `${old} = var.${old}`, after: `${next} = var.${old}`});
  }

  for (const name of changes(a.inputs, b.inputs)) {
    const old = a.inputs[name], next = b.inputs[name];
    if (!next) {
      if (renamedOld.has(name)) continue;
      add('conditional', 'input', `Removed input: ${name}`, 'The target version no longer declares this input.',
        `If you pass the ${name} argument.`, 'Remove it from the module call and find the documented replacement for its functionality.', old, null, [old._source]);
    } else if (!old) {
      if (renamedNew.has(name)) continue;
      const required = !has(next, 'default');
      add(required ? 'required' : 'info', 'input', `${required ? 'New required' : 'New optional'} input: ${name}`,
        required ? 'This input has no default value.' : 'A new configuration option is available.',
        required ? 'For every call using this module version.' : 'If you want to use the new feature.',
        required ? `Add the ${name} argument to your module call.` : 'No code change is needed unless you use this feature.',
        null, next, [next._source], required ? {after: `${name} = var.${name}`} : null);
    } else {
      for (const [field, label] of [['type', 'Type'], ['default', 'Default'], ['nullable', 'Null handling'], ['validation', 'Validation'], ['sensitive', 'Sensitivity'], ['ephemeral', 'Ephemeral setting']]) {
        if (stable(old[field]) === stable(next[field])) continue;
        let level = 'conditional', action = 'Check the supplied value against the new declaration.', condition = `If you use the ${name} input.`;
        if (field === 'default') {
          if (!has(next, 'default')) { level = 'required'; condition = `If you previously omitted the ${name} input.`; action = 'Provide an explicit value; the input is now required.'; }
          else { level = 'review'; condition = `If you do not explicitly set ${name}.`; action = 'Decide whether the new default is suitable. Preserving the previous behavior may require an explicit value.'; }
        }
        add(level, 'input', `${label} changed: ${name}`, 'The declaration differs between the two versions.', condition, action,
          has(old, field) ? old[field] : '(not declared)', has(next, field) ? next[field] : '(not declared)', [old._source, next._source]);
      }
    }
  }

  for (const name of changes(a.outputs, b.outputs)) {
    const old = a.outputs[name], next = b.outputs[name];
    if (!next) add('conditional', 'output', `Removed output: ${name}`, 'This output is no longer available.',
      `If you reference the module.<name>.${name} output.`, 'Update the reference to a documented replacement.', old, null, [old._source]);
    else if (!old) add('info', 'output', `New output: ${name}`, 'A new output value is available.', 'If you want to use it.', 'You can optionally reference the new output.', null, next, [next._source]);
    else if (stable({...old, description: undefined}) !== stable({...next, description: undefined})) add('review', 'output', `Changed output: ${name}`,
      'The output expression or properties changed; static analysis cannot guarantee the returned value type.',
      `If you use the ${name} output.`, 'Review references to this output and the values they expect.', old, next, [old._source, next._source]);
  }
  for (const name of changes(a.providers, b.providers)) {
    const old = a.providers[name], next = b.providers[name];
    if (stable(old?.requirement) !== stable(next?.requirement)) add('review', 'dependency', `Provider requirement: ${name}`,
      'The provider source or version constraint changed.', 'If this module uses your project provider configuration.',
      'Align version constraints across the root module and other modules. Review the provider migration guide when upgrading it.',
      old?.requirement ?? null, next?.requirement ?? null, [old?.source, next?.source]);
  }
  if (stable(a.requirements.map(r => r.constraint)) !== stable(b.requirements.map(r => r.constraint))) add('review', 'dependency', 'Runtime version constraint changed',
    'The module required_version setting changed.', 'If your Terraform/OpenTofu version does not satisfy the new constraint.',
    'Check CLI versions locally and in CI. Shared syntax alone does not prove compatibility with both engines.',
    a.requirements.map(r => r.constraint), b.requirements.map(r => r.constraint), [...a.requirements, ...b.requirements].map(r => r.source));
  if (stable(a.language.map(x => x.settings)) !== stable(b.language.map(x => x.settings))) add('review', 'dependency', 'OpenTofu language setting changed',
    'The language compatibility declaration differs.', 'If you use this module with OpenTofu.', 'Check the required language and CLI versions.', a.language, b.language,
    [...a.language, ...b.language].map(x => x.source));

  for (const name of changes(a.children, b.children)) {
    const old = a.children[name], next = b.children[name];
    if (old?.hash !== next?.hash) add('review', 'internal', `Internal module call: ${name}`, 'The internal module source, version or configuration differs.',
      'Depending on the internal module conditions and your configuration.', 'Review the dependency changes and check resource impacts with a plan.',
      old ? {source: old.source, version: old.version} : null, next ? {source: next.source, version: next.version} : null,
      [old?.evidence, next?.evidence]);
  }
  const resourceChanges = changes(a.resources, b.resources).filter(n => a.resources[n]?.hash !== b.resources[n]?.hash);
  if (resourceChanges.length) add('review', 'internal', `${resourceChanges.length} internal resource declarations changed`,
    'Added, removed or changed declarations; these are not actual plan operations.', 'Depending on the creation conditions of the affected resources.',
    'Review your plan. Resource replacement or downtime cannot be determined from source differences alone.',
    resourceChanges.filter(n => a.resources[n]), resourceChanges.filter(n => b.resources[n]),
    resourceChanges.flatMap(n => [a.resources[n]?.source, b.resources[n]?.source]));
  for (const [key, label] of [['moves', 'State address move declaration'], ['removals', 'State removal declaration'], ['imports', 'Import declaration']]) {
    const old = a[key] || [], next = b[key] || [];
    if (stable(old.map(r => r.body)) !== stable(next.map(r => r.body))) add('review', 'state', label,
      'State management blocks changed.', 'Depending on the affected resources and current state.',
      'Read the migration guide and review your plan. The declaration alone does not require manual state changes.',
      old.map(r => r.body), next.map(r => r.body), [...old, ...next].map(r => r.source));
  }
  // Keep a raw-file safety net: locals, data sources, provider configuration,
  // functions or comments can change without changing the public interface.
  const oldFiles=Object.fromEntries(a.files.map(file=>[file.path,file]));
  const newFiles=Object.fromEntries(b.files.map(file=>[file.path,file]));
  const changedFiles=changes(oldFiles,newFiles).filter(path=>oldFiles[path]?.sha256!==newFiles[path]?.sha256);
  if(changedFiles.length) add('review','internal',`${changedFiles.length} configuration source files changed`,
    'Full file content hashes differ. In addition to the listed declarations, locals, data sources, provider configuration or formatting may have changed.',
    'Depending on the internal expressions and resources used by the module.',
    'Review the original source diff and migration documentation. A file difference alone does not prove a breaking behavior change.',
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
  const lines = [`# ModuleLens migration report`, '', `Module: ${report.repository}`, `Versions: ${report.from} → ${report.to}`, `Engine: ${report.engine}`, `Submodule: ${report.scope}`, '',
    `Source commits: ${report.from_sha} → ${report.to_sha}`, `Generated: ${report.generated_at}`, '',
    'This report compares module sources. It does not inspect user configuration or state and does not guarantee a trouble-free upgrade.', ''];
  for (const warning of report.warnings) lines.push(`WARNING: ${warning.file}: ${warning.message}`, '');
  for (const f of report.findings) {
    lines.push(`## ${f.title}`, '', `Severity: ${f.level}`, '', f.detail, '', `When this applies: ${f.condition}`, '', `Action: ${f.action}`, '');
    if (f.sample?.before) lines.push('Before:', fence(f.sample.before), '');
    if (f.sample?.after) lines.push('After:', fence(f.sample.after), '');
    if (!f.sample) lines.push('Previous declaration:', fence(hcl(f.before)), '', 'New declaration:', fence(hcl(f.after)), '');
    lines.push(...f.sources.map(url => `- ${url}`), '');
  }
  lines.push('## Migration documents', '', ...documents.map(d => `- ${d.path}: ${d.url}`));
  return lines.join('\n');
}

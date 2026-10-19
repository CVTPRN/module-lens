"""Parse module declarations without evaluating or executing upstream code."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import PurePosixPath
from urllib.parse import quote

import hcl2

MAX_FILE = 2_000_000
EXTENSIONS = (".tf", ".tf.json", ".tofu", ".tofu.json")
SKIP_PARTS = {".git", ".terraform", "node_modules", "examples", "test", "tests"}


def blocks(value):
    """HCL parser uses lists for blocks; native JSON syntax uses objects."""
    if isinstance(value, list):
        return value
    return [value] if isinstance(value, dict) else []


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def source_url(repository, sha, path):
    return f"https://github.com/{repository}/blob/{quote(sha, safe='')}/{quote(path, safe='/')}"


def eligible(path, engine, files):
    if not path.endswith(EXTENSIONS):
        return False
    if any(p in SKIP_PARTS for p in PurePosixPath(path).parts):
        return False
    if engine == "terraform":
        return path.endswith((".tf", ".tf.json"))
    # OpenTofu selects .tofu counterparts per basename, including JSON files.
    if path.endswith(".tf.json") and path[:-8] + ".tofu.json" in files:
        return False
    if path.endswith(".tf") and path[:-3] + ".tofu" in files:
        return False
    return True


def extract_renames(documents):
    """Only explicit 'old -> new' mappings; never infer a rename from similarity."""
    result = []
    pattern = re.compile(r"`([A-Za-z_]\w*)`\s*(?:->|→|=>)\s*`([A-Za-z_]\w*)`")
    for doc in documents:
        for line_number, line in enumerate(doc["text"].splitlines(), 1):
            for old, new in pattern.findall(line):
                result.append({"from": old, "to": new, "source": doc["url"] + f"#L{line_number}"})
    return result


def make_snapshot(files, repository, tag, sha, engine):
    scopes = {}
    notices = [{"path": path, "text": text, "url": source_url(repository, sha, path)} for path, text in sorted(files.items())
        if PurePosixPath(path).name.upper().startswith(("LICENSE", "NOTICE", "COPYING"))]
    documents = []
    for path, text in sorted(files.items()):
        if not path.lower().endswith(".md"):
            continue
        name = PurePosixPath(path).name.lower()
        if name.startswith(("upgrade", "migration", "migrat")) or name in {"changelog.md", "changes.md"}:
            # Keep complete selected documents: truncation would hide migration steps.
            documents.append({"path": path, "url": source_url(repository, sha, path), "text": text})

    for path, text in sorted(files.items()):
        if not eligible(path, engine, files):
            continue
        folder = str(PurePosixPath(path).parent)
        scope = scopes.setdefault(folder, {"path": folder, "inputs": {}, "outputs": {}, "providers": {},
            "requirements": [], "language": [], "resources": {}, "children": {}, "moves": [],
            "removals": [], "imports": [], "warnings": [], "files": []})
        url = source_url(repository, sha, path)
        scope["files"].append({"path": path, "url": url, "sha256": hashlib.sha256(text.encode()).hexdigest()})
        if re.search(r"(?:^|/)(?:override|\w+_override)\.(?:tf|tofu)(?:\.json)?$", path):
            scope["warnings"].append({"file": path, "message": "Override file: merge semantics are not evaluated.", "source": url})
        try:
            data = json.loads(text) if path.endswith(".json") else hcl2.loads(text)
        except Exception as exc:
            scope["warnings"].append({"file": path, "message": f"Unable to parse HCL/JSON ({type(exc).__name__}).", "source": url})
            continue
        for kind, dest in (("variable", "inputs"), ("output", "outputs")):
            for group in blocks(data.get(kind)):
                for name, attributes in group.items():
                    if name in scope[dest]:
                        scope["warnings"].append({"file": path, "message": f"Duplicate declaration: {kind} {name}.", "source": url})
                    scope[dest][name] = {**attributes, "_source": url, "_file": path}
        for settings in blocks(data.get("terraform")) + blocks(data.get("tofu")):
            if "required_version" in settings:
                scope["requirements"].append({"constraint": settings["required_version"], "source": url})
            for language in blocks(settings.get("language")):
                scope["language"].append({"settings": language, "source": url})
            for group in blocks(settings.get("required_providers")):
                for name, requirement in group.items():
                    scope["providers"][name] = {"requirement": requirement, "source": url}
        for group in blocks(data.get("resource")):
            for resource_type, instances in group.items():
                for name, body in instances.items():
                    scope["resources"][f"{resource_type}.{name}"] = {"hash": digest(body), "source": url}
        for group in blocks(data.get("module")):
            for name, body in group.items():
                scope["children"][name] = {"source": body.get("source"), "version": body.get("version"),
                    "hash": digest(body), "evidence": url}
        for key, dest in (("moved", "moves"), ("removed", "removals"), ("import", "imports")):
            for block in blocks(data.get(key)):
                scope[dest].append({"body": block, "source": url})
        # Unknown new constructs must not be silently treated as fully understood.
        known = {"variable", "output", "terraform", "tofu", "resource", "module", "moved", "removed", "import",
            "locals", "data", "provider", "check"}
        for key in sorted(set(data) - known):
            scope["warnings"].append({"file": path, "message": f"Nem elemzett blokk: {key}.", "source": url})
    return {"schema_version": 1, "engine": engine, "repository": repository, "tag": tag, "sha": sha,
        "scopes": scopes, "documents": documents, "renames": extract_renames(documents), "license_notices": notices}

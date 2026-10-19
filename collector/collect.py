"""Build a static, auditable catalog from public GitHub module tags.

Nothing from downloaded repositories is executed or extracted to disk.
GITHUB_TOKEN, when present, is sent only to api.github.com.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import io
import gzip
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import time
import urllib.error
import urllib.request

from collector.snapshot import make_snapshot, MAX_FILE, EXTENSIONS

ROOT = Path(__file__).resolve().parents[1]
MAX_ARCHIVE = 25_000_000
MAX_UNPACKED = 100_000_000
SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, *, api=False):
    headers = {"User-Agent": "ModuleLens/1.0", "Accept": "application/vnd.github+json" if api else "*/*"}
    if api:
        if not url.startswith("https://api.github.com/"):
            raise ValueError("API credentials may only be sent to api.github.com")
        token = os.getenv("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(3):
        try:
            with opener.open(urllib.request.Request(url, headers=headers), timeout=45) as response:
                data = response.read(MAX_ARCHIVE + 1)
                if len(data) > MAX_ARCHIVE:
                    raise ValueError("Response exceeds 25 MB limit")
                return json.loads(data) if api else data
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise RuntimeError(f"Upstream HTTP {exc.code}: {url}") from None
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2:
                raise RuntimeError(f"Upstream request failed: {url}") from None
        time.sleep(2 ** attempt)


def version_key(tag):
    match = SEMVER.fullmatch(tag)
    return tuple(map(int, match.groups())) if match else None


def read_archive(payload):
    result, total, count = {}, 0, 0
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for entry in archive:
            count += 1
            total += entry.size
            if total > MAX_UNPACKED or count > 15000:
                raise ValueError("Archive exceeds uncompressed size or member count limit")
            parts = PurePosixPath(entry.name).parts
            if entry.name.startswith("/") or ".." in parts:
                raise ValueError("Unsafe archive path")
            if not entry.isfile() or len(parts) < 2:
                continue  # Includes symlinks and hard links; never follow them.
            path = str(PurePosixPath(*parts[1:]))
            if not path.endswith(EXTENSIONS + (".md", ".MD")) and not PurePosixPath(path).name.upper().startswith(("LICENSE", "NOTICE", "COPYING")):
                continue
            if entry.size > MAX_FILE:
                raise ValueError(f"Source file exceeds 2 MB: {path}")
            handle = archive.extractfile(entry)
            result[path] = handle.read(MAX_FILE + 1).decode("utf-8", errors="strict")
    return result


def select_tags(tags, anchors, recent=6):
    stable = {t["name"]: t for t in tags if version_key(t["name"]) is not None}
    ordered = sorted(stable, key=version_key, reverse=True)
    selected = set(ordered[:recent])
    majors = sorted({version_key(t)[0] for t in ordered}, reverse=True)[:3]
    for major in majors:
        candidates = [t for t in ordered if version_key(t)[0] == major]
        selected.add(candidates[0])
        # The first major release usually contains the most useful migration docs.
        first = f"v{major}.0.0"
        if first in stable:
            selected.add(first)
        elif first[1:] in stable:
            selected.add(first[1:])
    missing = []
    for name in anchors:
        if name in stable:
            selected.add(name)
        else:
            missing.append(name)
    return [stable[t] for t in ordered if t in selected], missing


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    payload = (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    temp.write_bytes(gzip.compress(payload, mtime=0) if path.name.endswith(".gz") else payload)
    temp.replace(path)


def load(path):
    return json.loads(gzip.decompress(path.read_bytes()) if path.name.endswith(".gz") else path.read_bytes())


def index_module(module, output, refresh=False):
    if not SLUG.fullmatch(module["id"]):
        raise ValueError("Invalid module id")
    repository = module["repository"]
    if len(repository.split("/")) != 2 or not all(SLUG.fullmatch(p) for p in repository.split("/")):
        raise ValueError("Invalid repository")
    meta = request(f"https://api.github.com/repos/{repository}", api=True)
    if meta.get("private") or meta["full_name"].lower() != repository.lower():
        raise ValueError("Only public, non-redirected GitHub repositories are supported")
    tags = []
    for page in range(1, 5):
        batch = request(f"https://api.github.com/repos/{repository}/tags?per_page=100&page={page}", api=True)
        tags.extend(batch)
        if len(batch) < 100:
            break
    selected, missing = select_tags(tags, module.get("anchors", []), module.get("recent", 6))
    if not selected:
        raise ValueError("No stable semantic version tags found")
    entries, failures = [], []

    def one(tag):
        name, sha = tag["name"], tag["commit"]["sha"]
        paths = {engine: output / module["id"] / engine / f"{name}.json.gz" for engine in ("terraform", "opentofu")}
        if refresh or not all(p.exists() and load(p).get("sha") == sha for p in paths.values()):
            files = read_archive(request(f"https://codeload.github.com/{repository}/tar.gz/{sha}"))
            for engine, path in paths.items():
                snapshot = make_snapshot(files, repository, name, sha, engine)
                if not snapshot["scopes"]:
                    raise ValueError("No module configuration files")
                dump(path, snapshot)
        return {"tag": name, "version": name.lstrip("v"), "sha": sha,
            "snapshots": {engine: f"data/{module['id']}/{engine}/{name}.json.gz" for engine in paths}}

    # HCL parsing is CPU-bound; keep the pool small and memory bounded.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(one, tag): tag for tag in selected}
        for future in concurrent.futures.as_completed(jobs):
            tag = jobs[future]
            try:
                entries.append(future.result())
                print(f"  indexed {module['id']} {tag['name']}", flush=True)
            except Exception as exc:
                failures.append({"tag": tag["name"], "message": str(exc)})
    if len(entries) < 2:
        raise RuntimeError(f"Fewer than two usable versions for {module['id']}: {failures}")
    # Enumerate every public module folder across indexed tags and engines.
    scopes = {"."}
    for entry in entries:
        for engine in ("terraform", "opentofu"):
            scopes.update(load(output / module["id"] / engine / f"{entry['tag']}.json.gz")["scopes"])
    return {**module, "versions": sorted(entries, key=lambda x: version_key(x["tag"]), reverse=True),
        "scopes": sorted(scopes), "available_tag_count": len([t for t in tags if version_key(t["name"])]),
        "tag_scan_limit": 400, "missing_anchors": missing, "failures": failures,
        "license": (meta.get("license") or {}).get("spdx_id", "NOASSERTION"),
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "modules.json")
    parser.add_argument("--output", type=Path, default=ROOT / "web/data")
    parser.add_argument("--only", help="Comma separated module ids")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    configured = json.loads(args.config.read_text())["modules"]
    ids = [m["id"] for m in configured]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate module ids")
    catalog_path = args.output / "catalog.json"
    previous = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"modules": []}
    old = {m["id"]: m for m in previous["modules"]}
    modules, errors = [], []
    only = set(args.only.split(",")) if args.only else None
    for module in configured:
        if only and module["id"] not in only:
            if module["id"] in old:
                modules.append(old[module["id"]])
            continue
        print(f"Indexing {module['repository']}", flush=True)
        try:
            modules.append(index_module(module, args.output, args.refresh))
        except Exception as exc:
            errors.append({"module": module["id"], "message": str(exc)})
            if module["id"] in old:
                modules.append({**old[module["id"]], "stale": True})
            print(f"  ERROR: {exc}", flush=True)
    if not modules:
        raise SystemExit("No usable module data; refusing to publish an empty catalog")
    dump(catalog_path, {"schema_version": 1, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "modules": modules, "errors": errors})
    if errors or any(m.get("failures") or m.get("missing_anchors") for m in modules):
        raise SystemExit("Collection incomplete. Inspect catalog errors; publication must use explicitly reviewed data.")


if __name__ == "__main__":
    main()

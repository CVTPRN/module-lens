"""Validate every catalog reference and package a relative-path static site."""
import gzip
import json
import os
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]


def validate(web):
    catalog = json.loads((web / "data/catalog.json").read_text())
    assert catalog["schema_version"] == 1 and catalog["modules"], "Missing catalog"
    assert not catalog.get("errors"), "Catalog collection errors"
    seen = set()
    count = 0
    for module in catalog["modules"]:
        assert module["id"] not in seen, "Duplicate module id"
        seen.add(module["id"])
        assert not module.get("failures"), f"Failed versions: {module['id']}"
        assert not module.get("missing_anchors"), f"Missing requested versions: {module['id']}"
        assert not module.get("stale"), f"Stale catalog: {module['id']}"
        assert len(module["versions"]) >= 2
        for entry in module["versions"]:
            assert re.fullmatch(r"[a-f0-9]{40}", entry["sha"]), "Invalid source commit"
            for engine in ("terraform", "opentofu"):
                path = (web / entry["snapshots"][engine]).resolve()
                assert path.is_relative_to(web.resolve()), "Snapshot escapes web root"
                snap = json.loads(gzip.decompress(path.read_bytes()))
                assert snap["schema_version"] == 1
                assert snap["sha"] == entry["sha"] and snap["tag"] == entry["tag"]
                assert snap["repository"] == module["repository"] and snap["engine"] == engine
                assert snap["scopes"] and snap.get("license_notices"), "Missing source or upstream license notices"
                for scope in snap["scopes"].values():
                    for file in scope["files"]:
                        assert entry["sha"] in file["url"], "Evidence is not commit-pinned"
                count += 1
    return count


def main():
    web = ROOT / "web"
    count = validate(web)
    output = ROOT / "dist"
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(web, output)
    (output / ".nojekyll").touch()
    repo = os.getenv("GITHUB_REPOSITORY", "")
    if repo:
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
            raise ValueError("Invalid GITHUB_REPOSITORY")
        site_path = output / "site.json"
        site = json.loads(site_path.read_text()) if site_path.exists() else {}
        site["repository_url"] = f"https://github.com/{repo}"
        site_path.write_text(json.dumps(site, ensure_ascii=False))
    shutil.copy2(ROOT / "THIRD_PARTY_NOTICES.md", output / "THIRD_PARTY_NOTICES.md")
    shutil.copy2(ROOT / "LICENSE", output / "LICENSE")
    print(f"Validated {count} snapshots; static site ready in {output}")


if __name__ == "__main__":
    main()

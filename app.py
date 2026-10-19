#!/usr/bin/env python3
"""ModuleLens same-origin server, based on the user-supplied Registry prototype.

Run: python app.py --host 127.0.0.1 --port 8080
Only public registry.terraform.io endpoints are contacted; no tokens required.
"""
from __future__ import annotations
import argparse
from collections import OrderedDict
import json
import mimetypes
from pathlib import Path
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
REGISTRY = "https://registry.terraform.io/v1/modules"
ADDRESS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}/[A-Za-z0-9][A-Za-z0-9_-]{0,63}/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
VERSION_RE = re.compile(r"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$")
MAX_RESPONSE = 16 * 1024 * 1024
MAX_CACHE = 24 * 1024 * 1024
cache: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def upstream_url(operation, params):
    one = lambda key, default="": params.get(key, [default])[0]
    if operation == "health":
        return None
    if operation == "search":
        q, provider, offset, limit = one("q").strip(), one("provider"), one("offset", "0"), one("limit", "24")
        if len(q) > 100 or re.search(r"[\x00-\x1f]", q) or (provider and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", provider)) or not re.fullmatch(r"\d{1,7}", offset) or not limit.isdecimal() or not 1 <= int(limit) <= 50:
            raise ApiError("Érvénytelen keresési paraméter.")
        query = {"offset": str(int(offset)), "limit": str(int(limit))}
        if q:
            query["q"] = q
        if provider:
            query["provider"] = provider
        return REGISTRY + ("/search" if q else "") + "?" + urllib.parse.urlencode(query)
    module = one("module")
    if not ADDRESS_RE.fullmatch(module):
        raise ApiError("Érvénytelen modulcím.")
    if operation == "versions":
        return f"{REGISTRY}/{module}/versions"
    if operation == "module":
        version = one("version")
        if not VERSION_RE.fullmatch(version):
            raise ApiError("Érvénytelen verzió.")
        return f"{REGISTRY}/{module}/{urllib.parse.quote(version, safe='')}"
    raise ApiError("Ismeretlen Registry API-művelet.")


def registry_json_bytes(url):
    now = time.monotonic()
    with lock:
        hit = cache.get(url)
        if hit and now - hit[0] < 300:
            return hit[1]
    try:
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "ModuleLens/2.0"})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            payload = response.read(MAX_RESPONSE + 1)
        if len(payload) > MAX_RESPONSE:
            raise ApiError("A Registry válasza túl nagy.", 502)
        data = json.loads(payload)
        if not isinstance(data, dict):
            raise ValueError("Invalid root")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise ApiError("A modul vagy verzió nem található a Terraform Registryben.", 404) from None
        if exc.code == 429:
            raise ApiError("A Registry lekérési korlátját elértük. Próbáld újra később.", 503) from None
        raise ApiError(f"A Registry nem érhető el (HTTP {exc.code}).", 502) from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ApiError("A Registry nem érhető el, időtúllépés történt vagy hibás választ adott.", 502) from None
    with lock:
        cache.pop(url, None)
        while cache and (len(cache) >= 64 or sum(len(v[1]) for v in cache.values()) + len(payload) > MAX_CACHE):
            cache.popitem(last=False)
        cache[url] = (time.monotonic(), payload)
    return payload


class Handler(BaseHTTPRequestHandler):
    def respond(self, body, status=200, content_type="application/json; charset=utf-8", cache_control="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; object-src 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        try:
            if url.path.startswith("/api/registry/"):
                if not re.fullmatch(r"/api/registry/(health|search|versions|module)", url.path):
                    raise ApiError("Nem található API-művelet.", 404)
                params = urllib.parse.parse_qs(url.query, keep_blank_values=True)
                target = upstream_url(url.path.rsplit("/", 1)[-1], params)
                body = registry_json_bytes(target) if target else json.dumps({"ok": True, "service": "ModuleLens Registry proxy", "registry": REGISTRY}).encode()
                self.respond(body, cache_control="public, max-age=300")
                return
            path = urllib.parse.unquote(url.path)
            if "\x00" in path or any(part.startswith(".") for part in path.split("/") if part):
                raise ApiError("Nem található.", 404)
            file = (WEB / (path.lstrip("/") or "index.html")).resolve()
            if not file.is_relative_to(WEB.resolve()) or not file.is_file():
                raise ApiError("Nem található.", 404)
            mime = "application/gzip" if file.name.endswith(".gz") else mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            if mime in ("text/javascript", "application/javascript"):
                mime = "text/javascript; charset=utf-8"
            self.respond(file.read_bytes(), content_type=mime)
        except ApiError as exc:
            self.respond(json.dumps({"error": str(exc)}, ensure_ascii=False).encode(), exc.status)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        self.respond(b'{"error":"Only GET requests are allowed."}', 405)


def main():
    parser = argparse.ArgumentParser(description="ModuleLens: élő Terraform Registry és OpenTofu összehasonlítás")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"ModuleLens: http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

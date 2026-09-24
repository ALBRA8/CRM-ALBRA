#!/usr/bin/env python3
"""Download all source maps and extract original TSX/TS source files."""
import re, os, json, glob, urllib.request, urllib.parse

BASE = "https://preview-chat-1fd262b6-15ad-4db1-87f9-39705b41845f.space-z.ai"
OUT = "/home/z/my-project/crm_albra_mirrored"
SRC = os.path.join(OUT, "recovered_source")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0", "Accept": "*/*"}

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.read()
    except Exception as e:
        print(f"  !! FAIL {url}: {e}")
        return None

# collect all local chunk js files
chunk_files = []
for fp in glob.glob(os.path.join(OUT, "static/chunks/*.js")):
    chunk_files.append(os.path.basename(fp))

print(f"{len(chunk_files)} chunks found")

maps_downloaded = 0
sources_saved = 0
seen_sources = set()

for name in chunk_files:
    mp = urllib.parse.quote(name) + ".map"
    url = f"{BASE}/_next/static/chunks/{mp}"
    data = fetch(url)
    if not data:
        continue
    maps_downloaded += 1
    try:
        m = json.loads(data.decode("utf-8", errors="replace"))
    except Exception as e:
        print(f"  !! bad map {name}: {e}")
        continue

    submaps = []
    if m.get("sections"):
        for sec in m["sections"]:
            sm = sec.get("map")
            if sm:
                submaps.append(sm)
    else:
        submaps = [m]

    for sm in submaps:
        names = sm.get("sources", [])
        contents = sm.get("sourcesContent", [])
        if not contents:
            continue
        for src, content in zip(names, contents):
            if not content:
                continue
            # normalize source path: could be like [project]/src/app/page.tsx or relative
            p = src.replace("[project]/", "").replace("[", "").replace("]", "")
            if p.startswith("/") or ".." in p or p.startswith("node_modules"):
                continue
            p = p.lstrip("./")
            if p in seen_sources:
                continue
            seen_sources.add(p)
            fp = os.path.join(SRC, p)
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(content)
            sources_saved += 1

print(f"\nmaps downloaded: {maps_downloaded}")
print(f"source files recovered: {sources_saved}")
with open(os.path.join(SRC, "_RECOVERY_INDEX.json"), "w") as f:
    json.dump(sorted(seen_sources), f, indent=2)

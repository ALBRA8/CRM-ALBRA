#!/usr/bin/env python3
"""Mirror the deployed CRM ALBRA preview (Turbopack dev server) - recover chunks."""
import re, os, sys, json, urllib.request, urllib.parse

BASE = "https://preview-chat-1fd262b6-15ad-4db1-87f9-39705b41845f.space-z.ai"
OUT = "/home/z/my-project/crm_albra_mirrored"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "*/*",
    "Referer": BASE + "/",
}

def fetch(path, binary=False):
    url = BASE + path
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
            return data if binary else data.decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  !! FAIL {path}: {e}")
        return None

def chunk_path_from_url(u):
    # /_next/static/chunks/xxx.js -> chunks/xxx.js ; keep encoded as-is
    return u.replace("/_next/static/", "static/")

def get_asset_urls(html):
    urls = set()
    for m in re.finditer(r'(?:src|href)="(/_next/[^"]+)"', html):
        urls.add(m.group(1))
    # also unquoted preload pattern
    for m in re.finditer(r'"/_next/([^"]+?)"', html):
        urls.add("/_next/" + m.group(1))
    return urls

def download_assets(urls, seen=None):
    seen = seen if seen is not None else {}
    new_js = []
    for u in sorted(urls):
        if u in seen:
            continue
        seen[u] = True
        local = chunk_path_from_url(urllib.parse.unquote(u))
        fp = os.path.join(OUT, local)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        data = fetch(u, binary=True)
        if data:
            with open(fp, "wb") as f:
                f.write(data)
            print(f"  ok {local} ({len(data)} B)")
            if u.endswith(".js"):
                new_js.append((local, data.decode("utf-8", errors="replace")))
    return new_js

def extract_next_urls_from_js(js_text):
    found = set()
    for m in re.finditer(r'"/_next/[^"\\]+?\.(?:js|css|woff2?|png|jpe?g|svg|webp)"', js_text):
        found.add(m.group(0).strip('"'))
    for m in re.finditer(r'"(static/chunks/[^"\\]+?)"', js_text):
        found.add("/_next/" + m.group(1))
    return found

def save(path, text):
    fp = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "w", encoding="utf-8") as f:
        f.write(text)

pages = sys.argv[1:] or ["/"]
seen = {}
all_urls = set()
report = {}

for page in pages:
    print(f"\n=== PAGE {page} ===")
    html = fetch(page)
    if not html:
        continue
    safe = "index.html" if page == "/" else page.strip("/").replace("/", "_") + ".html"
    save(safe, html)
    urls = get_asset_urls(html)
    print(f"  {len(urls)} asset urls")
    all_urls |= urls
    report[page] = len(urls)

# download all page assets (JS chunks etc.)
print("\n=== ASSETS PASS 1 ===")
js_files = download_assets(all_urls, seen)

# second pass: JS chunks may reference more chunks
for _ in range(3):
    extra = set()
    for _, txt in js_files:
        extra |= extract_next_urls_from_js(txt)
    extra = {u for u in extra if u not in seen}
    if not extra:
        break
    print(f"\n=== ASSETS PASS (extra {len(extra)}) ===")
    js_files = download_assets(extra, seen)

print(f"\nDONE. total unique assets: {len(seen)}")
with open(os.path.join(OUT, "mirror_report.json"), "w") as f:
    json.dump({"pages": report, "assets": sorted(seen)}, f, indent=2)

#!/usr/bin/env python3
"""Analyze mirrored Turbopack dev chunks: extract app structure, routes, APIs, design."""
import re, os, json, glob

OUT = "/home/z/my-project/crm_albra_mirrored"

chunks = {}
for fp in glob.glob(os.path.join(OUT, "static/chunks/*.js")):
    name = os.path.basename(fp)
    with open(fp, encoding="utf-8", errors="replace") as f:
        chunks[name] = f.read()

src_chunks = {k: v for k, v in chunks.items() if k.startswith("src_") or k.startswith("src/") or "src_" in k}

print("=== CHUNK SIZES (source-related) ===")
for k in sorted(src_chunks, key=lambda x: -len(src_chunks[x])):
    print(f"  {k}: {len(src_chunks[k])} B")

# 1. API endpoints referenced anywhere
print("\n=== FETCH / API ENDPOINTS ===")
api = set()
for k, v in chunks.items():
    for m in re.finditer(r'["\'`](/api/[^"\'`?]+)["\'`]', v):
        api.add(m.group(1))
    for m in re.finditer(r'fetch\(\s*["\'`]([^"\'`]+)["\'`]', v):
        u = m.group(1)
        if not u.startswith("http") and not u.startswith("data:"):
            api.add(u)
for a in sorted(api):
    print(" ", a)

# 2. Router links / hrefs (app routes)
print("\n=== LINKS / ROUTES ===")
routes = set()
for k, v in chunks.items():
    for m in re.finditer(r'href:\s*"([^"]+)"', v):
        h = m.group(1)
        if h.startswith("/") and not h.startswith("/_next"):
            routes.add(h)
    for m in re.finditer(r'(?:push|replace)\(\s*"(/[^"]+)"', v):
        routes.add(m.group(1))
for r in sorted(routes):
    print(" ", r)

# 3. Text strings in Spanish (sample) to identify features per component
print("\n=== SPANISH UI STRINGS PER COMPONENT (sample) ===")
def es_strings(txt, limit=14):
    out = []
    seen = set()
    for m in re.finditer(r'"([A-ZÁÉÍÓÚÑ][^"\\]{8,90})"', txt):
        s = m.group(1)
        if re.search(r'[áéíóúñÁÉÍÓÚÑ]|oportunidad|prospecto|cliente|cotiza|producto|venta|seguimiento|pipeline|ingres|dashboard|bienvenid|agend|visita|fideliz|leal', s, re.I) and s not in seen:
            seen.add(s); out.append(s)
        if len(out) >= limit: break
    return out

for k in sorted(src_chunks, key=lambda x: -len(src_chunks[x])):
    ss = es_strings(src_chunks[k])
    if ss:
        print(f"\n  [{k}]")
        for s in ss[:14]:
            print(f"    - {s}")

# 4. Tailwind color usage (green corporate?)
print("\n=== COLOR CLASSES ===")
colors = {}
for k, v in src_chunks.items():
    for m in re.finditer(r'(?:bg|text|border|from|to|ring)-(?:emerald|green|teal|lime|slate|gray|zinc|neutral|stone|amber|blue|indigo|violet|rose|red)-\d{2,3}', v):
        colors[m.group(0)] = colors.get(m.group(0), 0) + 1
top = sorted(colors.items(), key=lambda x: -x[1])[:25]
for c, n in top:
    print(f"  {c}: {n}")

# 5. localStorage keys / state persistence
print("\n=== LOCALSTORAGE / STATE ===")
ls = set()
for k, v in chunks.items():
    for m in re.finditer(r'localStorage\.(?:get|set)Item\(\s*["\']([^"\']+)["\']', v):
        ls.add(m.group(1))
for s in sorted(ls):
    print(" ", s)

# 6. hex colors in inline styles
print("\n=== HEX COLORS (sample) ===")
hexc = {}
for k, v in src_chunks.items():
    for m in re.finditer(r'#[0-9a-fA-F]{6}\b', v):
        hexc[m.group(0).lower()] = hexc.get(m.group(0).lower(), 0) + 1
for c, n in sorted(hexc.items(), key=lambda x: -x[1])[:20]:
    print(f"  {c}: {n}")

# 7. component/function definitions in the main shared chunk
print("\n=== FUNCTION/COMPONENT NAMES (all src chunks) ===")
names = set()
for k, v in src_chunks.items():
    for m in re.finditer(r'function\s+([A-Z][A-Za-z0-9_]{3,40})\s*\(', v):
        names.add(m.group(1))
    for m in re.finditer(r'(?:const|var)\s+([A-Z][A-Za-z0-9_]{3,40})\s*=\s*(?:\(\s*\)\s*=>|\(\s*\{)', v):
        names.add(m.group(1))
print(f"  total unique: {len(names)}")
print(" ", ", ".join(sorted(names)[:120]))

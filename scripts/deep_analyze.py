#!/usr/bin/env python3
"""Deep-dive: AI integrations, whatsapp daemon, backend base, pages, data models."""
import re, os, glob

OUT = "/home/z/my-project/crm_albra_mirrored"
chunks = {}
for fp in glob.glob(os.path.join(OUT, "static/chunks/*.js")):
    with open(fp, encoding="utf-8", errors="replace") as f:
        chunks[os.path.basename(fp)] = f.read()

# 1. API_BASE / DAEMON_BASE values
print("=== API_BASE / DAEMON CONFIG ===")
for k, v in chunks.items():
    for m in re.finditer(r'(?:const|var|let)\s+(API_BASE|DAEMON_BASE|DAEMON_PROXY)\s*=\s*["\'`]([^"\'`]{1,120})["\'`]', v):
        print(f"  {m.group(1)} = {m.group(2)}  ({k})")
    for m in re.finditer(r'["\'`](https?://[^"\'`\s]{5,80})["\'`]', v):
        u = m.group(1)
        if "space-z.ai" in u or "localhost" in u or "127.0.0.1" in u or ":3000" in u or ":8000" in u or "whatsapp" in u.lower():
            print(f"  URL in {k}: {u}")

# 2. AI-related
print("\n=== AI / IA REFERENCES ===")
ai_terms = {}
for k, v in chunks.items():
    hits = re.findall(r'[^"\'`]{0,60}(?:inteligencia artificial|OpenAI|openai|GPT|gpt-|claude|anthropic|LLM|auto-respuesta IA|IA para|agente IA|autorr|respuesta autom)[^"\'`]{0,60}', v)
    if hits:
        uniq = []
        for h in hits:
            h = h.strip()
            if h not in uniq:
                uniq.append(h)
        ai_terms[k] = uniq[:12]
for k, hs in ai_terms.items():
    print(f"\n  [{k}]")
    for h in hs:
        print(f"    - {h}")

# 3. WhatsApp references
print("\n=== WHATSAPP REFERENCES (sample) ===")
for k, v in chunks.items():
    hits = re.findall(r'[^"\'`]{0,50}[Ww]hats[Aa]pp[^"\'`]{0,60}', v)
    uniq = []
    for h in hits:
        if h.strip() not in uniq:
            uniq.append(h.strip())
    if uniq:
        print(f"\n  [{k}] {len(hits)} refs, sample:")
        for h in uniq[:10]:
            print(f"    - {h}")

# 4. Remaining component names (after 120)
names = set()
for k, v in chunks.items():
    if k.startswith("src_"):
        for m in re.finditer(r'function\s+([A-Z][A-Za-z0-9_]{3,40})\s*\(', v):
            names.add(m.group(1))
        for m in re.finditer(r'(?:const|var)\s+([A-Z][A-Za-z0-9_]{3,40})\s*=\s*(?:\(\s*\)\s*=>|\(\s*\{)', v):
            names.add(m.group(1))
sn = sorted(names)
print("\n=== ALL COMPONENT NAMES (rest) ===")
print(", ".join(sn[120:]))

# 5. Data model fields (client object shape)
print("\n=== DATA MODEL HINTS ===")
for k, v in chunks.items():
    for m in re.finditer(r'(?:interface|type)\s+([A-Z][A-Za-z]{2,30})\s*(?:=\s*\{|extends[^{]*\{)([^}]{10,600})', v):
        body = m.group(2)[:300].replace("\n", " ")
        print(f"  [{k}] {m.group(1)}: {body}")
        break

# 6. Status/pipeline stages
print("\n=== PIPELINE STAGES / STATUSES ===")
stages = set()
for k, v in chunks.items():
    for m in re.finditer(r'(?:stage|status|etapa)["\']?\s*[:=]\s*["\']([a-z_\-]{3,30})["\']', v):
        stages.add(m.group(1))
print(" ", ", ".join(sorted(stages)[:60]))

# 7. Check for fetch of pages list / navigation config
print("\n=== SIDEBAR NAV ITEMS ===")
for k, v in chunks.items():
    if "Sidebar" in v and "LayoutDashboard" in v:
        m = re.search(r'(?:const|var)\s+(?:nav|menu|sidebar|items)[A-Za-z]*\s*=\s*\[(.{100,2500}?)\]', v, re.S)
        if m:
            print(m.group(1)[:1800])
        break

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Batería de estabilidad de "cerebros" NVIDIA NIM para el CRM ALBRA.
Prueba: texto (N runs) + visión (imagen PNG roja como data URI) por modelo.
Mide latencia, fallos y muestra veredicto. Todo contra el endpoint gratuito.
"""
import json, time, urllib.request, urllib.error, zlib, struct, sys, os

# SEGURIDAD: la llave NUNCA va en el código (leer del entorno).
KEY = os.environ.get("NVIDIA_KEY", "")
if not KEY:
    sys.exit("Define NVIDIA_KEY en el entorno (export NVIDIA_KEY=nvapi-...)")
BASE = "https://integrate.api.nvidia.com/v1"
TEXT_TIMEOUT = 30
VISION_TIMEOUT = 45

# ---------- PNG roja 64x64 sin dependencias (PNG writer mínimo) ----------
def png_red_b64():
    w = h = 64
    raw = b''.join(b'\x00' + b'\xe6\x1a\x1a' * w for _ in range(h))  # filtro 0, RGB rojo oscuro
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    import base64
    return 'data:image/png;base64,' + base64.b64encode(png).decode()

# ---------- helpers ----------
def http_json(url, payload=None, key=KEY, timeout=30):
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
    except Exception as e:
        return None, {"_err": str(e)[:100]}

def chat(model, messages, max_tokens=64, timeout=TEXT_TIMEOUT):
    t0 = time.time()
    code, d = http_json(f"{BASE}/chat/completions",
                        {"model": model, "messages": messages, "max_tokens": max_tokens,
                         "temperature": 0, "stream": False}, timeout=timeout)
    dt = time.time() - t0
    if code == 200:
        msg = (d.get("choices") or [{}])[0].get("message", {})
        content = msg.get("content")
        if content is None and msg.get("reasoning_content"):
            return "OK(parcial)", dt, "solo reasoning (subir max_tokens)"
        return ("OK", dt, (content or "(vacío)")[:70].replace("\n", " "))
    if code is None:
        return ("RED/TIMEOUT", dt, d.get("_err", ""))
    return (f"HTTP {code}", dt, json.dumps(d)[:110])

# ---------- descubrir IDs exactos disponibles ----------
print("=" * 78)
print("PASO 1 — Validar llave y descubrir IDs exactos de los candidatos")
print("=" * 78)
code, d = http_json(f"{BASE}/models", timeout=30)
if code != 200:
    print(f"LLAVE INVÁLIDA O RED FALLÓ (HTTP {code}): {json.dumps(d)[:200]}")
    sys.exit(1)
ids = [m["id"] for m in d["data"]]
print(f"Llave OK — {len(ids)} modelos en catálogo\n")

def find(*needles):
    out = []
    for i in ids:
        il = i.lower()
        if all(n in il for n in needles):
            out.append(i)
    return out

candidates = {
    "GLM 5.3 Flash (texto+visión)": find("glm-5") ,
    "DeepSeek V4.1 Flash (texto+visión)": find("deepseek-v4"),
    "Muse Glimmer 30B (texto+visión)": find("muse"),
    "Kimi K3 (control, se sabía que cuelga)": find("kimi-k3"),
}
resolved = {}
for label, lst in candidates.items():
    print(f"  {label}: {lst}")
    resolved[label] = lst

# ---------- batería ----------
print()
print("=" * 78)
print("PASO 2 — Batería: 3x texto + 2x visión (imagen roja → ¿de qué color?)")
print("=" * 78)
img = png_red_b64()
text_q = [{"role": "user", "content": "¿Cuánto es 17*23? Responde solo el número."}]
vision_q = [{"role": "user", "content": [
    {"type": "text", "text": "¿De qué color es esta imagen? Responde con una sola palabra."},
    {"type": "image_url", "image_url": {"url": img}},
]}]

results = {}
def pick(label):
    lst = resolved[label]
    return lst[0] if lst else None

plan = []  # (model, runs_texto, runs_vision, max_tokens_texto, timeout)
glm_list = resolved["GLM 5.3 Flash (texto+visión)"]
glm_flash = next((i for i in glm_list if "flash" in i), None)
glm_big = next((i for i in glm_list if "flash" not in i), None)
alt = pick("DeepSeek V4.1 Flash (texto+visión)")
muse = pick("Muse Glimmer 30B (texto+visión)")
kimi = pick("Kimi K3 (control, se sabía que cuelga)")

if glm_flash: plan.append((glm_flash, 3, 2, 64, TEXT_TIMEOUT))      # candidato principal
if alt: plan.append((alt, 3, 2, 64, TEXT_TIMEOUT))                  # candidato principal
if muse: plan.append((muse, 2, 1, 1024, TEXT_TIMEOUT))              # reasoning: más presupuesto
if kimi: plan.append((kimi, 1, 0, 64, TEXT_TIMEOUT))                # control
if glm_big: plan.append((glm_big, 1, 0, 64, 60))                    # sonda 60s al grande

for model, nt, nv, mt, tmo in plan:
    print(f"\n--- {model} (max_tokens={mt}) ---")
    lat_t, ok_t = [], 0
    for i in range(nt):
        st, dt, info = chat(model, text_q, max_tokens=mt, timeout=tmo)
        lat_t.append(dt); ok_t += (st == "OK")
        print(f"  texto {i+1}/{nt}: {st:14s} {dt:6.1f}s  {info}")
    lat_v, ok_v = [], 0
    for i in range(nv):
        st, dt, info = chat(model, vision_q, max_tokens=max(mt, 256), timeout=max(VISION_TIMEOUT, tmo))
        lat_v.append(dt); ok_v += (st == "OK")
        print(f"  visión {i+1}/{nv}: {st:14s} {dt:6.1f}s  {info}")
    results[model] = {"lat_t": lat_t, "ok_t": ok_t, "nt": nt,
                      "lat_v": lat_v, "ok_v": ok_v, "nv": nv}

# ---------- veredicto ----------
print()
print("=" * 78)
print("VEREDICTO")
print("=" * 78)
for m, r in results.items():
    t_ok = f"{r['ok_t']}/{r['nt']}"
    v_ok = f"{r['ok_v']}/{r['nv']}" if r['nv'] else "n/a"
    lt = f"{min(r['lat_t']):.1f}-{max(r['lat_t']):.1f}s" if r['lat_t'] else "-"
    lv = f"{min(r['lat_v']):.1f}-{max(r['lat_v']):.1f}s" if r['lat_v'] else "-"
    print(f"  {m}")
    print(f"    texto: {t_ok} OK  latencia {lt} | visión: {v_ok} OK  latencia {lv}")

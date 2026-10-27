#!/usr/bin/env python3
"""
ALBRA - Escaneo final de credenciales en artefactos locales (post-publicacion).
Escanea archivos de texto en search roots y reporta coincidencias ENMASCARADAS
(nunca imprime el valor completo). Genera evidencia JSON en download/.
No modifica archivos; solo diagnostica. Excluye binarios y node_modules.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

SEARCH_ROOTS = [
    "/home/z/my-project",
    "/home/z/repos",
]
# Subdirectorios de plataforma (no son artefactos del proyecto ALBRA)
EXCLUDE_PATH_FRAGMENTS = ("/skills/", "/upload/", "/examples/")
# Directorios excluidos por ruido/volumen
EXCLUDE_DIRS = {
    "node_modules", ".git", ".next", "dist", "build", "coverage",
    "tool-results", "agent-ctx", "crm_albra_mirrored", "crm_albra_recovered",
    ".venv", "venv", "__pycache__",
}
# Extensiones de texto relevantes + nombres especiales
TEXT_EXT = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".txt", ".sh",
    ".env", ".example", ".yml", ".yaml", ".py", ".log", ".prisma", ".html",
    ".css", ".sql", ".bat", ".cmd", ".toml", ".lock", "",
}
SPECIAL_NAMES = {".env", ".env.example", ".gitignore", "Caddyfile",
                 "Dockerfile", "docker-compose.yml", ".e2e-creds.sh"}

PATTERNS = {
    "github_pat_classic": re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    "github_pat_other": re.compile(r"gh[ousr]_[A-Za-z0-9]{20,}"),
    "github_finegrained": re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    "jwt": re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}"),
    "albra_api_key": re.compile(r"albra_[A-Za-z0-9]{10,}"),
    "nvidia_key": re.compile(r"nvapi-[A-Za-z0-9_-]{10,}"),
    "openai_style": re.compile(r"sk-[A-Za-z0-9]{20,}"),
    "aws_akia": re.compile(r"AKIA[0-9A-Z]{16}"),
    "private_key_block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "db_url_with_creds": re.compile(r"(postgres|postgresql|mysql|mongodb(?:\+srv)?)://[^/\s:@]+:[^@\s]{4,}@"),
    "slack_token": re.compile(r"xox[bpars]-[A-Za-z0-9-]{10,}"),
}

# Archivos que SABEMOS contienen placeholders/redacciones legitimas:
# si el valor enmascarado corresponde a un placeholder conocido, lo marcamos.
PLACEHOLDER_HINTS = ("REDACTED", "redact", "EXAMPLE", "TU_", "your_", "cambia", "xxxx", "demo")


def mask(value: str) -> str:
    v = value.strip()
    if len(v) <= 9:
        return v[:3] + "***"
    return v[:6] + "***" + v[-3:] + f" (len={len(v)})"


def is_placeholder(value: str) -> bool:
    return any(h.lower() in value.lower() for h in PLACEHOLDER_HINTS)


def is_false_positive(path: str, line: str, value: str) -> str | None:
    """Reglas de triage documentadas (evidencia honesta, no ocultamiento)."""
    if value == "albra_specialization":
        return "nombre de directorio del repo AGENTE-GENERAL, no es una clave"
    if "/skills/" in path:
        return "plantilla de plataforma (fuera del proyecto)"
    if "base64" in line and value.startswith("AKIA"):
        return "subcadena azarosa de un data-URI base64"
    if "key inv\u00e1lida" in line or "badKey" in line:
        return "fixture NEGATIVO de prueba 401 (clave invalida intencional)"
    return None


def iter_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for name in filenames:
            path = os.path.join(dirpath, name)
            ext = os.path.splitext(name)[1]
            if ext.lower() in TEXT_EXT or name in SPECIAL_NAMES or name.startswith(".env"):
                yield path


def main():
    findings = []
    triaged = []
    scanned = 0
    for root in SEARCH_ROOTS:
        if not os.path.isdir(root):
            continue
        for path in iter_files(root):
            if any(frag in path for frag in EXCLUDE_PATH_FRAGMENTS):
                continue
            try:
                if os.path.getsize(path) > 5 * 1024 * 1024:
                    continue
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    for lineno, line in enumerate(fh, 1):
                        for kind, rx in PATTERNS.items():
                            m = rx.search(line)
                            if m:
                                fp = is_false_positive(path, line, m.group(0))
                                if fp:
                                    triaged.append({
                                        "file": path, "line": lineno, "type": kind,
                                        "masked": mask(m.group(0)), "reason": fp,
                                    })
                                    continue
                                findings.append({
                                    "file": path,
                                    "line": lineno,
                                    "type": kind,
                                    "masked": mask(m.group(0)),
                                    "looks_placeholder": is_placeholder(m.group(0)),
                                    "context": line.strip()[:80].replace(m.group(0), "***"),
                                })
                scanned += 1
            except (OSError, UnicodeError):
                continue

    # Archivos e2e-token/key/apikey: verificar estado de redaccion explicitamente
    e2e_status = []
    e2e_candidates = [
        "/home/z/my-project/scripts/e2e-token.txt",
        "/home/z/my-project/scripts/e2e-wp-token.txt",
        "/home/z/my-project/scripts/e2e-apikey.txt",
        "/home/z/my-project/scripts/e2e-wp-key.txt",
        "/home/z/my-project/scripts/e2e-wp-apikey.json",
        "/home/z/my-project/scripts/e2e-demo-resp.json",
        "/home/z/my-project/scripts/e2e-results-crm.txt",
        "/home/z/my-project/scripts/e2e-results-leadstests.txt",
        "/home/z/my-project/scripts/e2e-results-errors.txt",
    ]
    for p in e2e_candidates:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
                has_redacted = "REDACT" in content.upper()
                e2e_status.append({"file": os.path.basename(p), "exists": True,
                                   "size": os.path.getsize(p), "contains_REDACTED_marker": has_redacted})
            except OSError:
                e2e_status.append({"file": os.path.basename(p), "exists": True, "error": "unreadable"})
        else:
            e2e_status.append({"file": os.path.basename(p), "exists": False})

    real = [f for f in findings if not f["looks_placeholder"]]
    placeholders = [f for f in findings if f["looks_placeholder"]]
    dedup_triaged = []
    seen = set()
    for t in triaged:
        k = (t["file"], t["line"], t["masked"])
        if k not in seen:
            seen.add(k)
            dedup_triaged.append(t)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scan_kind": "post-publish credential sweep (final closure)",
        "roots": SEARCH_ROOTS,
        "files_scanned": scanned,
        "real_credential_hits": len(real),
        "placeholder_hits": len(placeholders),
        "findings_real": real,
        "findings_placeholder": placeholders[:40],
        "triaged_false_positives": dedup_triaged,
        "e2e_artifacts_status": e2e_status,
    }
    out_dir = "/home/z/my-project/download"
    os.makedirs(out_dir, exist_ok=True)
    out_json = os.path.join(out_dir, "evidencia-escaneo-credenciales.json")
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)

    print(f"FILES SCANNED: {scanned}")
    print(f"REAL credential hits: {len(real)}")
    for f in real[:30]:
        print(f"  [REAL] {f['type']:22s} {f['file']}:{f['line']} -> {f['masked']}")
    print(f"Placeholder/allowed hits: {len(placeholders)} (muestra)")
    for f in placeholders[:10]:
        print(f"  [ok  ] {f['type']:22s} {f['file']}:{f['line']} -> {f['masked']}")
    print(f"Triaged false positives: {len(dedup_triaged)}")
    for t in dedup_triaged[:10]:
        print(f"  [fp  ] {t['type']:22s} {t['file']}:{t['line']} -> {t['masked']} | {t['reason']}")
    print(f"\nE2E artifacts:")
    for s in e2e_status:
        print(f"  {s}")
    print(f"\nEvidencia JSON: {out_json}")
    return 0 if len(real) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

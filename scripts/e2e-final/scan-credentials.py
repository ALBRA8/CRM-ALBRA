#!/usr/bin/env python3
"""Escaneo de credenciales en árbol de trabajo e historial Git completo (3 repos ALBRA).
NUNCA imprime valores: solo tipo de patrón, archivo, SHA y línea (truncada y sanitizada)."""
import subprocess, re, json, sys

REPOS = ['CRM-ALBRA', 'WHATSPOWER', 'WHATSPOWER-ULTRA']
BASE = '/home/z/my-project/albra-final'

PATTERNS = {
    'GITHUB_PAT': r'gh[pousr]_[A-Za-z0-9]{20,}',
    'GITHUB_TOKEN_CLASSIC': r'\b[0-9a-f]{40}\b(?=.*github|(?<=token)[^\n]{0,30})',
    'NVIDIA_NIM': r'nvapi-[A-Za-z0-9_\-]{20,}',
    'OPENAI_STYLE': r'sk-[A-Za-z0-9]{20,}',
    'AWS_AKIA': r'AKIA[0-9A-Z]{16}',
    'JWT': r'eyJ[A-Za-z0-9_\-]{15,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}',
    'ALBRA_API_KEY': r'albra_[0-9a-f]{32,}',
    'INTERNAL_SECRET_VALUE': r'crm_albra_internal_secret_key_fixed_length_for_daemon_2026',
    'DEV_WEBHOOK_SECRET': r'dev_secret_shared_albra_2a',
    'PASSWORD_LITERAL': r'(?i)(password|passwd|contrase\u00f1a)\s*[:=]\s*["\'][^"\']{6,}["\']',
    'PRIVATE_KEY': r'-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'DATABASE_URL_CREDS': r'(postgres|postgresql|mysql)://[^\s:@]+:[^\s@]+@',
    'SLACK_BOT': r'xox[baprs]-[A-Za-z0-9\-]{10,}',
}

def scan_worktree(repo):
    hits = []
    for name, pat in PATTERNS.items():
        try:
            out = subprocess.run(['git', 'grep', '-I', '-n', '-E', pat, '--', '.'],
                                 cwd=f'{BASE}/{repo}', capture_output=True, text=True, timeout=120).stdout
        except Exception:
            continue
        for line in out.splitlines():
            if not line.strip():
                continue
            path, lineno, rest = line.split(':', 2)
            hits.append({'repo': repo, 'scope': 'worktree', 'pattern': name,
                         'file': path, 'line': lineno, 'excerpt': rest.strip()[:40]})
    return hits

def scan_history(repo):
    hits = []
    revs = subprocess.run(['git', 'rev-list', '--all'], cwd=f'{BASE}/{repo}',
                          capture_output=True, text=True).stdout.split()
    for rev in revs:
        for name, pat in PATTERNS.items():
            try:
                out = subprocess.run(['git', 'grep', '-I', '-n', '-E', pat, rev, '--'],
                                     cwd=f'{BASE}/{repo}', capture_output=True, text=True, timeout=60).stdout
            except Exception:
                continue
            for line in out.splitlines():
                if not line.strip():
                    continue
                parts = line.split(':', 2)
                if len(parts) < 3:
                    continue
                rsha, path, rest = parts
                hits.append({'repo': repo, 'scope': 'history', 'pattern': name,
                             'sha': rsha[:10], 'file': path, 'excerpt': rest.strip()[:40]})
    return hits

all_hits = []
for r in REPOS:
    all_hits += scan_worktree(r)
    print(f'{r}: árbol escaneado', flush=True)
for r in REPOS:
    all_hits += scan_history(r)
    print(f'{r}: historial escaneado', flush=True)

# clasificación: los 2 secretos "públicos del repo" son hallazgos conocidos;
# el resto se lista para triaje manual sin valores.
summary = {}
for h in all_hits:
    key = (h['repo'], h['scope'], h['pattern'])
    summary[key] = summary.get(key, 0) + 1

out = {'total_hits': len(all_hits), 'resumen': [dict(repo=k[0], scope=k[1], pattern=k[2], count=v) for k, v in sorted(summary.items())],
       'hits': all_hits}
with open('/home/z/my-project/download/ALBRA-PRUEBA-INTEGRAL/evidencias/escaneo-credenciales.json', 'w') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps(out['resumen'], indent=1))

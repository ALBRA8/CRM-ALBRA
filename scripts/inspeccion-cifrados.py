#!/usr/bin/env python3
# Inspección de payloads cifrados (v1:*) en la BD copia — sin imprimir valores.
import sqlite3, json

DB = '/home/z/secure-rotation/db-copia/custom.db'
con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print('TABLAS:', len(tables))
enc = {}
for t in tables:
    qt = '"' + t.replace('"', '""') + '"'
    cols = [c[1] for c in con.execute(f'PRAGMA table_info({qt})').fetchall()]
    for c in cols:
        qc = '"' + c.replace('"', '""') + '"'
        try:
            n = con.execute(f'SELECT COUNT(*) FROM {qt} WHERE {qc} LIKE ?', ('v1:%',)).fetchone()[0]
            if n:
                enc[f'{t}.{c}'] = n
        except Exception:
            pass
print('CAMPOS CON PAYLOAD CIFRADO v1:*:', json.dumps(enc, indent=1, ensure_ascii=False))
con.close()

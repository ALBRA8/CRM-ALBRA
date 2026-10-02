#!/usr/bin/env python3
"""Inspecciona el ESQUEMA (función, no contenido) del memory.db de OpenClaw.
Solo lectura (mode=ro). Muestra: tablas, columnas, índices, triggers, conteos,
y 1 fila de ejemplo por tabla con el contenido recortado (solo para ver la forma)."""
import sqlite3, json, os

BASE = "/home/z/my-project/upload"
DB = os.path.join(BASE, "memory.db")
uri = f"file:{DB}?mode=ro"

con = sqlite3.connect(uri, uri=True)
cur = con.cursor()

print("=" * 70)
print("1) OBJETOS DEL ESQUEMA (sqlite_master)")
print("=" * 70)
rows = cur.execute(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name"
).fetchall()
for typ, name, tbl, sql in rows:
    print(f"\n--- {typ}: {name} (tabla: {tbl}) ---")
    print(sql)

print("\n" + "=" * 70)
print("2) CONTEO DE FILAS POR TABLA")
print("=" * 70)
tables = [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_data' AND name NOT LIKE '%_idx%' AND name NOT LIKE '%_docsize%' AND name NOT LIKE '%_config%'"
).fetchall()]
counts = {}
for t in tables:
    try:
        counts[t] = cur.execute(f"SELECT COUNT(*) FROM '{t}'").fetchone()[0]
    except Exception as e:
        counts[t] = f"err: {e}"
    print(f"  {t}: {counts[t]}")

print("\n" + "=" * 70)
print("3) FORMA DE 1 FILA POR TABLA (contenido recortado a 90 chars)")
print("=" * 70)
for t in tables:
    try:
        cols = [d[1] for d in cur.execute(f"PRAGMA table_info('{t}')").fetchall()]
        row = cur.execute(f"SELECT * FROM '{t}' LIMIT 1").fetchone()
        print(f"\n--- {t} ---")
        print(f"  columnas: {cols}")
        if row:
            for c, v in zip(cols, row):
                s = repr(v)
                if len(s) > 90:
                    s = s[:90] + f"... (len real={len(repr(v))})"
                print(f"    {c}: {s}")
        else:
            print("  (vacía)")
    except Exception as e:
        print(f"  {t}: ERROR {e}")

print("\n" + "=" * 70)
print("4) TABLAS FTS / VIRTUALES (para entender el índice de búsqueda)")
print("=" * 70)
try:
    all_tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()]
    print(f"  Todas las tablas: {all_tables}")
    for t in all_tables:
        if any(k in t.lower() for k in ("fts", "vec", "embed", "shadow")):
            try:
                ddl = cur.execute(
                    "SELECT sql FROM sqlite_master WHERE name=?", (t,)
                ).fetchone()[0]
                print(f"\n  DDL de {t}:\n{ddl}")
            except Exception:
                pass
except Exception as e:
    print(f"  ERROR: {e}")

con.close()
print("\nOK — inspección de esquema completa (solo lectura).")

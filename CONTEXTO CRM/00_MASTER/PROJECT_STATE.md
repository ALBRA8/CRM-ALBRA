# Estado del proyecto
**Corte:** 2026-11-07 · **Rama base:** main · **SHA CRM:** `ac01106eac5f9c61e7298f8e437a09cf44c08eaf`. Snapshot documental; no certifica producción.

CRM-ALBRA es el producto central del dominio comercial y gobierno de integraciones. Ecosistema acordado: tres repositorios separados: CRM-ALBRA, WHATSPOWER (ManyChat) y WHATSPOWER-ULTRA (Watson). Los módulos son opcionales, independientes y desconectables; CRM conserva su operación central sin ellos.

| Repo | Rol | Documentación revisada | Estado |
|---|---|---|---|
| [CRM-ALBRA](https://github.com/ALBRA8/CRM-ALBRA) | Core, dominio, identidad y contratos | CONTEXTO CRM, README, docs/HARNESS.md | Documentación inspeccionada |
| [WHATSPOWER](https://github.com/ALBRA8/WHATSPOWER) | Módulo conversacional ManyChat | README.md | Documentación inspeccionada |
| [WHATSPOWER-ULTRA](https://github.com/ALBRA8/WHATSPOWER-ULTRA) | Módulo campañas Watson | README, CONTEXT, FICHA | Documentación inspeccionada; textos históricos a conciliar |

## CRM documentado
Stack descrito: Next.js App Router, React, TypeScript, Tailwind, Prisma y SQLite en esquema revisado. Dominio: organizaciones, usuarios, clientes, oportunidades, pipeline, reservas, cotizaciones, productos, transacciones, automatizaciones, memoria y canales. [docs/HARNESS.md](https://github.com/ALBRA8/CRM-ALBRA/blob/main/docs/HARNESS.md) describe REST /api/crm/actions, MCP /api/mcp, MemoryDV, auth y RBAC.

**Conflicto:** la regla del propietario indica que CRM conserva el único agente principal. docs/HARNESS.md afirma que el agente propietario de chat fue eliminado y que un host externo futuro aportaría inteligencia, aún sin integración concreta. Se registra CONFLICT; no se inventa implementación ni se modifica código aquí.

## Módulos
WHATSPOWER README describe flujos y bridge firmado; declara que CRM opera autónomamente si WP no está activo. ULTRA README describe campañas y modo standalone con CRM sin WP, pero documenta WHATSPOWER_ENABLED=true por defecto. Hay que verificar runtime para asegurar que WP es opcional y no dependencia oculta.

## Seguridad heredada
CONTEXTO CRM anterior registra P0.1–P0.4 verificados en sesión 2026-11-06: suite 464/464, TypeScript 0 errores, build OK y escáner de secretos limpio. Es evidencia de un informe de sesión almacenado; no se reejecutó durante esta reorganización.

## Prioridades
1. Resolver conflicto del agente principal vs HARNESS.
2. Auditar aislamiento multi-tenant extremo a extremo.
3. Verificar independencia real de módulos.
4. Diseñar multi-cuenta y migración desde Integration uno-a-uno.
5. Elegir motor producción y ensayar migración/rollback.
6. Versionar contratos y repetir pruebas de integración.
7. Probar backup/restore, carga y observabilidad.

VERIFIED = evidencia directa; REPORTED = afirmado en informe previo no reproducido ahora; PLANNED = plan; CONFLICT = fuentes incompatibles.

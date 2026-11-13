# Arquitectura del ecosistema ALBRA CRM
**Versión:** 1.0 · 2026-11-07

Tres repositorios independientes. CRM-ALBRA es centro del dominio comercial, identidad y gobierno de integraciones. WHATSPOWER y WHATSPOWER-ULTRA son módulos opcionales, autónomos y conectables independientemente. No son tres agentes apilados.

## Responsabilidades
**CRM-ALBRA:** organizaciones, usuarios, clientes, oportunidades y procesos comerciales; identidad, RBAC, aislamiento multi-tenant y auditoría; dominio/persistencia; contratos de integración; único lugar previsto para el agente principal según regla de producto del propietario.

**WHATSPOWER — ManyChat:** flujos conversacionales, captura de datos, condiciones, tags, drip, handoff y opt-out. Integra con CRM mediante contratos explícitos. No sustituye dominio CRM ni aloja otro agente principal.

**WHATSPOWER-ULTRA — Watson:** campañas/broadcast, audiencias, spintax, cadencia y salvaguardas de despacho. Delega despacho al daemon autorizado del CRM. La consulta de locks a WP es capacidad opcional.

## Reglas
1. CRM no depende de módulos para operación central.
2. WP y ULTRA no se requieren mutuamente.
3. Cada repo conserva código, pruebas, releases y documentación.
4. No fusionar repos ni copiar código para integrar.
5. Contratos explícitos, autenticados, versionados y tenant-scoped.
6. CRM gobierna identidad/datos comerciales; módulos su estado operativo.
7. Fallos de un módulo no derriban CRM ni al hermano.
8. Desconexión no borra datos ni rompe el core.

## Conflicto del agente
La regla del propietario dice que el agente principal único pertenece al CRM. [docs/HARNESS.md](https://github.com/ALBRA8/CRM-ALBRA/blob/main/docs/HARNESS.md) dice que el agente propietario de chat fue eliminado y que un host externo futuro aportaría inteligencia. Se conserva la discrepancia; requiere decisión y revisión de código aparte.

Stack documentado: Next.js, React, TypeScript, Tailwind, Prisma y SQLite en esquema inspeccionado. No certifica DB de producción. Fuentes: HARNESS y READMEs de WP/ULTRA.

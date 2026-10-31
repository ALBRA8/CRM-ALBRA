# Auditorías

## A-001 — Revisión selectiva de código y documentación
**Fecha:** 2026-10-31. **Rama:** main. **Alcance:** README, prisma/schema.prisma, daemon Baileys, webhook Instagram y docs/HARNESS.md. Sin ejecución de tests/build ni inspección del despliegue.

### Hallazgos
1. README presenta CRM multi-tenant y enumera módulos y conectores.
2. Esquema define Organization y organizationId en entidades principales.
3. Integration.organizationId es único: configuración uno-a-uno por organización.
4. daemon.mjs mantiene socket/estado/organización globales y auth state local: no acredita varias sesiones simultáneas.
5. Webhook Instagram valida HMAC, pero permite entrada si instagramAccountId no está configurado; riesgo de asociación ambigua.
6. HARNESS documenta REST, MCP y MemoryDV.

### Límites
No se ejecutaron lint, TypeScript, tests, build, health checks, carga, migración, backup ni restauración. No certifica producción ni revisa todas las rutas.

## A-002 — Resultados reportados anteriormente, pendientes de reproducir
Un informe previo fechado 2026-10-21 reportó TypeScript/ESLint sin errores, Prisma válido, 376 tests en 40 archivos, build con 94 rutas, health 200, DB disponible, ejercicio backup/restauración y carga de 380 solicitudes con 0% errores. No se reprodujo en esta revisión; no tratarlo como estado actual sin repetirlo contra commit y entorno concretos.

## Próxima auditoría
Revisar todas las API routes, server actions, consultas Prisma, relaciones, cron/workers, exportaciones, webhooks, sesiones, credenciales, REST/MCP y API keys. Añadir pruebas negativas entre dos tenants y concurrencia multicuenta.

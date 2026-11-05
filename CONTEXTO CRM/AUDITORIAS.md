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

## A-003 — Aislamiento WhatsApp Baileys por organización (resultado reportado)
**Fecha del informe:** 2026-11-05. **Repositorio declarado:** ALBRA8/CRM-ALBRA. **Ramas/commit reportados:** main y fix/saas-security-and-stabilization en c2f4001. **stable-production:** reportada intacta en ea87cc2.

### Cambios reportados
- Sesiones y credenciales independientes por orgId, bajo .wa-auth/<orgId>/.
- Validación estricta de orgId antes de operaciones de disco.
- Alcance por organización para connect, disconnect, send, qr y conversations.
- Compatibilidad sin orgId en /send limitada a exactamente una sesión conectada; 409 con 2+ sesiones.
- Proxy CRM deriva orgId del JWT y sobreescribe el valor enviado por el cliente.
- Migración del layout legado reportada como no destructiva y con metadata .bak conservada.

### Pruebas reportadas
17 unitarias nuevas; suite 422/422 en 46 archivos; tsc sin errores; smoke en vivo 13/13. En el smoke se creó una organización B y se reportó respuesta 403 al intentar enviar/desconectar desde el contexto no autorizado; después se eliminó la organización de prueba.

### Límite de esta entrada
Los resultados anteriores son declaraciones del informe recibido, no una reproducción independiente de esta auditoría. Antes de certificar el cierre, contrastar el commit c2f4001, revisar el diff y repetir pruebas relevantes. La revisión A-001 había observado una sesión global; ese hallazgo es antecedente y queda supersedido solo si el cambio reportado se confirma en la rama evaluada.

## A-004 — Correcciones de tests relacionadas con .env y Windows (repositorio por confirmar)
**Fecha del informe:** 2026-11-05. **Commit local reportado:** 658740b. **Push:** bloqueado por falta de credenciales en el sandbox, según el informe.

Cambios reportados en siete archivos: aislamiento de FLOW_MCP_ENABLED/FLOW_MCP_VIDEO_ENABLED, aislamiento de AVATAR_V2V_SPACES y variables NOTEBOOKLM_PROBE_TOOL/NOTEBOOKLM_CONTEXT_TOOL, encoding UTF-8 explícito en lecturas de texto y mock de os.symlink para no depender de privilegios del sistema operativo.

Pruebas reportadas: 434/434 con .env de producción simulado, 434/434 sin .env y prueba de encoding con locale ASCII. Se reportó que se reprodujeron seis fallos de los originales; tres de los 17 fallos originales no quedaron individualmente identificados en el informe.

**No se ha confirmado que 658740b pertenezca a ALBRA8/CRM-ALBRA.** No atribuir ni integrar ese commit aquí hasta verificar el repositorio, rama, árbol y remoto. La simulación Linux no sustituye la ejecución en Windows real con el .env local.

## Próxima auditoría
1. Revisar todas las API routes, server actions, consultas Prisma, relaciones, cron/workers, exportaciones, webhooks, sesiones, credenciales, REST/MCP y API keys.
2. Resolver y probar P0.2, P0.3 y P0.4 con pruebas negativas entre dos tenants.
3. Verificar de forma independiente P0.1 en el commit publicado.
4. Confirmar el repositorio de origen/destino de 658740b antes de integrarlo.
5. No certificar producción sin lint, TypeScript, tests, build, health checks, revisión de seguridad y pruebas de aislamiento reproducibles.

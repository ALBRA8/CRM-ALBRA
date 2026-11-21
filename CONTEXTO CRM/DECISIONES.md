# Decisiones

1. **CRM autónomo — Aprobada:** mantener identidad y repositorio propios.
2. **Evolución SaaS incremental — Aprobada:** preservar módulos útiles y evolucionar sin reescritura innecesaria.
3. **Estabilidad separada de evolución — Aprobada:** main como referencia estable; cambios SaaS de alcance mayor en rama de evolución, integrados con revisión y pruebas. Esta tarea no cambió ramas.
4. **Multi-cuenta — Requisito objetivo aprobado:** varias cuentas del mismo canal por organización, con credenciales, sesiones y webhooks aislados.
5. **APIs oficiales primero — Aprobada:** Browser Factory solo cuando se requiera automatización de navegador.
6. **Autonomía del ecosistema — Aprobada:** Comuniti Manager y WhatsPower mantienen capacidades y ciclos propios.
7. **Seguridad por diseño — Aprobada:** tenant explícito, ownership exacto, cifrado, mínimo privilegio y auditoría; ante ambigüedad, denegar.
8. **Memoria en el repo — Aprobada:** CONTEXTO CRM vive dentro de ALBRA8/CRM-ALBRA.
9. **Producción con evidencia — Aprobada:** no declarar estabilidad sin commit, entorno, pruebas, health, backup y restauración verificables.
10. **SSO de ecosistema condicionado y blindado — Aprobada (2026-11-18):** el acceso inter-servicios (CRM -> WhatsPower -> WhatsPower-Ultra) solo está disponible en modo desarrollo/demo (`NODE_ENV !== 'production'` y `DEMO_MODE=true`). En producción (`NODE_ENV=production`) todas las rutas (`/studio/login-demo`, `/studio/login-ecosystem`, `/api/auth/ecosystem/links`) responden estrictamente HTTP 403 Forbidden y la UI oculta los botones de acceso demo.
11. **Protección criptográfica de PII con sal secreta — Aprobada (2026-11-18):** la denylist del guardián de PII (`check:pii`) utiliza hashes HMAC-SHA256 con `PII_PEPPER`. No se versionan identificadores personales ni teléfonos reales en el árbol git ni en repositorios públicos.
12. **Suite E2E 3 servicios autocontenida y multiplataforma — Aprobada (2026-11-18):** `npm run e2e:3` orquesta dinámicamente CRM, WhatsPower y WhatsPower-Ultra usando puertos efímeros y bases de datos SQLite temporales independientes, garantizando ejecución reproducible en Windows y Linux con `SENT=0` estricto sin dependencias de `/tmp` ni scripts `.sh`.
13. **Criterio de unificación de bandeja (canónico primero, legacy como respaldo) — Aprobada (2026-11-20):** la bandeja de entrada opera primariamente sobre el modelo canónico unificado (`ChannelConversation` y `ChannelMessage`), garantizando soporte multi-cuenta sin romper hilos legados preexistentes.
14. **Kits de integración desacoplados para capas 2A y 2B — Aprobada (2026-11-20):** las 13 tareas que dependen de WhatsPower y Ultra se entregaron como librerías autónomas probadas en `integration-kits/wp-ultra/`, preservando la regla de no modificar repositorios ajenos desde el CRM.
15. **Auditoría de redundancias aplazada a fase post-cierre — Aprobada (2026-11-20):** la simplificación y limpieza de código legado no se mezcló con la construcción de las 48 tareas; queda planificada y delimitada en `AUDITORIA_REDUNDANCIAS_Y_SIMPLIFICACION_FASE_POSTERIOR.md`.
16. **Unificación canónica de canales en 4 fases y eliminación limpia de modelos legacy — Aprobada y Ejecutada (2026-11-21):** las 3 generaciones de canales convergieron en la arquitectura canónica universal (`ChannelConnection` → `ChannelConversation` → `ChannelMessage`). Se adaptó el daemon Baileys para escribir directamente en las tablas canónicas (`better-sqlite3`), se desacopló Google OAuth en `GoogleIntegration`, se aplicó backfill dual determinista (TS + SQL) y se eliminaron formalmente mediante migración Prisma las tablas `Integration`, `WhatsAppConnection`, `WhatsAppConnectionEvent`, `WhatsAppConversation` y `WhatsAppMessage`. El schema se simplificó de 47 a 43 modelos con cero pérdida de historial.

## Decisiones técnicas pendientes
Base de datos de producción; estrategia de aislamiento; identidad/OAuth; planes y facturación; orquestación de sesiones y alta disponibilidad.

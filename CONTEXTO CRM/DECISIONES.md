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

## Decisiones técnicas pendientes
Base de datos de producción; estrategia de aislamiento; identidad/OAuth; planes y facturación; orquestación de sesiones y alta disponibilidad.

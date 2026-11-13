# Roadmap de CRM ALBRA

Este roadmap resume el plan maestro SaaS. No representa fechas comprometidas ni tareas completadas.

| Orden | Etapa | Resultado esperado | Estado |
|---:|---|---|---|
| 0 | Línea base y releases | Versión estable reproducible, pruebas y rollback | Pendiente de revalidación |
| 1 | Aislamiento multi-tenant | Pruebas negativas completas entre organizaciones | Pendiente |
| 2 | Conexiones multi-cuenta | Varias cuentas por canal y organización | Pendiente |
| 3 | Webhooks y eventos | Resolución exacta, firma, idempotencia y reintentos | Pendiente |
| 4 | WhatsApp multicuenta | Sesiones Baileys independientes y concurrentes | Pendiente |
| 5 | Instagram, Messenger y otros canales | OAuth y ciclo de vida multi-cuenta | Pendiente |
| 6 | SaaS comercial | Onboarding, planes, cuotas y facturación | Pendiente |
| 7 | Operación y escala | Observabilidad, backups, SLO/RPO/RTO y carga | Pendiente |
| 8 | Ecosistema ALBRA | Contratos desacoplados entre productos | Dirección definida; ejecución pendiente |

## Próximo bloque recomendado

Auditar el aislamiento multi-tenant de extremo a extremo y cerrar el inventario de integraciones. No iniciar cambios amplios de esquema antes de conocer los resultados.

## Regla de avance

Cambiar un estado solo con evidencia: commit/PR, pruebas, informe de auditoría o despliegue verificado. Registrar fecha, alcance y enlace de la evidencia.


## Plan de cierre actualizado — 2026-11-12

Este bloque complementa el roadmap histórico y aterriza el plan de evolución acordado. No implica que las tareas estén ejecutadas.

| Orden | Bloque | Resultado/criterio de salida | Estado |
|---:|---|---|---|
| 0 | Línea base de los tres repositorios | SHA, ramas, CI y pruebas reproducibles; separar main, repair/fix y stable-production | Por ejecutar |
| 1 | Integración entre los tres motores | Contratos CRM↔WHATSPOWER↔ULTRA verificados con procesos reales; identidad org, webhooks, bajas e idempotencia | Pendiente; B2 WhatsApp bloqueante hasta resolver crash-window |
| 2 | Seguridad y operación | Política de contraseñas/permisos unificada, secretos rotados, lint baseline reducido, migraciones y backups/restauración ensayados | Pendiente |
| 3 | Multicuenta por canal | Varias conexiones por organización/canal, OAuth/sesión y webhooks aislados, selección inequívoca inbound/outbound | Pendiente; WhatsApp multi-sesión no acredita todos los canales |
| 4 | Identidades virtuales | Perfil/persona/marca con cuentas, clientes, conversaciones, preferencias y memoria separadas dentro de la organización | Diseño e implementación pendientes |
| 5 | Preparación SaaS/producción | Motor de BD, staging, escalabilidad, observabilidad, onboarding/cuotas, SLO/RPO/RTO, carga y recuperación | Pendiente de decisión y validación |

### Principio de preservación

La base multiusuario y multiempresa existente se conserva; no se reconstruye sin evidencia de un defecto. Los estados solo avanzan con commit/PR, pruebas reproducibles y alcance identificado. CI verde, código en una rama no integrada o pruebas con mocks no equivalen a integración real ni a despliegue en producción. No desplegar, activar envíos reales ni reescribir historial Git sin autorización expresa.

El detalle de tareas y criterios de aceptación está en `PENDIENTES.md`, sección "Plan de cierre y evolución — 2026-11-12".

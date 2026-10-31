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

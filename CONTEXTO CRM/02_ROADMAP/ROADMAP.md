# Roadmap CRM ALBRA
Plan de trabajo, no calendario comprometido ni evidencia de implementación.

| Orden | Frente | Resultado esperado | Estado |
|---:|---|---|---|
| 0 | Línea base/releases | Estado reproducible, pruebas y rollback | Pendiente revalidación |
| 1 | Aislamiento multi-tenant | Pruebas negativas entre organizaciones | P0.1–P0.4 registrados como verificados 2026-11-06; auditoría integral pendiente |
| 2 | Conexiones multi-cuenta | N cuentas por canal/org | PLANNED |
| 3 | Webhooks/eventos | Resolución exacta, firma, idempotencia, retries | PLANNED |
| 4 | WhatsApp multicuenta | Sesiones aisladas concurrentes | P0.1 reportado verificado; multi-canal pendiente |
| 5 | Otros canales | OAuth/ciclo multi-cuenta | PLANNED |
| 6 | SaaS comercial | Onboarding, planes, cuotas, facturación | PLANNED |
| 7 | Operación/escala | Observabilidad, backup, SLO/RPO/RTO, carga | PLANNED |
| 8 | Ecosistema ALBRA | Contratos desacoplados | Dirección aprobada; ejecución continua |

Orden recomendado: resolver conflictos documentales; auditar tenancy; verificar opcionalidad; diseñar multi-cuenta; completar recuperación y criterios SaaS. Cada fase cambia a VERIFIED solo con commit/PR, pruebas, revisión de seguridad y evidencia reproducible.

# Índice de integraciones
| ID | Integración | Dirección | Contrato/documentación | Estado |
|---|---|---|---|---|
| INT-001 | Inbound bridge | CRM→WP | POST /api/inbound, HMAC-SHA256; informe añade timestamp anti-replay | Documented; ejecución histórica REPORTED |
| INT-002 | CRM actions | WP→CRM | POST /api/crm/actions, API key/Bearer y catálogo | Documented; tenant scope a verificar |
| INT-003 | Stage-change | CRM→WP | Informe 2026-10-27 describe POST /api/crm/stage-change | REPORTED; HEAD no revalidado |
| INT-004 | Despacho daemon | ULTRA→CRM daemon | POST /send, auth interna | Documented; E2E histórico reportado |
| INT-005 | Locks/suppression | ULTRA→WP | Endpoints internos; standalone declarado | Documented; opcionalidad pendiente |
| INT-006 | CRM→ULTRA directo | — | Informe legado dice que no existía contrato | NOT ESTABLISHED |
| INT-007 | Resultados campaña→timeline CRM | — | Informe legado dice no implementado | NOT ESTABLISHED |

Cada contrato debe registrar propietario, versión, auth, identidad org, firma, request/response, idempotencia, timeout/retry, errores, observabilidad, compatibilidad y pruebas. Nunca incluir secretos.

Evidencia histórica: [INFORME-INTEGRACION-WHATSPOWER.md](https://github.com/ALBRA8/CRM-ALBRA/blob/main/INFORME-INTEGRACION-WHATSPOWER.md), 2026-10-27; no es verificación del HEAD actual.

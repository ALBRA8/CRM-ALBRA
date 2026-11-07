# Índice de fallos y limitaciones
| ID | Fallo/limitación | Estado | Contexto |
|---|---|---|---|
| FAIL-001 | Cuatro tests CRM atribuidos a eco LLM en informe 2026-10-27 | HISTORICAL REPORTED; revalidar | 386/390 en informe |
| FAIL-002 | ULTRA POST /api/campaigns sin organizationId devolvía 400 críptico | HISTORICAL REPORTED | No corregido entonces |
| FAIL-003 | Test WP allowlist importaba ruta audit_repos ausente fuera del entorno | HISTORICAL REPORTED | Fuera de npm test |
| FAIL-004 | Transporte default MockTransportSender en WP | HISTORICAL REPORTED; verificar | No asumir envío real |
| FAIL-005 | Lint baseline 358 errores/5089 avisos | REPORTED según sesión 2026-11-06 | Revalidar |
| FAIL-006 | FICHA ULTRA dice “cero código implementado” en fase temprana | VERIFIED como texto histórico | No representa runtime actual |

Cerrar con causa, cambio, regresión y evidencia. Si no se reproduce, marcar no reproducido; no borrar antecedente.

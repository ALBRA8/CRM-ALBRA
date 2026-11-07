# Módulo: WHATSPOWER — ManyChat
**Repo:** [ALBRA8/WHATSPOWER](https://github.com/ALBRA8/WHATSPOWER) · Fuente: [README](https://github.com/ALBRA8/WHATSPOWER/blob/main/README.md), consultado 2026-11-07.

## Propósito/capacidades declaradas
Flow Builder visual, simulador, nodos mensaje/captura/condición/acción, A/B split, drip sequences, handoff humano, locks JIT y opt-out.

## Responsabilidades y límites
Ejecuta flujos conversacionales y mantiene estado operativo propio; invoca capacidades CRM mediante contratos autorizados. No es CRM ni dueño de base comercial; no aloja agente principal; CRM funciona sin él; no depende de ULTRA.

## Integración documentada
README describe inbound CRM→/api/inbound firmado HMAC-SHA256 y acciones WP→CRM por REST /api/crm/actions. Declara que CRM opera autónomamente si WP está apagado.

## Pendiente
Fijar SHA; contrastar README con handlers/tests; verificar tenant scope, idempotencia, retries, errores y desconexión/reconexión. No se certifica runtime, seguridad ni E2E en esta tarea.

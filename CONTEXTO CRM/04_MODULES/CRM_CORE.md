# Módulo: CRM Core
**Repo:** [ALBRA8/CRM-ALBRA](https://github.com/ALBRA8/CRM-ALBRA) · Fuentes: README, docs/HARNESS.md, schema.prisma.

## Propósito y responsabilidades
Producto central de gestión comercial multi-organización y gobierno de identidad/datos/integraciones. Organizaciones, usuarios, roles/RBAC; clientes, oportunidades, pipeline, reservas, cotizaciones, productos y transacciones; timeline, ActivityLog, automatizaciones y memoria; contratos REST/MCP; canales y daemon WhatsApp.

## Límites
CRM es dueño del dominio comercial. Los módulos no escriben directamente en la base comercial. El core debe operar si ManyChat o Watson no están disponibles.

## Agente principal — conflicto
El propietario confirma que el agente principal único pertenece al CRM. Sin embargo, [docs/HARNESS.md](https://github.com/ALBRA8/CRM-ALBRA/blob/main/docs/HARNESS.md) afirma que el agente propietario de chat fue eliminado y que un host externo futuro aportaría inteligencia, aún sin integración. No se oculta ni se afirma implementación actual; requiere decisión y revisión de código separada.

## Interfaces documentadas
REST /api/crm/actions; MCP /api/mcp; MemoryDV /api/memory; canales WhatsApp, Telegram, Instagram, email y Google según HARNESS. No certifica disponibilidad E2E.

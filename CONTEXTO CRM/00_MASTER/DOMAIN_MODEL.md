# Modelo de dominio — mapa conceptual
No sustituye schema.prisma.

- Organization: raíz de aislamiento.
- User/roles: identidad y autorización.
- Client: entidad comercial/contacto.
- Opportunity/pipeline stages: proceso de venta.
- Reservation, Quote, Product, Transaction: operaciones comerciales.
- Timeline/ActivityLog: trazabilidad.
- Integration/conexiones: configuración de conectores. CONTEXTO legado indica unicidad Integration por organización; N cuentas/canal es objetivo, no asumirlo implementado.
- Knowledge, AgentMemory, ConversationEmbedding, NichoConfig: conocimiento y memoria descritos en HARNESS.
- WhatsAppConversation/WhatsAppMessage: mensajes persistidos por CRM/daemon según documentación.

## Modelo objetivo PLANNED
`Organization -> N ChannelConnections -> provider/channel/externalAccountId/credentials/status`. ChannelConnection es propuesta del plan SaaS, no entidad confirmada. Requiere ownership, credenciales cifradas, permisos, expiración y auditoría.

Entidades comerciales tenant-scoped; org derivada de identidad o credencial autorizada, no de un organizationId arbitrario. Revisar constraints compuestas: organizationId presente no prueba aislamiento completo.

Fuentes: [schema.prisma](https://github.com/ALBRA8/CRM-ALBRA/blob/main/prisma/schema.prisma), [HARNESS](https://github.com/ALBRA8/CRM-ALBRA/blob/main/docs/HARNESS.md).

# Arquitectura

## Estado documentado
- Aplicación: Next.js App Router, React, TypeScript y Tailwind.
- Dominio: organizaciones, usuarios, clientes, timeline, oportunidades, reservas, cotizaciones, catálogo, transacciones, automatizaciones y memoria.
- Persistencia: Prisma sobre SQLite en el esquema revisado. La elección de base de datos de producción y migración deben validarse; cambiar el proveedor no es solo cambiar una cadena.
- Seguridad/contratos: JWT, RBAC, API keys por organización, credenciales cifradas según documentación, HMAC en webhooks, REST de acciones, MCP y MemoryDV.
- Canales: WhatsApp Baileys daemon, WhatsApp Cloud, Instagram, Telegram; además Google, SMTP y LLM según README/HARNESS.

## Límite actual relevante
Integration es uno-a-uno con Organization. El daemon Baileys expone estado global de una sesión y una organización vinculada. El webhook Instagram necesita matching estricto por cuenta.

## Arquitectura objetivo
Organization -> N ChannelConnections -> proveedor/canal/cuenta externa, credencial cifrada, permisos, estado, expiración y auditoría. Todo evento debe validar firma, identificar una conexión única, resolver organizationId y procesarse con idempotencia.

## Ecosistema
CRM ALBRA mantiene el dominio comercial. BROWSER FACTORY es ejecución de navegador/proxy cuando sea necesario, no router universal de APIs. COMUNITI-MANAGER mantiene autonomía de gestión de comunidades. WHATSPOWER conserva su rol de mensajería y puente. Integración mediante contratos explícitos y versionados, sin fusionar productos.

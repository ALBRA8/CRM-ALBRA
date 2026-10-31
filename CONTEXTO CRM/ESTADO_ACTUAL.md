# Estado actual

**Base revisada:** rama main; README, esquema Prisma, daemon Baileys, webhook Instagram y docs/HARNESS.md. Revisión selectiva, sin ejecutar pruebas ni inspeccionar el despliegue.

## Capacidades declaradas
CRM multi-tenant con organizaciones, usuarios, clientes, oportunidades, pipeline, reservas, cotizaciones, finanzas, reportes, equipo, automatizaciones, WhatsApp, Instagram, Telegram, Google, SMTP, contratos REST/MCP y memoria MemoryDV. Docker separa aplicación y daemon WhatsApp. Son declaraciones de documentación, no certificación de producción.

## Evidencia en código
- Organization es raíz del esquema Prisma y modelos comerciales usan organizationId.
- Integration.organizationId tiene restricción única: una configuración Integration por organización, no un registro N-a-N de cuentas por canal.
- daemon.mjs mantiene un socket, estado de conexión y linkedOrgId globales; la sesión Baileys se almacena en un directorio local. No acredita múltiples sesiones simultáneas.
- Webhook Instagram verifica HMAC, pero permite matching cuando instagramAccountId no está configurado. Se requiere resolución exacta y no ambigua.
- docs/HARNESS.md describe REST /api/crm/actions, MCP /api/mcp y MemoryDV.

## Conclusión
Hay una base CRM multi-tenant documentada y componentes reales de integración. Multi-tenant no significa multi-cuenta: múltiples cuentas por organización, sesiones Baileys concurrentes y onboarding SaaS siguen siendo brechas que deben diseñarse y probarse. No se certifica aquí estabilidad del despliegue.

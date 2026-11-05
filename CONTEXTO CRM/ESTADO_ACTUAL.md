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

## Actualización de seguridad — 2026-11-05

**Importante:** los siguientes avances provienen de informes de ejecución compartidos en la conversación. Se registran como resultados reportados; esta actualización documental no inspeccionó el código ni reprodujo las pruebas de forma independiente.

### P0.1 — WhatsApp Baileys multi-organización
**Estado reportado: implementado y probado; pendiente de verificación independiente del remoto y del código desplegado.**

- Sesiones independientes por organización mediante Map<orgId, sesión>.
- Credenciales separadas en .wa-auth/<orgId>/, con socket, QR, teléfono, reintentos y errores propios.
- Callbacks/eventos cerrados sobre orgId y validación estricta del identificador antes de acceder al disco.
- /connect, /disconnect, /send, /qr y /conversations requieren organización.
- Compatibilidad de /send sin orgId solo cuando existe exactamente una sesión conectada; con dos o más, responde 409.
- Proxy CRM deriva orgId del JWT y no confía en el body del cliente.
- Migración del layout legado reportada como no destructiva, conservando metadata .bak.
- Pruebas reportadas: 17 unitarias nuevas, suite 422/422, TypeScript 0 errores y smoke en vivo 13/13, incluyendo intento de acceso cruzado entre organizaciones con respuesta 403.
- Commit reportado: c2f4001 en main y fix/saas-security-and-stabilization.
- stable-production reportada intacta en ea87cc2.
- Documentación reportada: docs/P0.1-aislamiento-whatsapp-multiorg.md.

La revisión inicial de esta carpeta describía un socket y linkedOrgId globales. Ese hallazgo queda como antecedente histórico y debe considerarse supersedido por el cambio reportado, no como evidencia del estado actual del código.

### P0.2 — Aislamiento de ejecuciones del Doctor
**Estado: pendiente.** Impedir lectura o modificación de ejecuciones de otros tenants en todas las rutas y operaciones, incluyendo relaciones, acciones masivas, reintentos y servicios internos. orgId debe proceder de la identidad autenticada. Añadir pruebas negativas entre organizaciones y pruebas positivas por rol.

### P0.3 — Endpoint público /api/nicho
**Estado: pendiente.** Revisar si el endpoint debe ser público; impedir que parámetros controlados por el cliente seleccionen un tenant con acceso a datos privados. Resolver el contexto autenticado desde la identidad y limitar el acceso anónimo a datos públicos explícitamente permitidos. Probar manipulación de identificadores, enumeración y abuso.

### P0.4 — Secretos inseguros
**Estado: pendiente.** Auditar .env.example, configuración, scripts, contenedores, workflows y documentación. Eliminar secretos predeterminados, validar secretos obligatorios/robustos al arrancar en producción y rotar credenciales reales que hayan podido exponerse. No almacenar valores secretos en esta carpeta.

## Compatibilidad Windows y aislamiento de tests — referencia separada
Se reportó un commit local 658740b con correcciones de aislamiento de variables de entorno, encoding UTF-8 y mock de os.symlink; también se reportaron 434/434 pruebas en tres escenarios y un patch portátil. El propio informe indicó que el push estaba bloqueado por falta de credenciales.

**No está confirmado que 658740b pertenezca a CRM-ALBRA ni que esté publicado en este repositorio.** No integrarlo ni atribuirlo a CRM-ALBRA hasta verificar repositorio, rama, árbol del commit y remoto. Mantenerlo separado del trabajo simultáneo en WHATSPOWER y WHATSPOWER-ULTRA.

## Conclusión
Hay una base CRM multi-tenant documentada y componentes reales de integración. Los avances P0.1 están reportados como implementados, pero requieren contraste independiente contra el código y el remoto. P0.2, P0.3 y P0.4 continúan siendo bloqueadores hasta que se corrijan y se demuestren con pruebas. No se certifica aquí estabilidad del despliegue ni preparación para producción.

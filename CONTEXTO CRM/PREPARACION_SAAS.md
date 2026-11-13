# Preparación SaaS — criterios de salida

Fecha de revisión: 2026-11-13  
Repositorio: `ALBRA8/CRM-ALBRA`  
Rama de trabajo: `fix/migration-safety-audit`  
Estado: plan de ejecución y brechas verificadas; NO equivale a lanzamiento SaaS.

## Estado real observado

- Existe tenancy por `Organization`, usuarios con roles, `tokenVersion`, rate limiting persistente, auditoría, exportación/backup y una batería de pruebas de aislamiento.
- El registro crea organización + owner en transacción. Las invitaciones de equipo crean miembros dentro de la organización del administrador.
- La API de equipo ahora exige mínimo 8 caracteres para contraseñas de invitación, alineado con el registro.
- El esquema Prisma aún declara SQLite como datasource y `Organization.plan` tiene valor por defecto `pilot`; no hay evidencia suficiente de un ciclo comercial completo de suscripción/cobro/entitlements. No vender planes de pago ni cuotas automáticas hasta implementarlo.
- El modelo actual incluye `Integration` singular por organización y un modelo `WhatsAppConnection`; eso NO demuestra multicuenta general para Instagram, Messenger, Telegram y múltiples proveedores.
- Docker/DEPLOY.md describen una instalación de fase inicial con SQLite y una sesión WhatsApp por despliegue; no es prueba de arquitectura SaaS multi-tenant escalable.
- Existe plan de backup y restore, pero antes de vender se debe probar copia externa y restauración real en el entorno destino.
- Hay una observación histórica crítica sobre secretos en commits anteriores: verificar rotación efectiva de llaves/PAT y estado de credenciales activas antes de abrir acceso comercial.

## Bloque A — Multiusuario y tenancy (bloqueante)

- [x] Registro crea Organization + owner en transacción.
- [x] Invitación API asigna organización desde la sesión; ignora cualquier `organizationId` enviado por el cliente.
- [x] Roles privilegiados de plataforma no se conceden mediante la API normal de equipo.
- [x] Cambios de rol/estado incrementan `tokenVersion` y revocan sesiones antiguas.
- [x] Listado/actualización/desactivación de miembros están scoped por organización en servidor.
- [ ] Completar CI de las nuevas pruebas `team-multitenant` en el HEAD vigente.
- [ ] Probar en navegador: owner/admin invita, miembro inicia sesión, rol se modifica, miembro desactivado pierde sesión.
- [ ] Decidir flujo de invitación real por email (token aleatorio hasheado, caducidad, un solo uso); hoy la ruta crea cuenta con contraseña, no un flujo de invitación por enlace.
- [ ] Revisar recuperación de cuenta, verificación de email, MFA obligatorio para administradores y política de sesiones/dispositivos.
- [ ] Probar límites de concurrencia y unicidad de email bajo registro/invitaciones simultáneas.

## Bloque B — Multicuenta de canales (bloqueante antes de prometerlo)

- [ ] Definir entidad común `ChannelConnection`: `organizationId`, `channel`, `provider`, `externalAccountId`, `displayName`, `status`, `scopes`, timestamps de token, referencia cifrada de credenciales y estado de salud.
- [ ] Índices únicos compuestos: por proveedor/cuenta externa y por organización/canal según reglas de negocio; nunca permitir que un webhook se asigne por coincidencia parcial.
- [ ] Migrar la integración singular actual con estrategia expand/contract y rollback; mantener compatibilidad hasta verificar paridad.
- [ ] OAuth: state firmado, PKCE cuando aplique, redirect URI allowlist, validación de scopes, renovación y revocación; no registrar tokens.
- [ ] Webhooks: validar firma, resolver por identificador externo exacto, deduplicar por `connectionId + eventId`, manejar reintentos y dead-letter queue.
- [ ] WhatsApp Baileys: sesión/auth-state independiente por conexión, orquestador, concurrencia, reconexión y recuperación probadas.
- [ ] WhatsApp Cloud, Instagram, Messenger y Telegram: ciclo conectar/desconectar/renovar/revocar y enrutamiento por conexión; no declarar cubierto un canal por tener un endpoint aislado.
- [ ] Prueba integrada con dos organizaciones y dos cuentas del mismo canal, procesos separados y credenciales reales de sandbox; demostrar que no hay cruce.

## Bloque C — SaaS comercial (bloqueante antes de cobrar)

- [ ] Definir catálogo de planes, límites y add-ons como configuración versionada.
- [ ] Implementar suscripción, estado de pago, periodo de gracia, cancelación, reactivación y portal de facturación.
- [ ] Webhooks del proveedor de pagos firmados e idempotentes; reconciliación contra API del proveedor. No almacenar tarjetas.
- [ ] Middleware de entitlements por organización en servidor; límites aplicados también a workers, APIs, exportaciones y canales.
- [ ] Medición de uso auditable (usuarios activos, conexiones, mensajes, almacenamiento, IA) y protección frente a doble conteo.
- [ ] Onboarding autoservicio: registro, verificación de email, creación de workspace, invitaciones y guía de primera conexión.
- [ ] Términos, privacidad, tratamiento de datos, retención, exportación, eliminación y canal de soporte.
- [ ] Impuestos, moneda, facturación electrónica/recibos y política de reembolsos según jurisdicción objetivo.

## Bloque D — Infraestructura y operación

- [ ] Migrar SQLite a PostgreSQL con ensayo sobre copia representativa, validación de conteos/relaciones y rollback; revisar locks y transacciones.
- [ ] Entornos separados dev/staging/producción y secretos independientes.
- [ ] Backups cifrados, copia externa, retención, restore drill y RPO/RTO aprobados.
- [ ] Observabilidad: logs estructurados con tenant/correlation ID sin PII ni secretos, métricas, trazas, alertas y auditoría.
- [ ] Límites por tenant, colas durables, aislamiento de workers y protección ante noisy-neighbor.
- [ ] Prueba de carga multi-tenant y capacidad objetivo documentada.
- [ ] Hardening de dominio/HTTPS, cookies, CORS/CSRF, CSP, cabeceras y escaneo de dependencias.
- [ ] Plan de incidentes, rotación/revocación de credenciales, rollback y responsable de guardia.

## Secuencia de ejecución

1. Cerrar CI y pruebas de equipo/tenancy; no debilitar RBAC para hacer pasar tests.
2. Cerrar ciclo de sesión, invitaciones y recuperación.
3. Diseñar y migrar el modelo común de conexiones; primero un canal piloto con dos cuentas reales.
4. Generalizar a los demás canales y endurecer webhooks/idempotencia.
5. Definir entitlements y billing; habilitar planes solo cuando los límites estén aplicados en servidor.
6. Migrar a PostgreSQL, completar restore/load/security drills y staging.
7. Lanzamiento limitado (cohorte piloto) con monitorización y soporte; después ampliar.

## Regla de liberación

No llamar al producto “SaaS listo para producción” hasta que los bloques A–D tengan evidencia verificable. Código en rama, mocks, documentación y CI aislado no equivalen a staging, producción ni validación con proveedores reales. No hacer merge, despliegue, activar envíos reales ni cobrar sin autorización expresa.


## Evidencia de cierre de la tanda multiusuario — 2026-11-13

- Se corrigió la prueba cross-tenant para autenticar como admin de org B antes de probar modificación/desactivación de un miembro de org A. El 403 anterior era la respuesta correcta para un member sin permisos; no era un bypass del aislamiento.
- Se unificó el mínimo de contraseña en la invitación de equipo a 8 caracteres, alineado con el registro.
- Se añadió prueba de rechazo de contraseña de 7 caracteres.
- Commit de código: `268a124ce8ee2d3a06d33978d3cc31a509efa8a8`.
- CI run `43384116466`: **success**. 65/65 archivos y 587/587 pruebas; escáner de secretos, Prisma/migraciones, TypeScript, lint y build de producción aprobados.
- PR #3 sigue abierta/en draft y sin merge ni despliegue.
- El resultado cubre los endpoints de equipo probados; no certifica todavía el flujo visual de invitación, email de invitación, verificación de correo, ni la multicuenta de todos los canales.

# Auditoría de redundancias y simplificación — fase posterior

**Fecha de registro:** 2026-11-18  
**Fecha de cierre y ejecución:** 2026-11-21  
**Repositorio:** ALBRA8/CRM-ALBRA  
**Ubicación:** CONTEXTO CRM  
**Estado:** EJECUTADA Y COMPLETADA (2026-11-21) — Plan de 4 Fases ejecutado en commit `46f0210`.  
**Informe de ejecución:** Ver `INFORME_AUDITORIA_REDUNDANCIAS_Y_SIMPLIFICACION.md` (Sección 7).  
**Prioridad:** CERRADA. Conexiones, conversaciones, mensajes y Google desacoplados y migrados a la arquitectura canónica.

> [!NOTE]
> Esta fase posterior fue completada exitosamente el 2026-11-21 tras la aceptación de las 48 tareas y el despliegue de los 9 kits en WhatsPower y WhatsPower-Ultra. Las 4 fases de simplificación fueron implementadas en el commit `46f0210` en `repair/produccion-real` reduciendo el esquema Prisma de 47 a 43 modelos con cero pérdida de datos.

## 1. Propósito

Documentar una auditoría posterior para determinar si CRM-ALBRA contiene funcionalidades duplicadas, responsabilidades solapadas, código legado sin uso o complejidad innecesaria. El objetivo es simplificar y hacer más mantenible el CRM **sin perder capacidades de negocio, datos, integraciones, seguridad ni compatibilidad**.

Tener más módulos no garantiza un mejor producto si hay procesos duplicados o difíciles de operar. La meta es conservar la amplitud funcional de ALBRA y reducir únicamente la duplicación demostrada.

## 2. Decisión de alcance

1. **No modificar ni ampliar ahora el plan de construcción vigente de 48 tareas.**
2. **No interrumpir al constructor ni introducir refactors oportunistas** durante esa ejecución.
3. Ejecutar esta auditoría cuando la construcción haya terminado y sus resultados hayan sido probados y aceptados.
4. Hacer el análisis primero; no borrar, migrar ni unificar componentes como parte de la mera inspección.
5. Cualquier cambio posterior debe tener propuesta, evidencia, pruebas, plan de migración y posibilidad de reversión.
6. El alcance es exclusivamente CRM-ALBRA. No modificar WHATSPOWER, WHATSPOWER-ULTRA ni otros repositorios o productos.

## 3. Áreas que merecen revisión

Los siguientes puntos son **hipótesis de auditoría**, no defectos confirmados ni autorización para eliminar código:

| Área | Elementos o responsabilidades a contrastar | Pregunta de auditoría |
|---|---|---|
| Conexiones e integraciones | `Integration`, `WhatsAppConnection`, `ChannelConnection` | ¿Representan conceptos distintos o hay dos fuentes de verdad para una misma conexión? |
| Conversaciones | `WhatsAppConversation`, `ChannelConversation` | ¿La coexistencia responde a una migración compatible o mantiene lógica duplicada indefinidamente? |
| Mensajes | `WhatsAppMessage`, `ChannelMessage` | ¿Hay duplicación de persistencia, estados, eventos o consultas? |
| Envío y recepción | Adaptadores, daemon, webhooks, colas y servicios | ¿Existe una ruta canónica por canal y responsabilidades bien delimitadas? |
| Automatizaciones | Workflows, scheduler, secuencias y workers | ¿Se solapan motores, disparadores o tareas programadas? |
| IA y memoria | Knowledge, AgentMemory, MemoryDV y contratos de agentes | ¿Cada componente tiene una responsabilidad diferenciada y documentada? |
| Configuración | Pantallas, formularios y parámetros de integraciones | ¿Hay opciones repetidas, obsoletas o configuraciones difíciles de mantener? |
| Código legado | Servicios, rutas, componentes y modelos antiguos | ¿Está realmente sin uso o sigue siendo necesario para compatibilidad, datos o clientes existentes? |

La presencia de nombres o modelos parecidos no demuestra duplicación. En particular, los modelos legacy y unificados de canales pueden coexistir durante una migración progresiva. No retirar ninguno hasta verificar referencias, datos, escrituras/lecturas, compatibilidad, migración y rollback.

## 4. Método de auditoría

### Fase A — Línea base

- Registrar rama y commit exactos auditados.
- Confirmar que la construcción de 48 tareas está cerrada y aceptada.
- Ejecutar y registrar pruebas, build, tipos, lint y verificaciones de seguridad disponibles.
- Identificar el entorno y la base de datos examinados, sin copiar secretos ni datos personales al informe.

### Fase B — Inventario y trazabilidad

- Inventariar módulos, modelos Prisma, tablas, rutas API, server actions, servicios, workers, cron, webhooks, eventos y componentes de interfaz.
- Rastrear quién crea, lee, actualiza y elimina cada entidad.
- Identificar llamadas, imports, dependencias, consumidores externos y contratos públicos.
- Revisar permisos, aislamiento por organización, auditoría y límites entre tenants.
- Buscar código sin referencias, pero confirmar también usos dinámicos, reflexión, jobs y consumidores externos.

### Fase C — Clasificación

Cada hallazgo debe clasificarse como:

- **Duplicación confirmada:** dos implementaciones realizan la misma responsabilidad sin justificación.
- **Solapamiento legítimo:** responsabilidades relacionadas, pero con propósitos o límites distintos.
- **Compatibilidad/migración:** coexistencia temporal necesaria para transición o soporte legacy.
- **Obsoleto confirmado:** no tiene consumidores ni función operativa y existe evidencia suficiente.
- **Complejidad sin duplicación:** funciona, pero puede simplificarse sin cambiar responsabilidades.
- **Sin evidencia suficiente:** requiere más trazabilidad; no se propone eliminación.

### Fase D — Propuesta y validación

Para cada hallazgo documentar:
- Evidencia reproducible (archivos, símbolos, rutas, modelos y referencias).
- Impacto funcional y técnico.
- Riesgos para datos, integraciones, seguridad y aislamiento multiempresa.
- Alternativa recomendada: conservar, aclarar responsabilidades, unificar, migrar o retirar.
- Pruebas de regresión y criterios de aceptación.
- Migración de datos, compatibilidad y procedimiento de rollback, cuando aplique.
- Estimación y prioridad.

### Fase E — Cambios controlados

Los cambios se harán solo después de aprobar la propuesta. Preferir cambios pequeños y reversibles, con pruebas antes/después. No eliminar tablas, campos, endpoints, eventos ni contratos públicos sin verificar consumidores y estrategia de migración.

## 5. Criterios de protección obligatorios

La simplificación no puede degradar ni eliminar sin decisión expresa:

- Multiempresa y aislamiento de datos por organización.
- Usuarios, roles, permisos y auditoría.
- Clientes, historial y oportunidades/pipeline.
- Cotizaciones, productos, servicios e inventario.
- Finanzas, reportes y exportaciones.
- Agenda y sus integraciones.
- Canales de comunicación y sus conexiones.
- Automatizaciones y tareas programadas.
- IA, memoria y contratos de integración REST/MCP.
- Seguridad, cifrado, autenticación, webhooks y controles de acceso.

Tampoco debe introducir dependencias ni cambios en WHATSPOWER o WHATSPOWER-ULTRA.

## 6. Entregables esperados

1. Inventario de módulos, entidades y servicios.
2. Matriz de duplicaciones y solapamientos con evidencia.
3. Lista de componentes legacy y estado real de migración.
4. Registro de funcionalidades candidatas a simplificación o retiro, con justificación.
5. Plan priorizado de cambios seguros.
6. Matriz de pruebas y regresión.
7. Informe final con decisiones aprobadas, descartadas y aplazadas.

## 7. Criterio de cierre

La auditoría se considera terminada cuando cada hallazgo tenga evidencia, clasificación, decisión y responsable; y cuando los cambios aprobados superen las pruebas de regresión y no reduzcan las capacidades existentes.

**Regla final:** primero terminar y aceptar la construcción actual de 48 tareas; después auditar. Esta nota registra una fase futura y no constituye una orden para modificar el código durante el trabajo en curso.

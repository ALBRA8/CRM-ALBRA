# COPIA_CRM_ALBRA

## 1. RESUMEN Y CONTEXTO DEL SISTEMA

**Resumen Ejecutivo:**
Sistema de Inteligencia Comercial (SaaS Premium) diseñado para la gestión automatizada de clientes, ventas y finanzas en tiempo real. 
- **Entrada Principal:** Mensajes de texto o voz (WhatsApp, Telegram, Chat Local) y archivos de inventario (CSV).
- **Salida Principal:** Respuestas ejecutivas con IA, ejecución de herramientas (CRM, Agenda, Finanzas) y sincronización con Google Workspace.

**Stack Tecnológico:**
- **Runtime:** Node.js (TypeScript) con `tsx` para ejecución directa.
- **Backend Framework:** Express.js + Socket.io para comunicación bidireccional.
- **Base de Datos:** SQLite (`better-sqlite3`) con Sistema de Entidades Unificado (UES).
- **Motores de IA:** NVIDIA (Kimi-k2.5) como primario y Groq (Llama 3 70B) como fallback.
- **Integraciones:** WhatsApp Web.js, GrammY (Telegram), Google Auth (Drive, Sheets, Calendar).

**Flujo de Orquestación:**
1. **Captura:** El `index.ts` recibe eventos de WhatsApp, Telegram o la API de chat.
2. **Pre-procesamiento:** Se recupera el historial de logs, el perfil del usuario (por teléfono) y la configuración del nicho (`nicho.json`).
3. **Identidad:** Se detecta la etapa del prospecto en el pipeline y se inyecta una personalidad específica (Vendedor, Ejecutivo, etc.).
4. **Razonamiento:** El `processAgentMessage` en `core.ts` invoca al LLM con el Prompt de Sistema y las herramientas disponibles.
5. **Acción:** Si el LLM solicita una herramienta, el sistema ejecuta el `handler` correspondiente (ej. crear una cotización) y re-inyecta el resultado para generar la respuesta final.
6. **Post-procesamiento:** Análisis asíncrono de intención de compra y actualización de métricas.

---

## 2. IDENTIDAD DEL AGENTE: Asistente Virtual de Operaciones

**Modelo y Configuración:**
- **Modelo Primario:** `moonshotai/kimi-k2.5` (vía NVIDIA).
- **Modelo Fallback:** `llama3-70b-8192` (vía Groq).
- **Temperatura:** 
    - Chat General: Default (aprox. 0.7 - 1.0).
    - Análisis de Intención (Scoring): `0.1` para máxima precisión.
- **Top_p / Otros:** Valores estándar de los proveedores mencionados.
- **Circuit Breaker:** Pausa automática tras 3 fallas consecutivas en una ventana de 5 minutos.

**Ubicación en el Proyecto:**
- El núcleo reside en `src/agents/core.ts`.
- La lógica de identidades dinámicas está en `src/agents/identities.ts`.

---

## 3. PROMPT DE SISTEMA (EL CEREBRO)

Este prompt es dinámico y se construye en tiempo de ejecución. A continuación, el texto exacto del núcleo del sistema inyectado en la variable `SYSTEM_PROMPT`:

```text
Actúa como el Asistente Virtual de Operaciones de [Config: Branding Name].
Rubro: [Config: Rubro].
Personalidad: [Config: Personality].

[Contexto de Identidad Dinámica según Etapa del CRM]

=== FILOSOFÍA DE ATENCIÓN (Vendedor Inteligente) ===
- Escucha activamente: El cliente debe sentirse escuchado, nunca interrogado.
- Flexibilidad total: Si el cliente entrega datos en bloque (Nombre, ID, etc.) al inicio, procésalos con 'gestionar_perfil' y agradece de forma natural.
- Valor primero: Si preguntan por servicios o productos, responde con detalles y beneficios DE INMEDIATO. No detengas el flujo de venta por la falta de un dato.

=== RECAUDACIÓN PROGRESIVA e INTELIGENCIA CONTEXTUAL ===
- Identidad Fluida: Usa el contexto del remitente como una pista. Si hay un perfil previo reconocido, di: "¡Hola [Nombre]! Qué gusto verte de nuevo", pero mantente abierto a correcciones si es otro usuario.
- Datos con Propósito: No pidas datos por "requisito" del sistema. Pídelos por utilidad real para el cliente (Ej: "Para darte el costo de envío exacto, ¿en qué ciudad te encuentras?" o "Para agendar formalmente el/la [Config: Terminology Evento], ¿me confirmas tu correo?").
- Recaudación Orgánica: El CRM se llena durante la charla, no al principio como un filtro.

=== ELIMINACIÓN DE MÁSCARAS ROBÓTICAS ===
- Prohibido presentarte como "Motor Operativo", "Bot" o mostrar "Menús de Opciones" numerados.
- Saludo Situacional: Si es contacto nuevo, diles: "Hola, bienvenido a [Config: Branding Name]. Soy su asistente virtual. ¿En qué puedo ayudarle?".
- Adaptabilidad: Evalúa el tono del cliente. Si es breve, sé ejecutivo. Si es detallista, aporta valor con explicaciones claras.

=== PIPELINE DE VENTAS (Etapas) ===
1. Prospección (Interés inicial)
2. Calificación (Perfil validado)
3. Oferta (Se dio o se dará precio/cotización. Requiere EMAIL)
4. Seguimiento (Esperando decisión)
5. Cierre (Ganado/Perdido)
- Usa 'avanzar_etapa_oportunidad' proactivamente cuando el lead avance en su interés.

=== NEGOCIACIÓN INTELIGENTE ===
- Ante objeciones de precio (ej. "Muy caro", "¿Algún descuento?"), NUNCA digas "soy un bot, no tengo autoridad".
- Usa 'consultar_margen_negociacion' para ver qué descuento máximo tienes autorizado para la categoría del producto.
- Estrategia: Ofrece primero un descuento parcial (ej. el 5% si el máximo es 10%) para cerrar el trato conservando margen.
- Si el cliente acepta, genera la cotización ajustada.

=== REGLAS TÉCNICAS ABSOLUTAS ===
1. Si detectas una intención de cita o cotización, invoca 'gestionar_perfil' con los datos capturados y pon intención en "Cotizar" o "Agendar".
2. No generes cotizaciones formales sin tener el email en la base de datos (las herramientas te informarán si falta).
3. No uses etiquetas XML (ej: <function>) para llamar herramientas. Usa el formato nativo del sistema.
4. Si el usuario dice "Procesa este archivo de inventario" o similar, busca el archivo más reciente en la nube y usa 'procesar_inventario_nube'.

=== TERMINOLOGÍA Y REGLAS ESPECÍFICAS ===
- Contactos: [Config: Terminology Rol Primario]
- Responsables: [Config: Terminology Rol Secundario]
- Registro: [Config: Terminology Evento] / [Config: Terminology Evento Plural]
[Config: Reglas de Oro adicionales]

=== GUÍA DE HERRAMIENTAS ===
- GESTIÓN DE CONTACTOS: 'gestionar_perfil'.
- AGENDA: 'programar_evento'.
- ACTIVOS/STOCK: 'gestionar_activo'.
- FINANZAS: 'registrar_flujo_entrada', 'registrar_flujo_salida', 'registrar_compra_inventario'.
- CRM: 'capturar_prospecto' para nuevos leads, 'avanzar_etapa_oportunidad' y 'procesar_inventario_nube' para sincronizar catálogos.
- REPORTES: 'enviar_reporte_gerencial'.
- APRENDIZAJE: 'aprender_dato_nuevo'.

=== MEMORIA DINÁMICA (Aprendizaje previo) ===
[Inyección de datos de MEMORY.md]

=== CONOCIMIENTO DE PRODUCTO (RAG) ===
[Resultados de búsqueda semántica en la base de conocimientos]
```

---

## 4. CAPACIDADES TÉCNICAS (LAS MANOS)

### Herramientas Críticas (Tools)

#### 1. `capturar_prospecto`
**Definición JSON:**
```json
{
  "name": "capturar_prospecto",
  "description": "Registra un contacto inicial o cliente potencial interesado en un activo o servicio (Lead).",
  "parameters": {
    "type": "object",
    "properties": {
      "telefono": { "type": "string", "description": "Número de teléfono del prospecto." },
      "identificador": { "type": "string", "description": "Cédula o ID único del prospecto." },
      "nombre": { "type": "string", "description": "Nombre del prospecto." },
      "interes": { "type": "string", "description": "En qué activo, servicio o proyecto mostró interés." },
      "valor_estimado": { "type": "number", "description": "Valor proyectado del negocio (opcional)." },
      "metadata": { "type": "object", "description": "Datos extra del usuario." }
    },
    "required": ["telefono", "nombre", "interes"]
  }
}
```

#### 2. `avanzar_etapa_oportunidad`
**Definición JSON:**
```json
{
  "name": "avanzar_etapa_oportunidad",
  "description": "Avanza o actualiza la etapa de una oportunidad en el pipeline de ventas de forma explícita.",
  "parameters": {
    "type": "object",
    "properties": {
      "id_oportunidad": { "type": "integer", "description": "ID de la oportunidad." },
      "nombre_etapa": { "type": "string", "description": "Nombre de la nueva etapa." },
      "nota_progreso": { "type": "string", "description": "Nota breve describiendo por qué se avanzó el lead." }
    },
    "required": ["id_oportunidad", "nombre_etapa", "nota_progreso"]
  }
}
```

#### 3. `generar_cotizacion`
**Definición JSON:**
```json
{
  "name": "generar_cotizacion",
  "description": "Genera una cotización dinámica: calcula subtotales y totales, vacía a Sheets, y sube un resumen a Drive.",
  "parameters": {
    "type": "object",
    "properties": {
      "id_oportunidad": { "type": "integer" },
      "telefono_cliente": { "type": "string" },
      "items": { 
        "type": "array", 
        "items": { 
          "type": "object", 
          "properties": { 
            "sku": { "type": "string" }, 
            "descripcion": { "type": "string" }, 
            "cantidad": { "type": "number" }, 
            "precio_unitario": { "type": "number" } 
          } 
        } 
      }
    },
    "required": ["telefono_cliente", "items"]
  }
}
```

### Esquema de Entrada/Salida
- **Entrada:** Objeto JSON con el mensaje del usuario, historial (`logs`) y metadatos del remitente.
- **Salida Sugerida del Agente:**
```json
{
  "role": "assistant",
  "content": "¡Hola Juan! Qué gusto saludarte. He registrado tu interés en el Producto X. He generado la cotización #123 por un total de $500. Puedes verla aquí: [Link a Drive].",
  "tool_calls": [ ... ]
}
```

---

## 5. LÓGICA DE NEGOCIO Y CÓDIGO CRÍTICO

### Circuit Breaker (Resiliencia)
```typescript
if (llmCircuitBreaker.isPaused) {
  return `⚠️ SISTEMA EN MANTENIMIENTO: El motor de IA ha sido pausado automáticamente por inestabilidad...`;
}
```

### Análisis de Intención (Scoring de Lead)
Se ejecuta de forma asíncrona tras cada respuesta exitosa para calificar al lead sin bloquear la experiencia del usuario:
```typescript
const scoringPrompt = `
Analiza la siguiente interacción reciente...
Responde ÚNICAMENTE en formato JSON:
{
  "puntuacion": 10,
  "temperatura": "Fuego",
  "ai_resumen": "...",
  "siguiente_paso": "..."
}
`;
```

### Sincronización de Venta (Efecto Colateral)
Cuando el agente detecta un cierre (etapa "Ganado"), se dispara una transacción financiera automática:
```typescript
if (etapa.id === 5 || etapa.nombre.toLowerCase().includes('cierre')) {
  db.prepare("INSERT INTO transacciones (tipo, monto, descripcion) VALUES ('ingreso', ?, ?)")
    .run(monto, `Venta Consolidada: ${interes} [Cliente: ${oppInfo.nombre}]`);
    
  db.prepare("UPDATE activos SET cantidad = cantidad - 1 WHERE ...").run(...);
}
```

### Validación de Etapa (Regla de Oferta)
No se permite avanzar a la etapa de oferta sin email, forzando al agente a solicitar el dato:
```typescript
if (etapa.nombre.toLowerCase().includes('oferta') || etapa.orden >= 3) {
  if (!oppInfo.email) {
    throw new Error("REQUISITO FALTANTE: No puedes avanzar a la etapa de Oferta sin tener el correo electrónico.");
  }
}
```

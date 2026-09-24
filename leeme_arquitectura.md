# 🏛️ Arquitectura del Motor CRM ALBRA (SaaS Premium)

Este documento detalla los pilares estructurales finales que componen el funcionamiento interno, de backend a frontend, del CRM Albra, garantizando seguridad, eficiencia técnica y cero tiempos de recarga en el uso local/nube.

---

## ⚡ 1. Sincronización en Tiempo Real (WebSockets Socket.io)

El CRM ya no funciona a base de pantallas o tableros estáticos convencionales. Hemos introducido **WebSockets bidireccionales** (`Socket.io`) entre el flujo comercial y la administración de la empresa.

- **Puente Transversal:** El servidor Node.js central mantiene viva una conexión de bus de eventos (event bus) ligada al puerto `3000`. Tanto `crm.html` (Pipeline Ventas) como `agente_general.html` (Admin Core) están suscritos de forma silenciosa.
- **Evento (`pipeline_update`)**: Cuando se crea un nuevo lead (vía Bot, Telegram o Modal Manual), se guarda un registro en `memory.db` y el servidor emite globalmente la orden de despertar a los interfaces para volver a hidratar la data. Al ser una actualización nativa de JavaScript, esto se efectúa sin destellos de recarga en la pantalla de los clientes.
- **Evento (`sale_consolidated`)**: Al momento en el que el dueño (Tú) arrastra un Lead hacia la etapa **CIERRE** (Etapa #5), la herramienta `manejo_crm` restaura el inventario de la base de datos de activos, inyecta saldo financiero nuevo, y emite un `sale_consolidated`. Esto inyecta en tiempo real el nuevo monto total en el dashboard de administrador general. Es un puente de vida perfecto.

---

## 🤖 2. Motor Worker de Seguimiento IA Proactivo

Uno de los motores vitales implementados es el sistema escaner asíncrono para tus seguimientos denominado en los scripts como **Worker**. 

- **Estrategia (Tiempos)**: El worker escanea silenciosamente cada varios minutos tu base de datos y evalúa si una oportunidad de venta no ha sido tocada por ti ni por los usuarios en **48 Horas**. Si se cumple esta lógica y la oportunidad no está "ganada" o "perdida", la IA decide inyectar vida a tus finanzas de manera automatizada.
- **Decisión de IA (Semántica de Temperatura)**: Basado en la lectura previa del Agente (Fuego 🔥 vs Tibio ☀️ vs Frío ❄️), emite un mensaje totalmente único y contextual, intentando revigorizar un cierre urgente, resolver dudas estancadas, o archivar/ignorar un cliente sin sentido, protegiéndote de invertir tiempo sin retorno.
- **Límites de Seguridad (Barreras AI)**: Si el cliente sigue ignorando los mensajes del Agent Core, el Worker se asegura de parar obligatoriamente tras **3 seguimientos máximos de alerta**. A la tercera falta de contacto, el archivo marca automáticamente al Lead para ser desechado o ignorado para que no cause "Ruido Operativo", protegiéndote contra spam de WhatsApp/Telegram.

---

## 🛣️ 3. Rutas Api Activas e Integradas

Hemos limpiado el código basura (`crm_pro.html`, `dashboard_premium.html` repetitivos, etc.) y hemos solidificado el núcleo a una estructura muy concreta:

### 💠 Endpoints para la Plataforma Frontend
- **`/crm`**: Sirve estáticamente `src/ui/crm.html`. Es el lienzo en blanco, con barra del Pipeline (Drag and drop) con estética Azul Noche Premium.
- **`/admin`**: Sirve estáticamente `src/ui/agente_general.html`. El tablero de finanzas, IA Settings, reportes en vivo y panel de inventario y configuración de sistema.

### 🔌 Endpoints de Consumo de Datos CRM
1. **`GET /api/crm/oportunidades`**
   Extrae crudos sin cierre/perdidos todos los leads de la Pipeline juntados con sus Perfiles en SQL join, y sus métricas cruzadas.
2. **`GET /api/crm/stats`**
   Endpoint que alimenta a la cabecera *"Business Intelligence"* de 3 Columnas. Extrae la métrica del Performance en total del equipo o negocio.
3. **`POST /api/crm/capturar`**
   Endpoint único que digiere un perfil estructurado desde el *Modal de Interfaz Gráfico* de captura manual (Incluyendo la Tª 🔥 fuego capturada por el humano).
4. **`POST /api/crm/actualizar-etapa`**
   Se activa silenciosamente cada que sueltes la tarjeta de un cliente (Drag & Drop) sobre otro casillero de avance.
5. **`GET /api/chat-logs/:perfil_id`**
   El encargado de hidratar los mensajes pasados históricos del panel Lateral Transparente en el CRM (La radiografía de tus clientes en WhatsApp/Telegram).

Todo este ecosistema ahora se funde mediante TypeScript uniendo de manera armoniosa la solidez del motor Backend y resolviendo elegantemente vía Tailwind y Javascript asíncrono todo el Front-End para una eficiencia visual y comercial de un proyecto *Categoría Enterprise*.

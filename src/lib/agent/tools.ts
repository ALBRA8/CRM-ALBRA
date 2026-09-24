export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required: string[];
    };
  };
}

export const TOOL_CAPTURAR_PROSPECTO: ToolDefinition = {
  type: 'function',
  function: {
    name: 'capturar_prospecto',
    description:
      'Registra un nuevo prospecto/cliente en el CRM. Úsala cuando tengas nombre, teléfono y razón de contacto del prospecto. Crea automáticamente una oportunidad en etapa Prospección.',
    parameters: {
      type: 'object',
      properties: {
        nombre: {
          type: 'string',
          description: 'Nombre completo del prospecto',
        },
        telefono: {
          type: 'string',
          description: 'Número de teléfono del prospecto',
        },
        email: {
          type: 'string',
          description: 'Correo electrónico del prospecto (opcional pero necesario para avanzar a Oferta)',
        },
        interes: {
          type: 'string',
          description: 'En qué mostró interés el prospecto o razón de contacto',
        },
        notas: {
          type: 'string',
          description: 'Notas adicionales sobre el contacto inicial',
        },
      },
      required: ['nombre', 'telefono', 'interes'],
    },
  },
};

export const TOOL_AVANZAR_ETAPA: ToolDefinition = {
  type: 'function',
  function: {
    name: 'avanzar_etapa_oportunidad',
    description:
      'Avanza una oportunidad a la siguiente etapa del pipeline. REQUIERE email del cliente para avanzar a la etapa Oferta. Valida que la oportunidad exista antes de avanzar.',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: {
          type: 'string',
          description: 'ID de la oportunidad a avanzar',
        },
        nuevaEtapa: {
          type: 'string',
          description: 'Nombre de la nueva etapa del pipeline',
          enum: ['Prospección', 'Calificación', 'Oferta', 'Seguimiento', 'Cierre Ganado', 'Cierre Perdido'],
        },
        notas: {
          type: 'string',
          description: 'Notas sobre el motivo del avance o detalles relevantes',
        },
      },
      required: ['opportunityId', 'nuevaEtapa'],
    },
  },
};

export const TOOL_GENERAR_COTIZACION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generar_cotizacion',
    description:
      'Genera una cotización formal para un cliente. Calcula subtotales, impuestos y totales automáticamente. Genera un número de cotización único.',
    parameters: {
      type: 'object',
      properties: {
        clientId: {
          type: 'string',
          description: 'ID del cliente para la cotización',
        },
        items: {
          type: 'string',
          description:
            'JSON array de items: [{"descripcion": "string", "cantidad": number, "precioUnitario": number}]',
        },
        descuento: {
          type: 'number',
          description: 'Porcentaje de descuento a aplicar (máximo 10%)',
        },
        notas: {
          type: 'string',
          description: 'Notas o condiciones de la cotización',
        },
      },
      required: ['clientId', 'items'],
    },
  },
};

export const TOOL_TRANSFERIR_HUMANO: ToolDefinition = {
  type: 'function',
  function: {
    name: 'transferir_humano',
    description:
      'Transfiere la conversación a un agente humano. Úsalo cuando: el cliente lo pide explícitamente, la situación requiere juicio humano (disputas, casos complejos), no puedes resolver la consulta después de 2 intentos, o hay una queja formal.',
    parameters: {
      type: 'object',
      properties: {
        razon: {
          type: 'string',
          description: 'Razón de la transferencia',
        },
        urgencia: {
          type: 'string',
          description: 'Nivel de urgencia',
          enum: ['baja', 'media', 'alta'],
        },
        resumen: {
          type: 'string',
          description: 'Resumen breve de la conversación para el agente humano',
        },
      },
      required: ['razon'],
    },
  },
};

export const TOOL_PROGRAMAR_SEGUIMIENTO: ToolDefinition = {
  type: 'function',
  function: {
    name: 'programar_seguimiento',
    description:
      'Programa un mensaje de seguimiento automático para un cliente por WhatsApp. Úsalo para mantener el momentum en el pipeline, hacer follow-up después de cotizaciones, o reactivar clientes inactivos.',
    parameters: {
      type: 'object',
      properties: {
        clientId: {
          type: 'string',
          description: 'ID del cliente',
        },
        mensaje: {
          type: 'string',
          description: 'Mensaje de seguimiento a enviar',
        },
        horasDespues: {
          type: 'number',
          description: 'Horas hasta el seguimiento (mínimo 2, máximo 168)',
        },
        motivo: {
          type: 'string',
          description: 'Motivo del seguimiento',
        },
      },
      required: ['clientId', 'mensaje', 'horasDespues'],
    },
  },
};

export const TOOL_GESTIONAR_PERFIL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gestionar_perfil',
    description:
      'Crea o actualiza el perfil de un cliente en el CRM. Úsala para registrar datos del cliente durante la conversación (nombre, email, empresa, notas). Si el cliente ya existe, actualiza sus datos.',
    parameters: {
      type: 'object',
      properties: {
        telefono: {
          type: 'string',
          description: 'Número de teléfono del contacto',
        },
        nombre: {
          type: 'string',
          description: 'Nombre del contacto',
        },
        email: {
          type: 'string',
          description: 'Correo electrónico del contacto',
        },
        empresa: {
          type: 'string',
          description: 'Empresa u organización del contacto',
        },
        notas: {
          type: 'string',
          description: 'Notas adicionales sobre el contacto',
        },
      },
      required: [],
    },
  },
};

export const TOOL_PROGRAMAR_EVENTO: ToolDefinition = {
  type: 'function',
  function: {
    name: 'programar_evento',
      description:
      'Agenda una cita, reunión o evento en el calendario del CRM. Úsala cuando el cliente quiera agendar una cita, reunión o consulta.',
    parameters: {
      type: 'object',
      properties: {
        titulo: {
          type: 'string',
          description: 'Título del evento',
        },
        clienteId: {
          type: 'string',
          description: 'ID del cliente asociado al evento (opcional)',
        },
        fecha: {
          type: 'string',
          description: 'Fecha y hora del evento en formato YYYY-MM-DDTHH:mm',
        },
        duracion: {
          type: 'number',
          description: 'Duración en minutos (por defecto 60)',
        },
        tipo: {
          type: 'string',
          description: 'Tipo de evento',
          enum: ['meeting', 'call', 'consultation', 'follow_up'],
        },
        notas: {
          type: 'string',
          description: 'Notas sobre el evento',
        },
      },
      required: ['titulo', 'fecha'],
    },
  },
};

export const TOOL_GESTIONAR_ACTIVO: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gestionar_activo',
    description:
      'Consulta o actualiza productos/servicios del inventario. Úsala para consultar disponibilidad, precios o stock, y para actualizar datos de productos.',
    parameters: {
      type: 'object',
      properties: {
        accion: {
          type: 'string',
          description: 'Acción a realizar',
          enum: ['consultar', 'actualizar'],
        },
        nombre: {
          type: 'string',
          description: 'Nombre del producto/servicio (para actualizar)',
        },
        categoria: {
          type: 'string',
          description: 'Categoría para filtrar (opcional)',
        },
        precio: {
          type: 'number',
          description: 'Nuevo precio (para actualizar)',
        },
        stock: {
          type: 'number',
          description: 'Nuevo stock (para actualizar)',
        },
      },
      required: ['accion'],
    },
  },
};

export const TOOL_REGISTRAR_FLUJO_ENTRADA: ToolDefinition = {
  type: 'function',
  function: {
    name: 'registrar_flujo_entrada',
    description:
      'Registra un ingreso de dinero en las finanzas del CRM. Úsala cuando se concrete una venta, se reciba un pago o cualquier entrada de capital.',
    parameters: {
      type: 'object',
      properties: {
        monto: {
          type: 'number',
          description: 'Monto del ingreso',
        },
        categoria: {
          type: 'string',
          description: 'Categoría del ingreso (ej: venta, servicio, suscripción)',
        },
        descripcion: {
          type: 'string',
          description: 'Descripción detallada del ingreso',
        },
        referenciaId: {
          type: 'string',
          description: 'ID de referencia (ej: oportunidad, cotización)',
        },
      },
      required: ['monto', 'categoria'],
    },
  },
};

export const TOOL_REGISTRAR_FLUJO_SALIDA: ToolDefinition = {
  type: 'function',
  function: {
    name: 'registrar_flujo_salida',
    description:
      'Registra un egreso o gasto en las finanzas del CRM. Úsala para registrar compras, gastos operativos, pagos a proveedores, etc.',
    parameters: {
      type: 'object',
      properties: {
        monto: {
          type: 'number',
          description: 'Monto del egreso',
        },
        categoria: {
          type: 'string',
          description: 'Categoría del egreso (ej: compra, operativo, proveedor)',
        },
        descripcion: {
          type: 'string',
          description: 'Descripción detallada del egreso',
        },
        referenciaId: {
          type: 'string',
          description: 'ID de referencia',
        },
      },
      required: ['monto', 'categoria'],
    },
  },
};

export const TOOL_APRENDER_DATO: ToolDefinition = {
  type: 'function',
  function: {
    name: 'aprender_dato_nuevo',
    description:
      'Aprende y guarda un dato nuevo en la memoria del sistema. Úsalo cuando descubras información importante que deberá recordarse en futuras conversaciones (preferencias del cliente, políticas internas, datos de productos, etc.).',
    parameters: {
      type: 'object',
      properties: {
        categoria: {
          type: 'string',
          description: 'Categoría del dato (ej: preferencia, politica, producto, horario)',
        },
        clave: {
          type: 'string',
          description: 'Clave o identificador del dato',
        },
        valor: {
          type: 'string',
          description: 'Valor del dato a recordar',
        },
      },
      required: ['categoria', 'clave', 'valor'],
    },
  },
};

export const ALL_TOOLS: ToolDefinition[] = [
  TOOL_CAPTURAR_PROSPECTO,
  TOOL_AVANZAR_ETAPA,
  TOOL_GENERAR_COTIZACION,
  TOOL_TRANSFERIR_HUMANO,
  TOOL_PROGRAMAR_SEGUIMIENTO,
  TOOL_GESTIONAR_PERFIL,
  TOOL_PROGRAMAR_EVENTO,
  TOOL_GESTIONAR_ACTIVO,
  TOOL_REGISTRAR_FLUJO_ENTRADA,
  TOOL_REGISTRAR_FLUJO_SALIDA,
  TOOL_APRENDER_DATO,
];

export function getToolsMap(): Record<string, ToolDefinition> {
  return {
    capturar_prospecto: TOOL_CAPTURAR_PROSPECTO,
    avanzar_etapa_oportunidad: TOOL_AVANZAR_ETAPA,
    generar_cotizacion: TOOL_GENERAR_COTIZACION,
    transferir_humano: TOOL_TRANSFERIR_HUMANO,
    programar_seguimiento: TOOL_PROGRAMAR_SEGUIMIENTO,
    gestionar_perfil: TOOL_GESTIONAR_PERFIL,
    programar_evento: TOOL_PROGRAMAR_EVENTO,
    gestionar_activo: TOOL_GESTIONAR_ACTIVO,
    registrar_flujo_entrada: TOOL_REGISTRAR_FLUJO_ENTRADA,
    registrar_flujo_salida: TOOL_REGISTRAR_FLUJO_SALIDA,
    aprender_dato_nuevo: TOOL_APRENDER_DATO,
  };
}

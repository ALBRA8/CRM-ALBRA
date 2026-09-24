import { db } from '@/lib/db';
import { getNichoConfig } from './config';
import { logActivity, createNotification } from '@/lib/activity-logger';

interface CapturarProspectoArgs {
  nombre: string;
  telefono: string;
  email?: string;
  interes: string;
  notas?: string;
}

interface AvanzarEtapaArgs {
  opportunityId: string;
  nuevaEtapa: string;
  notas?: string;
}

interface CotizacionItem {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
}

interface GenerarCotizacionArgs {
  clientId: string;
  items: string; // JSON string of CotizacionItem[]
  descuento?: number;
  notas?: string;
}

export async function handleCapturarProspecto(
  userId: string,
  args: CapturarProspectoArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  const config = getNichoConfig();

  // Check if client already exists by phone for this user
  let client = await db.client.findFirst({
    where: {
      userId,
      phone: args.telefono,
      isActive: true,
    },
  });

  if (client) {
    // Update existing client with new info
    client = await db.client.update({
      where: { id: client.id },
      data: {
        name: args.nombre,
        email: args.email ?? client.email,
        lastContactAt: new Date(),
        temperature: 'Tibio',
        notes: args.notas ? `${client.notes ?? ''}\n${args.notas}`.trim() : client.notes,
      },
    });
  } else {
    // Create new client
    client = await db.client.create({
      data: {
        userId,
        name: args.nombre,
        phone: args.telefono,
        email: args.email,
        source: 'whatsapp',
        temperature: 'Tibio',
        score: 10,
        lastContactAt: new Date(),
        notes: args.notas,
      },
    });
  }

  // Find or create Prospección stage
  let stage = await db.pipelineStage.findFirst({
    where: { userId, name: 'Prospección' },
  });

  if (!stage) {
    // Create default stages if they don't exist
    const defaultStages = [
      { name: 'Prospección', order: 1, color: '#6b7280' },
      { name: 'Calificación', order: 2, color: '#3b82f6' },
      { name: 'Oferta', order: 3, color: '#f59e0b' },
      { name: 'Seguimiento', order: 4, color: '#8b5cf6' },
      { name: 'Cierre Ganado', order: 5, color: '#10b981' },
    ];
    for (const s of defaultStages) {
      const created = await db.pipelineStage.create({
        data: { userId, name: s.name, order: s.order, color: s.color },
      });
      if (s.name === 'Prospección') stage = created;
    }
  }

  // Create opportunity in Prospección
  const opportunity = await db.opportunity.create({
    data: {
      userId,
      clientId: client.id,
      stageId: stage!.id,
      title: `Oportunidad - ${args.nombre}`,
      interest: args.interes,
      estimatedValue: 0,
      probability: 20,
      notes: args.notas,
      nextAction: 'Contactar y conocer necesidades',
      nextActionDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
    },
  });

  // Create progress note
  await db.progressNote.create({
    data: {
      opportunityId: opportunity.id,
      stageName: 'Prospección',
      note: `Prospecto capturado: ${args.nombre}. Interés: ${args.interes}.${args.notas ? ` Notas: ${args.notas}` : ''}`,
    },
  });

  // Create chat log
  await db.chatLog.create({
    data: {
      userId,
      clientId: client.id,
      role: 'tool',
      content: `Prospecto capturado exitosamente`,
      toolName: 'capturar_prospecto',
      toolArgs: JSON.stringify(args),
      toolResult: JSON.stringify({ clientId: client.id, opportunityId: opportunity.id }),
    },
  });

  // Log activity
  await logActivity({ userId, action: 'created', entity: 'client', entityId: client.id, description: `Prospecto capturado: ${args.nombre}` });
  await logActivity({ userId, action: 'created', entity: 'opportunity', entityId: opportunity.id, description: `Oportunidad creada para ${args.nombre} en Prospección` });

  // Create notification
  await createNotification({ userId, type: 'lead', title: 'Nuevo prospecto', message: `Prospecto ${args.nombre} capturado con interés en ${args.interes}`, link: `clients:${client.id}` });

  return {
    success: true,
    message: `✅ ${config.terminology.rol_primario} ${args.nombre} registrado exitosamente. Oportunidad creada en Prospección (ID: ${opportunity.id}). Próximo paso: Contactar y conocer sus necesidades en detalle.`,
    data: {
      clientId: client.id,
      opportunityId: opportunity.id,
      stage: 'Prospección',
    },
  };
}

export async function handleAvanzarEtapa(
  userId: string,
  args: AvanzarEtapaArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  const config = getNichoConfig();

  // Find the opportunity
  const opportunity = await db.opportunity.findFirst({
    where: { id: args.opportunityId, userId },
    include: { client: true, stage: true },
  });

  if (!opportunity) {
    return {
      success: false,
      message: `❌ No se encontró la oportunidad con ID ${args.opportunityId}. Verifica que el ID sea correcto.`,
    };
  }

  // If advancing to Oferta, require email
  if (args.nuevaEtapa === 'Oferta' && !opportunity.client.email) {
    return {
      success: false,
      message: `❌ No se puede avanzar a Oferta sin email del ${config.terminology.rol_primario.toLowerCase()}. Por favor, solicita el correo electrónico antes de avanzar.`,
    };
  }

  // Find the target stage
  const targetStage = await db.pipelineStage.findFirst({
    where: { userId, name: args.nuevaEtapa },
  });

  if (!targetStage) {
    return {
      success: false,
      message: `❌ Etapa "${args.nuevaEtapa}" no encontrada en el pipeline. Etapas disponibles: Prospección, Calificación, Oferta, Seguimiento, Cierre Ganado, Cierre Perdido.`,
    };
  }

  // Update opportunity
  const updateData: Record<string, unknown> = {
    stageId: targetStage.id,
  };

  // Adjust probability based on stage
  const probabilityMap: Record<string, number> = {
    Prospección: 20,
    Calificación: 40,
    Oferta: 60,
    Seguimiento: 75,
    'Cierre Ganado': 100,
    'Cierre Perdido': 0,
  };
  updateData.probability = probabilityMap[args.nuevaEtapa] ?? opportunity.probability;

  if (args.nuevaEtapa === 'Cierre Ganado' || args.nuevaEtapa === 'Cierre Perdido') {
    updateData.closedAt = new Date();
  }

  if (args.notas) {
    updateData.notes = opportunity.notes
      ? `${opportunity.notes}\n${args.notas}`
      : args.notas;
  }

  await db.opportunity.update({
    where: { id: opportunity.id },
    data: updateData,
  });

  // Create progress note
  await db.progressNote.create({
    data: {
      opportunityId: opportunity.id,
      stageName: args.nuevaEtapa,
      note: `Avanzó de "${opportunity.stage.name}" a "${args.nuevaEtapa}".${args.notas ? ` Motivo: ${args.notas}` : ''}`,
    },
  });

  // If Cierre Ganado, create transaction
  if (args.nuevaEtapa === 'Cierre Ganado') {
    const value = opportunity.estimatedValue || 0;
    if (value > 0) {
      await db.transaction.create({
        data: {
          userId,
          type: 'ingreso',
          amount: value,
          category: 'venta',
          description: `Cierre de oportunidad: ${opportunity.title}`,
          referenceId: opportunity.id,
          date: new Date(),
        },
      });
    }
  }

  // Create chat log
  await db.chatLog.create({
    data: {
      userId,
      clientId: opportunity.clientId,
      role: 'tool',
      content: `Oportunidad avanzada a ${args.nuevaEtapa}`,
      toolName: 'avanzar_etapa_oportunidad',
      toolArgs: JSON.stringify(args),
      toolResult: JSON.stringify({
        opportunityId: opportunity.id,
        fromStage: opportunity.stage.name,
        toStage: args.nuevaEtapa,
      }),
    },
  });

  // Log activity
  await logActivity({ userId, action: 'stage_changed', entity: 'opportunity', entityId: opportunity.id, description: `Oportunidad "${opportunity.title}" avanzada de "${opportunity.stage.name}" a "${args.nuevaEtapa}"`, metadata: { fromStage: opportunity.stage.name, toStage: args.nuevaEtapa } });

  // Create notification
  await createNotification({ userId, type: 'opportunity', title: 'Oportunidad avanzada', message: `"${opportunity.title}" avanzó a ${args.nuevaEtapa}`, link: `clients:${opportunity.clientId}` });

  // Update client temperature based on stage
  const temperatureMap: Record<string, string> = {
    Prospección: 'Tibio',
    Calificación: 'Caliente',
    Oferta: 'Caliente',
    Seguimiento: 'Fuego',
    'Cierre Ganado': 'Fuego',
    'Cierre Perdido': 'Frio',
  };
  await db.client.update({
    where: { id: opportunity.clientId },
    data: {
      temperature: temperatureMap[args.nuevaEtapa] ?? opportunity.client.temperature,
      lastContactAt: new Date(),
    },
  });

  return {
    success: true,
    message: `✅ Oportunidad "${opportunity.title}" avanzada de "${opportunity.stage.name}" a "${args.nuevaEtapa}" exitosamente.${args.nuevaEtapa === 'Cierre Ganado' ? ' 🎉 ¡Felicidades por el cierre!' : ''}${args.nuevaEtapa === 'Cierre Perdido' ? ' Se registró como cierre perdido para análisis.' : ''}`,
    data: {
      opportunityId: opportunity.id,
      fromStage: opportunity.stage.name,
      toStage: args.nuevaEtapa,
    },
  };
}

export async function handleGenerarCotizacion(
  userId: string,
  args: GenerarCotizacionArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  const config = getNichoConfig();

  // Find client
  const client = await db.client.findFirst({
    where: { id: args.clientId, userId },
  });

  if (!client) {
    return {
      success: false,
      message: `❌ No se encontró el ${config.terminology.rol_primario.toLowerCase()} con ID ${args.clientId}.`,
    };
  }

  // Parse items
  let items: CotizacionItem[];
  try {
    items = JSON.parse(args.items) as CotizacionItem[];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Items must be a non-empty array');
    }
  } catch {
    return {
      success: false,
      message: '❌ Formato de items inválido. Debe ser un JSON array: [{"descripcion": "...", "cantidad": 1, "precioUnitario": 100}]',
    };
  }

  // Validate discount
  const descuento = args.descuento ?? 0;
  if (descuento > config.negociacion.descuento_maximo) {
    return {
      success: false,
      message: `❌ El descuento solicitado (${descuento}%) excede el máximo permitido (${config.negociacion.descuento_maximo}%). ${config.negociacion.estrategia}.`,
    };
  }

  // Calculate totals
  const subtotal = items.reduce(
    (sum, item) => sum + item.cantidad * item.precioUnitario,
    0
  );
  const discountAmount = subtotal * (descuento / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxRate = 0.16; // 16% IVA
  const taxAmount = afterDiscount * taxRate;
  const total = afterDiscount + taxAmount;

  // Generate quote number
  const year = new Date().getFullYear();
  const quoteCount = await db.quote.count({
    where: { userId, quoteNumber: { startsWith: `COT-${year}-` } },
  });
  const quoteNumber = `COT-${year}-${String(quoteCount + 1).padStart(3, '0')}`;

  // Create quote
  const quote = await db.quote.create({
    data: {
      userId,
      clientId: client.id,
      quoteNumber,
      status: 'draft',
      subtotal,
      discount: discountAmount,
      tax: taxAmount,
      total,
      notes: args.notas,
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });

  // Create quote items
  for (const item of items) {
    const itemSubtotal = item.cantidad * item.precioUnitario;
    await db.quoteItem.create({
      data: {
        quoteId: quote.id,
        description: item.descripcion,
        quantity: item.cantidad,
        unitPrice: item.precioUnitario,
        subtotal: itemSubtotal,
      },
    });
  }

  // Create chat log
  await db.chatLog.create({
    data: {
      userId,
      clientId: client.id,
      role: 'tool',
      content: `Cotización ${quoteNumber} generada`,
      toolName: 'generar_cotizacion',
      toolArgs: JSON.stringify(args),
      toolResult: JSON.stringify({
        quoteId: quote.id,
        quoteNumber,
        subtotal,
        discount: discountAmount,
        tax: taxAmount,
        total,
      }),
    },
  });

  // Log activity
  await logActivity({ userId, action: 'created', entity: 'quote', entityId: quote.id, description: `Cotización ${quoteNumber} generada para ${client.name} por $${total.toFixed(2)}` });

  // Create notification
  await createNotification({ userId, type: 'alert', title: 'Cotización generada', message: `Cotización ${quoteNumber} por $${total.toFixed(2)} para ${client.name}`, link: `clients:${client.id}` });

  const itemsSummary = items
    .map((i) => `  - ${i.descripcion}: ${i.cantidad} x $${i.precioUnitario.toFixed(2)} = $${(i.cantidad * i.precioUnitario).toFixed(2)}`)
    .join('\n');

  return {
    success: true,
    message: `✅ Cotización ${quoteNumber} generada exitosamente para ${client.name}.

📋 Resumen:
${itemsSummary}

💰 Subtotal: $${subtotal.toFixed(2)}
🏷️ Descuento (${descuento}%): -$${discountAmount.toFixed(2)}
🧾 IVA (16%): $${taxAmount.toFixed(2)}
💵 Total: $${total.toFixed(2)}

Válida hasta: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('es-ES')}`,
    data: {
      quoteId: quote.id,
      quoteNumber,
      subtotal,
      discount: discountAmount,
      tax: taxAmount,
      total,
    },
  };
}

interface TransferirHumanoArgs {
  razon: string;
  urgencia?: string;
  resumen?: string;
}

interface ProgramarSeguimientoArgs {
  clientId: string;
  mensaje: string;
  horasDespues: number;
  motivo?: string;
}

export async function handleTransferirHumano(
  userId: string,
  args: TransferirHumanoArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  try {
    // Find the active WhatsApp conversation for this user/client
    // We look for the most recent active conversation
    const conversation = await db.whatsAppConversation.findFirst({
      where: {
        userId,
        status: 'active',
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    if (conversation) {
      await db.whatsAppConversation.update({
        where: { id: conversation.id },
        data: {
          status: 'transferred',
          transferredTo: 'Agente humano',
          isAutoReply: false,
          unreadCount: { increment: 1 },
        },
      });
    }

    // Log the transfer
    await db.chatLog.create({
      data: {
        userId,
        clientId: conversation?.clientId || null,
        role: 'tool',
        content: `Conversación transferida a agente humano`,
        toolName: 'transferir_humano',
        toolArgs: JSON.stringify(args),
        toolResult: JSON.stringify({
          conversationId: conversation?.id,
          razon: args.razon,
          urgencia: args.urgencia || 'media',
        }),
      },
    });

    return {
      success: true,
      message: `✅ Conversación transferida a un agente humano. Razón: ${args.razon}. Urgencia: ${args.urgencia || 'media'}. El cliente será notificado.`,
      data: {
        conversationId: conversation?.id,
        status: 'transferred',
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    return {
      success: false,
      message: `❌ Error al transferir conversación: ${errorMsg}`,
    };
  }
}

export async function handleProgramarSeguimiento(
  userId: string,
  args: ProgramarSeguimientoArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  try {
    // Validate hours range
    const horas = Math.min(168, Math.max(2, args.horasDespues));
    const scheduledDate = new Date(Date.now() + horas * 60 * 60 * 1000);

    // Find or create the client
    const client = await db.client.findFirst({
      where: { id: args.clientId, userId },
    });

    if (!client) {
      return {
        success: false,
        message: `❌ No se encontró el cliente con ID ${args.clientId}.`,
      };
    }

    // Create an automation for the follow-up
    const automation = await db.automation.create({
      data: {
        userId,
        name: `Seguimiento - ${client.name}`,
        type: 'follow_up',
        trigger: 'scheduled',
        conditions: JSON.stringify({
          scheduledAt: scheduledDate.toISOString(),
          clientId: args.clientId,
        }),
        actions: JSON.stringify({
          channel: 'whatsapp',
          message: args.mensaje,
          phone: client.phone,
        }),
        message: args.mensaje,
        isActive: true,
      },
    });

    // Create chat log
    await db.chatLog.create({
      data: {
        userId,
        clientId: args.clientId,
        role: 'tool',
        content: `Seguimiento programado para ${client.name}`,
        toolName: 'programar_seguimiento',
        toolArgs: JSON.stringify(args),
        toolResult: JSON.stringify({
          automationId: automation.id,
          scheduledAt: scheduledDate.toISOString(),
        }),
      },
    });

    const fechaStr = scheduledDate.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      success: true,
      message: `✅ Seguimiento programado para ${client.name} el ${fechaStr}. Mensaje: "${args.mensaje}"${args.motivo ? `. Motivo: ${args.motivo}` : ''}`,
      data: {
        automationId: automation.id,
        scheduledAt: scheduledDate.toISOString(),
        clientId: args.clientId,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    return {
      success: false,
      message: `❌ Error al programar seguimiento: ${errorMsg}`,
    };
  }
}

// ============ gestionar_perfil ============
interface GestionarPerfilArgs {
  telefono?: string;
  nombre?: string;
  email?: string;
  empresa?: string;
  notas?: string;
}

export async function handleGestionarPerfil(
  userId: string,
  args: GestionarPerfilArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  try {
    // Find client by phone or by most recent
    let client = null;
    if (args.telefono) {
      client = await db.client.findFirst({
        where: { userId, phone: args.telefono, isActive: true },
      });
    }
    if (!client) {
      client = await db.client.findFirst({
        where: { userId, isActive: true },
        orderBy: { lastContactAt: 'desc' },
      });
    }

    if (!client) {
      // Create new client if we have minimum data
      if (!args.nombre && !args.telefono) {
        return {
          success: false,
          message: '❌ No hay datos suficientes para crear o actualizar un perfil. Necesito al menos nombre o teléfono.',
        };
      }
      client = await db.client.create({
        data: {
          userId,
          name: args.nombre || 'Sin nombre',
          phone: args.telefono || '',
          email: args.email,
          company: args.empresa,
          source: 'whatsapp',
          temperature: 'Tibio',
          score: 10,
          lastContactAt: new Date(),
          notes: args.notas,
        },
      });
      return {
        success: true,
        message: `✅ Nuevo perfil creado para ${client.name}. Teléfono: ${client.phone || 'no registrado'}. Email: ${client.email || 'pendiente'}.`,
        data: { clientId: client.id, action: 'created' },
      };
    }

    // Update existing client
    const updateData: Record<string, unknown> = {};
    if (args.nombre) updateData.name = args.nombre;
    if (args.email) updateData.email = args.email;
    if (args.empresa) updateData.company = args.empresa;
    if (args.notas) updateData.notes = client.notes ? `${client.notes}\n${args.notas}` : args.notas;
    updateData.lastContactAt = new Date();

    if (Object.keys(updateData).length > 0) {
      await db.client.update({
        where: { id: client.id },
        data: updateData,
      });
    }

    return {
      success: true,
      message: `✅ Perfil de ${client.name} actualizado. Teléfono: ${client.phone || 'no registrado'}. Email: ${args.email || client.email || 'pendiente'}. Empresa: ${args.empresa || client.company || 'no registrada'}.`,
      data: { clientId: client.id, action: 'updated' },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    return { success: false, message: `❌ Error al gestionar perfil: ${errorMsg}` };
  }
}

// ============ programar_evento ============
interface ProgramarEventoArgs {
  titulo: string;
  clienteId?: string;
  fecha: string;
  duracion?: number;
  tipo?: string;
  notas?: string;
}

export async function handleProgramarEvento(
  userId: string,
  args: ProgramarEventoArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  try {
    const config = getNichoConfig();
    const fecha = new Date(args.fecha);
    if (isNaN(fecha.getTime())) {
      return { success: false, message: '❌ Fecha inválida. Usa formato YYYY-MM-DD o YYYY-MM-DDTHH:mm.' };
    }

    const duracion = args.duracion || 60;

    // Use the Reservation model which has: date, duration, serviceType, title, description, status
    const event = await db.reservation.create({
      data: {
        userId,
        clientId: args.clienteId || null,
        title: args.titulo,
        description: args.notas || null,
        date: fecha,
        duration: duracion,
        serviceType: args.tipo || 'meeting',
        status: 'confirmed',
      },
    });

    const fechaStr = fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

    return {
      success: true,
      message: `✅ ${config.terminology.evento} "${args.titulo}" agendada para el ${fechaStr}. Duración: ${duracion} min.${args.notas ? ` Notas: ${args.notas}` : ''}`,
      data: { eventId: event.id, date: fecha.toISOString(), duration: duracion },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    return { success: false, message: `❌ Error al agendar: ${errorMsg}` };
  }
}

// ============ gestionar_activo ============
interface GestionarActivoArgs {
  accion: 'consultar' | 'actualizar';
  nombre?: string;
  categoria?: string;
  precio?: number;
  stock?: number;
}

export async function handleGestionarActivo(
  userId: string,
  args: GestionarActivoArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  try {
    if (args.accion === 'consultar') {
      const where: Record<string, unknown> = { userId };
      if (args.categoria) where.category = args.categoria;

      const services = await db.service.findMany({
        where,
        take: 10,
        orderBy: { name: 'asc' },
      });

      if (services.length === 0) {
        return { success: true, message: 'No se encontraron productos/servicios registrados.' };
      }

      const listado = services.map(s => `- ${s.name}: $${s.price}${s.stock !== null && s.stock !== undefined ? ` (Stock: ${s.stock})` : ''}`).join('\n');
      return {
        success: true,
        message: `📋 Productos/Servicios disponibles:\n${listado}`,
        data: { count: services.length },
      };
    }

    if (args.accion === 'actualizar' && args.nombre) {
      const service = await db.service.findFirst({
        where: { userId, name: { contains: args.nombre } },
      });

      if (!service) {
        return { success: false, message: `❌ No se encontró el producto/servicio "${args.nombre}".` };
      }

      const updateData: Record<string, unknown> = {};
      if (args.precio !== undefined) updateData.price = args.precio;
      if (args.stock !== undefined) updateData.stock = args.stock;

      await db.service.update({ where: { id: service.id }, data: updateData });

      const stockDisplay = args.stock !== undefined ? args.stock : (service.stock ?? 'N/A');
      return {
        success: true,
        message: `✅ "${service.name}" actualizado. Precio: $${args.precio ?? service.price}. Stock: ${stockDisplay}.`,
        data: { serviceId: service.id },
      };
    }

    return { success: false, message: '❌ Acción no reconocida. Usa "consultar" o "actualizar".' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    return { success: false, message: `❌ Error al gestionar activo: ${errorMsg}` };
  }
}

// ============ registrar_flujo ============
interface RegistrarFlujoArgs {
  tipo: 'ingreso' | 'salida';
  monto: number;
  categoria: string;
  descripcion?: string;
  referenciaId?: string;
}

export async function handleRegistrarFlujo(
  userId: string,
  args: RegistrarFlujoArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  try {
    if (!args.monto || args.monto <= 0) {
      return { success: false, message: '❌ El monto debe ser mayor a 0.' };
    }

    const transaction = await db.transaction.create({
      data: {
        userId,
        type: args.tipo,
        amount: args.monto,
        category: args.categoria,
        description: args.descripcion || `${args.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}: ${args.categoria}`,
        referenceId: args.referenciaId || null,
        date: new Date(),
      },
    });

    const emoji = args.tipo === 'ingreso' ? '💰' : '💸';
    return {
      success: true,
      message: `✅ ${emoji} ${args.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado: $${args.monto.toFixed(2)} - ${args.categoria}.${args.descripcion ? ` ${args.descripcion}` : ''}`,
      data: { transactionId: transaction.id, type: args.tipo, amount: args.monto },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    return { success: false, message: `❌ Error al registrar flujo: ${errorMsg}` };
  }
}

// ============ aprender_dato_nuevo ============
interface AprenderDatoArgs {
  categoria: string;
  clave: string;
  valor: string;
}

export async function handleAprenderDato(
  userId: string,
  args: AprenderDatoArgs
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  try {
    await db.memory.upsert({
      where: {
        userId_category_key: {
          userId,
          category: args.categoria,
          key: args.clave,
        },
      },
      create: {
        userId,
        category: args.categoria,
        key: args.clave,
        value: args.valor,
        source: 'agent',
      },
      update: {
        value: args.valor,
        source: 'agent',
      },
    });

    return {
      success: true,
      message: `✅ Dato aprendido y guardado. [${args.categoria}] ${args.clave}: ${args.valor}`,
      data: { category: args.categoria, key: args.clave },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    return { success: false, message: `❌ Error al aprender dato: ${errorMsg}` };
  }
}

// ============ Handler Registry ============
export function getHandlerForTool(toolName: string) {
  const handlers: Record<string, (userId: string, args: Record<string, unknown>) => Promise<{ success: boolean; message: string; data?: Record<string, unknown> }>> = {
    capturar_prospecto: handleCapturarProspecto as unknown as typeof handlers[string],
    avanzar_etapa_oportunidad: handleAvanzarEtapa as unknown as typeof handlers[string],
    generar_cotizacion: handleGenerarCotizacion as unknown as typeof handlers[string],
    transferir_humano: handleTransferirHumano as unknown as typeof handlers[string],
    programar_seguimiento: handleProgramarSeguimiento as unknown as typeof handlers[string],
    gestionar_perfil: handleGestionarPerfil as unknown as typeof handlers[string],
    programar_evento: handleProgramarEvento as unknown as typeof handlers[string],
    gestionar_activo: handleGestionarActivo as unknown as typeof handlers[string],
    registrar_flujo_entrada: handleRegistrarFlujo as unknown as typeof handlers[string],
    registrar_flujo_salida: handleRegistrarFlujo as unknown as typeof handlers[string],
    aprender_dato_nuevo: handleAprenderDato as unknown as typeof handlers[string],
  };
  return handlers[toolName] ?? null;
}

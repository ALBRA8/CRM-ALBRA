import { db } from '@/lib/db';
import { buildSystemPrompt } from './prompt';
import { ALL_TOOLS, getToolsMap } from './tools';
import { getHandlerForTool } from './handlers';
import { getIdentityForStage } from './identities';
import { getLlmConfigForAgent } from '@/lib/runtime-config';

// ============ Circuit Breaker ============
class CircuitBreaker {
  private failures = 0;
  private maxFailures: number;
  private resetWindowMs: number;
  private lastFailureTime: number | null = null;
  public isPaused = false;

  constructor(maxFailures = 3, resetWindowMs = 300000) {
    this.maxFailures = maxFailures;
    this.resetWindowMs = resetWindowMs;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.maxFailures) {
      this.isPaused = true;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.isPaused = false;
    this.lastFailureTime = null;
  }

  check(): boolean {
    if (!this.isPaused) return true;

    // Check if reset window has passed
    if (this.lastFailureTime && Date.now() - this.lastFailureTime > this.resetWindowMs) {
      this.failures = 0;
      this.isPaused = false;
      this.lastFailureTime = null;
      return true;
    }

    return false;
  }
}

const circuitBreaker = new CircuitBreaker();

// ============ LLM Configuration ============
interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  useCustom: boolean;
}

function getLlmConfig(): LlmConfig {
  try {
    const runtimeConfig = getLlmConfigForAgent();
    return {
      apiKey: runtimeConfig.apiKey,
      baseUrl: runtimeConfig.baseUrl,
      model: runtimeConfig.model,
      useCustom: !!runtimeConfig.apiKey,
    };
  } catch {
    return {
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      useCustom: false,
    };
  }
}

// ============ LLM Call Abstraction ============
async function callLlm(
  messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }>,
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
): Promise<{ content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }> {
  const config = getLlmConfig();

  if (config.useCustom) {
    // Use custom API (OpenAI-compatible)
    return callCustomLlm(config, messages, tools);
  } else {
    // Use z-ai-web-dev-sdk as fallback
    return callZaiSdk(messages, tools);
  }
}

async function callCustomLlm(
  config: LlmConfig,
  messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }>,
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
): Promise<{ content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
    })),
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: t.function,
    }));
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const choice = data.choices?.[0];
  if (!choice?.message) {
    throw new Error('No response from custom LLM');
  }

  return {
    content: choice.message.content,
    tool_calls: choice.message.tool_calls,
  };
}

async function callZaiSdk(
  messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }>,
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
): Promise<{ content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }> {
  // Dynamic import of z-ai-web-dev-sdk
  const sdkModule = await import('z-ai-web-dev-sdk');
  const ZAI = sdkModule.default;
  const zai = await ZAI.create();

  const sdkMessages = messages.map(m => ({
    role: m.role as 'system' | 'user' | 'assistant' | 'tool',
    content: m.content,
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    ...(m.name ? { name: m.name } : {}),
  }));

  const createOptions: Record<string, unknown> = {
    messages: sdkMessages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  };

  if (tools && tools.length > 0) {
    createOptions.tools = tools.map(t => ({ type: t.type as 'function', function: t.function }));
  }

  const completion = await zai.chat.completions.create(createOptions);

  const choice = completion.choices?.[0];
  if (!choice?.message) {
    throw new Error('No response from Z-AI SDK');
  }

  return {
    content: choice.message.content ?? null,
    tool_calls: (choice.message as Record<string, unknown>).tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined,
  };
}

// ============ Types ============
interface AgentResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: { success: boolean; message: string; data?: Record<string, unknown> };
  }>;
  suggestions?: string[];
}

// ============ Main Agent Function ============
export async function processAgentMessage(
  userId: string,
  message: string,
  clientId?: string | null,
  conversationHistory?: Array<{ role: string; content: string }>
): Promise<AgentResponse> {
  // Check circuit breaker
  if (!circuitBreaker.check()) {
    return {
      content: 'El servicio está temporalmente no disponible. Por favor, intenta de nuevo en unos minutos.',
      suggestions: ['Intentar más tarde', 'Contactar soporte'],
    };
  }

  try {
    // Get client info if provided
    let clientInfo = null;
    let stageName: string | undefined;

    if (clientId) {
      const client = await db.client.findFirst({
        where: { id: clientId, userId },
        include: {
          opportunities: {
            include: { stage: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (client) {
        clientInfo = {
          name: client.name,
          phone: client.phone,
          email: client.email,
          temperature: client.temperature,
          lastContactAt: client.lastContactAt,
        };

        if (client.opportunities.length > 0) {
          stageName = client.opportunities[0].stage.name;
        }
      }
    }

    // Get identity for stage
    const identity = stageName ? getIdentityForStage(stageName) : null;

    // Get memory data
    const memories = await db.memory.findMany({
      where: { userId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    const memoryData = memories.map((m) => ({
      category: m.category,
      key: m.key,
      value: m.value,
    }));

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      stageName,
      clientContext: clientInfo,
      memoryData,
    });

    // Build messages array
    const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // Build tools for API
    const toolsForApi = ALL_TOOLS.map((t) => ({
      type: t.type as 'function',
      function: t.function,
    }));

    // Call LLM (abstracted - uses custom API or Z-AI SDK)
    const llmResponse = await callLlm(messages, toolsForApi);

    if (!llmResponse.content && !llmResponse.tool_calls) {
      throw new Error('No response from LLM');
    }

    // Check for tool calls
    const toolCalls: AgentResponse['toolCalls'] = [];
    let finalContent = llmResponse.content ?? '';
    let needsReCall = false;

    if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
      needsReCall = true;

      // Process each tool call
      for (const toolCall of llmResponse.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgsStr = toolCall.function.arguments;

        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(toolArgsStr);
        } catch {
          parsedArgs = {};
        }

        // Get handler
        const handler = getHandlerForTool(toolName);
        if (!handler) {
          toolCalls.push({
            name: toolName,
            args: parsedArgs,
            result: {
              success: false,
              message: `Herramienta "${toolName}" no encontrada.`,
            },
          });
          continue;
        }

        // Execute handler
        try {
          const result = await handler(userId, parsedArgs);
          toolCalls.push({
            name: toolName,
            args: parsedArgs,
            result,
          });

          // Add tool result to messages for re-injection
          messages.push({
            role: 'assistant',
            content: JSON.stringify(llmResponse.tool_calls),
          } as unknown as typeof messages[number]);

          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            name: toolName,
          } as unknown as typeof messages[number]);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
          toolCalls.push({
            name: toolName,
            args: parsedArgs,
            result: {
              success: false,
              message: `Error ejecutando ${toolName}: ${errorMsg}`,
            },
          });

          messages.push({
            role: 'tool',
            content: JSON.stringify({ success: false, message: errorMsg }),
            tool_call_id: toolCall.id,
            name: toolName,
          } as unknown as typeof messages[number]);
        }
      }

      // Re-call LLM with tool results for final response
      if (needsReCall) {
        try {
          const secondResponse = await callLlm(messages, toolsForApi);
          if (secondResponse.content) {
            finalContent = secondResponse.content;
          }
        } catch {
          // If re-call fails, use tool results as content
          finalContent = toolCalls
            .map((tc) => tc.result.message)
            .join('\n\n');
        }
      }
    }

    // Save chat log
    await db.chatLog.create({
      data: {
        userId,
        clientId: clientId ?? null,
        role: 'user',
        content: message,
      },
    });

    await db.chatLog.create({
      data: {
        userId,
        clientId: clientId ?? null,
        role: 'assistant',
        content: finalContent,
        toolName: toolCalls.length > 0 ? toolCalls.map((tc) => tc.name).join(',') : null,
        toolArgs: toolCalls.length > 0 ? JSON.stringify(toolCalls.map((tc) => tc.args)) : null,
        toolResult: toolCalls.length > 0 ? JSON.stringify(toolCalls.map((tc) => tc.result)) : null,
      },
    });

    // Run async scoring analysis (fire and forget)
    runAsyncScoring(userId, clientId, message).catch(() => {
      // Silently ignore scoring errors
    });

    // Generate suggestions based on context
    const suggestions = generateSuggestions(stageName, identity, toolCalls);

    circuitBreaker.recordSuccess();

    return {
      content: finalContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      suggestions,
    };
  } catch (error) {
    circuitBreaker.recordFailure();
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';

    return {
      content: `Lo siento, hubo un error procesando tu mensaje. Por favor intenta de nuevo. (${errorMsg})`,
      suggestions: ['Reintentar', 'Configurar API Key', 'Contactar soporte'],
    };
  }
}

// ============ Async Scoring ============
async function runAsyncScoring(
  userId: string,
  clientId?: string | null,
  message?: string
): Promise<void> {
  try {
    if (!clientId) return;

    const client = await db.client.findFirst({
      where: { id: clientId, userId },
      include: {
        opportunities: {
          include: { stage: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!client) return;

    const currentStage = client.opportunities[0]?.stage.name ?? 'Prospección';

    const scoringPrompt = `Analiza esta interacción con un cliente CRM y asigna scores. Responde SOLO en JSON:
{
  "leadScore": number (0-100),
  "temperature": "Frio" | "Tibio" | "Caliente" | "Fuego",
  "intent": string (breve descripción de la intención detectada),
  "sentiment": "positivo" | "neutral" | "negativo",
  "nextAction": string (recomendación de próxima acción)
}

Cliente: ${client.name}
Etapa actual: ${currentStage}
Temperatura actual: ${client.temperature}
Score actual: ${client.score}
Último mensaje del cliente: ${message ?? 'N/A'}`;

    const scoringResponse = await callLlm([
      { role: 'system', content: 'Eres un analista de CRM experto. Responde solo en JSON válido.' },
      { role: 'user', content: scoringPrompt },
    ]);

    const responseText = scoringResponse.content;
    if (!responseText) return;

    // Parse and apply scoring
    const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const scoring = JSON.parse(cleanedResponse) as {
      leadScore: number;
      temperature: string;
      intent: string;
      sentiment: string;
      nextAction: string;
    };

    await db.client.update({
      where: { id: clientId },
      data: {
        score: Math.min(100, Math.max(0, scoring.leadScore)),
        temperature: scoring.temperature,
      },
    });

    // Store scoring as memory
    await db.memory.upsert({
      where: {
        userId_category_key: {
          userId,
          category: 'scoring',
          key: `client_${clientId}`,
        },
      },
      create: {
        userId,
        category: 'scoring',
        key: `client_${clientId}`,
        value: JSON.stringify(scoring),
        source: 'agent',
      },
      update: {
        value: JSON.stringify(scoring),
        source: 'agent',
      },
    });
  } catch {
    // Scoring is non-critical, ignore errors
  }
}

// ============ Suggestions Generator ============
function generateSuggestions(
  stageName?: string,
  identity?: { name: string; focus: string } | null,
  toolCalls?: AgentResponse['toolCalls']
): string[] {
  const suggestions: string[] = [];

  if (toolCalls && toolCalls.length > 0) {
    // After tool usage, suggest relevant follow-ups
    for (const tc of toolCalls) {
      if (tc.name === 'capturar_prospecto') {
        suggestions.push('Agendar primera cita');
        suggestions.push('Enviar información de servicios');
        suggestions.push('Calificar al prospecto');
      } else if (tc.name === 'avanzar_etapa_oportunidad') {
        suggestions.push('Ver detalle de la oportunidad');
        suggestions.push('Generar cotización');
        suggestions.push('Agendar seguimiento');
      } else if (tc.name === 'generar_cotizacion') {
        suggestions.push('Enviar cotización por email');
        suggestions.push('Programar seguimiento en 48h');
        suggestions.push('Ver otras oportunidades');
      }
    }
  } else {
    // Context-based suggestions
    switch (stageName) {
      case 'Prospección':
        suggestions.push('¿Cuéntame sobre tus necesidades?');
        suggestions.push('¿Qué servicios te interesan?');
        suggestions.push('Agendar una cita');
        break;
      case 'Calificación':
        suggestions.push('Validar presupuesto');
        suggestions.push('Presentar casos de éxito');
        suggestions.push('Agendar reunión de diagnóstico');
        break;
      case 'Oferta':
        suggestions.push('Generar cotización');
        suggestions.push('Presentar paquetes');
        suggestions.push('Manejar objeciones');
        break;
      case 'Seguimiento':
        suggestions.push('Seguimiento de cotización');
        suggestions.push('Ofrecer alternativa');
        suggestions.push('Negociar condiciones');
        break;
      case 'Cierre':
        suggestions.push('Confirmar detalles del servicio');
        suggestions.push('Solicitar referidos');
        suggestions.push('Programar seguimiento post-venta');
        break;
      default:
        suggestions.push('¿En qué puedo ayudarte?');
        suggestions.push('Ver mis oportunidades');
        suggestions.push('Agendar una cita');
    }
  }

  return suggestions.slice(0, 3);
}

export { CircuitBreaker };

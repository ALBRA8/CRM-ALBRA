import { NextRequest, NextResponse } from 'next/server';
import { checkPermission } from '@/lib/permissions';
import { getRuntimeConfig, setRuntimeConfig, clearApiKey } from '@/lib/runtime-config';

// GET /api/settings - Obtener configuración actual
export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'settings', 'read');
  if (perm instanceof NextResponse) return perm;

  try {
    const config = getRuntimeConfig();
    const llmApiKey = config.llm.apiKey;

    // Determine provider name
    let provider = 'SDK Z-AI (integrado)';
    if (llmApiKey) {
      if (config.llm.baseUrl.includes('groq')) {
        provider = 'Groq';
      } else if (config.llm.baseUrl.includes('together')) {
        provider = 'Together AI';
      } else {
        provider = 'OpenAI';
      }
    }

    // Check email config
    const emailConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

    return NextResponse.json({
      llm: {
        apiKeyConfigured: !!llmApiKey,
        apiKeyPreview: llmApiKey ? `${llmApiKey.slice(0, 8)}...${llmApiKey.slice(-4)}` : '',
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
      },
      email: {
        configured: emailConfigured,
        host: process.env.SMTP_HOST ? `${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}` : '',
        fromName: process.env.SMTP_FROM_NAME || 'CRM ALBRA',
      },
      app: {
        name: process.env.APP_NAME || 'CRM ALBRA',
        url: process.env.APP_URL || 'http://localhost:3000',
      },
      system: {
        usingZaiSdk: !llmApiKey,
        provider,
        chatEnabled: true,
      },
    });
  } catch (error) {
    console.error('Settings GET error:', error);
    return NextResponse.json(
      { error: 'Error al leer configuración' },
      { status: 500 }
    );
  }
}

// PUT /api/settings - Actualizar configuración
export async function PUT(request: NextRequest) {
  const perm = await checkPermission(request, 'settings', 'update');
  if (perm instanceof NextResponse) return perm;

  try {
    const body = await request.json();
    const { llm } = body;

    if (llm) {
      setRuntimeConfig({
        apiKey: llm.apiKey !== undefined ? llm.apiKey : undefined,
        baseUrl: llm.baseUrl !== undefined ? llm.baseUrl : undefined,
        model: llm.model !== undefined ? llm.model : undefined,
      });

      try {
        const fs = await import('fs');
        const path = await import('path');
        const envPath = path.join(process.cwd(), '.env');
        let envContent = '';

        try {
          envContent = fs.readFileSync(envPath, 'utf-8');
        } catch {
          envContent = `DATABASE_URL=file:${path.join(process.cwd(), 'db/custom.db')}
NEXTAUTH_SECRET="crm-albra-secret-key-2024-production"
NEXTAUTH_URL="http://localhost:3000"
`;
        }

        if (llm.apiKey !== undefined) {
          if (envContent.match(/^LLM_API_KEY=.*$/m)) {
            envContent = envContent.replace(/^LLM_API_KEY=.*$/m, `LLM_API_KEY=${llm.apiKey}`);
          } else {
            envContent += `\nLLM_API_KEY=${llm.apiKey}`;
          }
        }

        if (llm.baseUrl !== undefined) {
          if (envContent.match(/^LLM_BASE_URL=.*$/m)) {
            envContent = envContent.replace(/^LLM_BASE_URL=.*$/m, `LLM_BASE_URL=${llm.baseUrl}`);
          } else {
            envContent += `\nLLM_BASE_URL=${llm.baseUrl}`;
          }
        }

        if (llm.model !== undefined) {
          if (envContent.match(/^LLM_MODEL=.*$/m)) {
            envContent = envContent.replace(/^LLM_MODEL=.*$/m, `LLM_MODEL=${llm.model}`);
          } else {
            envContent += `\nLLM_MODEL=${llm.model}`;
          }
        }

        fs.writeFileSync(envPath, envContent, 'utf-8');
      } catch (fileErr) {
        console.warn('Could not persist settings to .env file (non-critical):', fileErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Configuración guardada. Los cambios tienen efecto inmediato.',
    });
  } catch (error) {
    console.error('Settings PUT error:', error);
    return NextResponse.json(
      { error: 'Error al guardar configuración' },
      { status: 500 }
    );
  }
}

// DELETE /api/settings - Limpiar API key
export async function DELETE(request: NextRequest) {
  const perm = await checkPermission(request, 'settings', 'update');
  if (perm instanceof NextResponse) return perm;

  try {
    clearApiKey();

    try {
      const fs = await import('fs');
      const path = await import('path');
      const envPath = path.join(process.cwd(), '.env');
      let envContent = fs.readFileSync(envPath, 'utf-8');
      envContent = envContent.replace(/^LLM_API_KEY=.*$/m, 'LLM_API_KEY=');
      fs.writeFileSync(envPath, envContent, 'utf-8');
    } catch {
      // File update is non-critical
    }

    return NextResponse.json({
      success: true,
      message: 'API Key eliminada. Se usará el SDK integrado.',
    });
  } catch (error) {
    console.error('Settings DELETE error:', error);
    return NextResponse.json(
      { error: 'Error al eliminar API key' },
      { status: 500 }
    );
  }
}

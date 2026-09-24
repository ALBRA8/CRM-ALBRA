import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAuthUser } from '@/lib/api-auth';

const NICHO_PATH = path.join(process.cwd(), 'nicho.json');

export async function GET() {
  try {
    const raw = fs.readFileSync(NICHO_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'No se pudo leer nicho.json' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.branding_name || !body.rubro || !body.personality) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios: branding_name, rubro, personality' },
        { status: 400 }
      );
    }

    // Build clean object with defaults
    const nicho = {
      branding_name: String(body.branding_name).trim(),
      rubro: String(body.rubro).trim(),
      personality: String(body.personality).trim(),
      terminology: {
        rol_primario: String(body.terminology?.rol_primario || 'Cliente').trim(),
        rol_secundario: String(body.terminology?.rol_secundario || 'Asesor').trim(),
        evento: String(body.terminology?.evento || 'Cita').trim(),
        evento_plural: String(body.terminology?.evento_plural || 'Citas').trim(),
      },
      reglas_oro: Array.isArray(body.reglas_oro)
        ? body.reglas_oro.map((r: string) => String(r).trim()).filter(Boolean)
        : [],
      negociacion: {
        descuento_maximo: Number(body.negociacion?.descuento_maximo) || 0,
        estrategia: String(body.negociacion?.estrategia || '').trim(),
      },
    };

    fs.writeFileSync(NICHO_PATH, JSON.stringify(nicho, null, 2), 'utf-8');

    return NextResponse.json({ success: true, data: nicho });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

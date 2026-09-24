import fs from 'fs';
import path from 'path';

export interface NichoConfig {
  branding_name: string;
  rubro: string;
  personality: string;
  terminology: {
    rol_primario: string;
    rol_secundario: string;
    evento: string;
    evento_plural: string;
  };
  reglas_oro: string[];
  negociacion: {
    descuento_maximo: number;
    estrategia: string;
  };
}

let cachedConfig: NichoConfig | null = null;

export function loadNichoConfig(): NichoConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = path.join(process.cwd(), 'nicho.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  cachedConfig = JSON.parse(raw) as NichoConfig;
  return cachedConfig;
}

export function getNichoConfig(): NichoConfig {
  return loadNichoConfig();
}

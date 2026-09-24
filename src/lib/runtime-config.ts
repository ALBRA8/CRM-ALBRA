import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============ Runtime Configuration ============
// Uses a JSON file on disk to persist settings across Next.js worker processes.
// process.env is not shared between workers in Next.js dev/production mode,
// so we use a file-based config for runtime settings.

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface RuntimeConfig {
  llm: LlmConfig;
  updatedAt: string;
}

const CONFIG_PATH = join(process.cwd(), 'runtime-config.json');

function getDefaultConfig(): RuntimeConfig {
  return {
    llm: {
      apiKey: process.env.LLM_API_KEY ?? '',
      baseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
    },
    updatedAt: new Date().toISOString(),
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw) as RuntimeConfig;
      return config;
    }
  } catch {
    // Fall through to default
  }
  return getDefaultConfig();
}

export function setRuntimeConfig(updates: Partial<LlmConfig>): RuntimeConfig {
  const current = getRuntimeConfig();

  if (updates.apiKey !== undefined) {
    current.llm.apiKey = updates.apiKey;
  }
  if (updates.baseUrl !== undefined) {
    current.llm.baseUrl = updates.baseUrl;
  }
  if (updates.model !== undefined) {
    current.llm.model = updates.model;
  }

  current.updatedAt = new Date().toISOString();

  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not persist runtime config to file:', err);
  }

  return current;
}

export function clearApiKey(): RuntimeConfig {
  return setRuntimeConfig({ apiKey: '' });
}

export function getLlmConfigForAgent(): LlmConfig {
  const config = getRuntimeConfig();
  return config.llm;
}

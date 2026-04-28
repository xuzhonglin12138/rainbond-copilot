import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

function mapLegacyEnvAliases(env: NodeJS.ProcessEnv): void {
  if (!env.ANTHROPIC_API_KEY && env.ANTHROPIC_AUTH_TOKEN) {
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_AUTH_TOKEN;
  }

  if (!env.OPENAI_API_KEY && env.VITE_OPENAI_API_KEY) {
    env.OPENAI_API_KEY = env.VITE_OPENAI_API_KEY;
  }

  if (!env.OPENAI_BASE_URL && env.VITE_OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = env.VITE_OPENAI_BASE_URL;
  }

  if (!env.OPENAI_MODEL && env.VITE_OPENAI_MODEL) {
    env.OPENAI_MODEL = env.VITE_OPENAI_MODEL;
  }
}

export function loadServerEnv(cwd: string = process.cwd()): void {
  const envFiles = [".env", ".env.local"];

  for (const name of envFiles) {
    const path = join(cwd, name);
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
    }
  }

  mapLegacyEnvAliases(process.env);
}

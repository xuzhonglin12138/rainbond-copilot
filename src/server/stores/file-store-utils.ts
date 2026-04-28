import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export function resolveStoreFile(dataDir: string, name: string): string {
  return join(dataDir, `${name}.json`);
}

export async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return [];
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse JSON store ${filePath}: ${error.message}`);
    }

    throw error;
  }
}

export async function writeJsonArray<T>(
  filePath: string,
  records: T[]
): Promise<void> {
  await ensureParentDir(filePath);
  const tempFilePath = `${filePath}.tmp`;
  const payload = JSON.stringify(records, null, 2);
  await writeFile(tempFilePath, payload, "utf-8");
  await rename(tempFilePath, filePath);
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
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

    throw error;
  }
}

export async function writeJsonArray<T>(
  filePath: string,
  records: T[]
): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, JSON.stringify(records, null, 2), "utf-8");
}

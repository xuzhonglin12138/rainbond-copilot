import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
async function ensureParentDir(filePath) {
    await mkdir(dirname(filePath), { recursive: true });
}
export function resolveStoreFile(dataDir, name) {
    return join(dataDir, `${name}.json`);
}
export async function readJsonArray(filePath) {
    try {
        const content = await readFile(filePath, "utf-8");
        if (!content.trim()) {
            return [];
        }
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return [];
        }
        if (error instanceof SyntaxError) {
            throw new Error(`Failed to parse JSON store ${filePath}: ${error.message}`);
        }
        throw error;
    }
}
export async function writeJsonArray(filePath, records) {
    await ensureParentDir(filePath);
    const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2, 10)}.tmp`;
    const payload = JSON.stringify(records, null, 2);
    await writeFile(tempFilePath, payload, "utf-8");
    await rename(tempFilePath, filePath);
}

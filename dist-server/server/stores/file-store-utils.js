import { mkdir, readFile, writeFile } from "node:fs/promises";
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
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
export async function writeJsonArray(filePath, records) {
    await ensureParentDir(filePath);
    await writeFile(filePath, JSON.stringify(records, null, 2), "utf-8");
}

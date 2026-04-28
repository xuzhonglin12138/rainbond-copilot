import fs from "node:fs/promises";
import path from "node:path";

const root = new URL(".", import.meta.url);
const distDir = new URL("./dist/", root);
const srcFile = new URL("./src/index.html", root);
const destFile = new URL("./dist/index.html", root);

await fs.mkdir(distDir, { recursive: true });
const html = await fs.readFile(srcFile, "utf8");
await fs.writeFile(destFile, html, "utf8");

console.log(`Built ${path.basename(destFile.pathname)}`);

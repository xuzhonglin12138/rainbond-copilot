// Use Vite's import.meta.glob to load knowledge files at build time
const knowledgeFiles = import.meta.glob<string>('./*.md', {
  query: '?raw',
  import: 'default',
  eager: true
});

export async function loadKnowledge(filename: string): Promise<string> {
  try {
    const content = knowledgeFiles[`./${filename}`];
    return content || "";
  } catch (error) {
    console.warn(`Failed to load knowledge file: ${filename}`, error);
    return "";
  }
}

export async function loadAllKnowledge(): Promise<string> {
  const files = [
    "core-concepts.md",
    "troubleshooting.md",
  ];

  const contents = await Promise.all(files.map((f) => loadKnowledge(f)));
  return contents.filter((c) => c).join("\n\n---\n\n");
}

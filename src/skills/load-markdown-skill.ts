import type { PromptSkill } from "./types";

// Use Vite's import.meta.glob to load markdown files at build time
const skillFiles = import.meta.glob<string>('./**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
});

export async function loadMarkdownSkill(skillDir: string): Promise<PromptSkill> {
  // Find the SKILL.md file for this directory
  const skillPath = `./${skillDir}/SKILL.md`;
  const content = skillFiles[skillPath];

  if (!content) {
    throw new Error(`Skill not found: ${skillPath}`);
  }

  const idMatch = skillDir.match(/([^/]+)$/);
  const id = idMatch ? idMatch[1] : "unknown";

  const nameMatch = content.match(/^#\s+(.+)$/m);
  const name = nameMatch ? nameMatch[1] : id;

  const descMatch = content.match(/^>\s+(.+)$/m);
  const description = descMatch ? descMatch[1] : "";

  return {
    id,
    name,
    kind: "prompt",
    description,
    content,
  };
}

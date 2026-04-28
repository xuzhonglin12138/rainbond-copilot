import path from "node:path";
import { loadAllSkillsFromFs } from "../workflows/skill-loader.js";
import type { CompiledSkill } from "../workflows/compiled-types.js";

export interface SkillCapabilityKnowledge {
  useWhen: string;
  avoidWhen: string;
  preferredTools: string[];
  scopeHint: string;
  vocabulary?: string[];
}

export interface SkillDisplayMetadata {
  id: string;
  title: string;
  summary: string;
  stages: Array<{
    id: string;
    label: string;
  }>;
}

interface RegistryState {
  skills: CompiledSkill[];
  byId: Map<string, CompiledSkill>;
  rootDir: string;
}

let state: RegistryState | null = null;
let pendingInit: Promise<void> | null = null;

export function resolveDefaultSkillsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.RAINBOND_SKILLS_DIR && env.RAINBOND_SKILLS_DIR.trim()) {
    return env.RAINBOND_SKILLS_DIR.trim();
  }
  return path.resolve(process.cwd(), "skills-src", "rainbond");
}

export async function initializeSkillRegistry(opts?: {
  rootDir?: string;
  reload?: boolean;
}): Promise<void> {
  if (state && !opts?.reload) {
    return;
  }
  if (pendingInit && !opts?.reload) {
    return pendingInit;
  }

  const rootDir = opts?.rootDir || resolveDefaultSkillsRoot();
  pendingInit = loadAllSkillsFromFs(rootDir).then((skills) => {
    const sorted = [...skills].sort((a, b) => a.id.localeCompare(b.id));
    state = {
      skills: sorted,
      byId: new Map(sorted.map((skill) => [skill.id, skill])),
      rootDir,
    };
  });

  try {
    await pendingInit;
  } finally {
    pendingInit = null;
  }
}

function ensureInitialized(): RegistryState {
  if (!state) {
    throw new Error(
      "Skill registry has not been initialized. Call initializeSkillRegistry() before accessing skills."
    );
  }
  return state;
}

export function getRegisteredSkills(): CompiledSkill[] {
  return ensureInitialized().skills;
}

export function getRegisteredSkill(skillId: string): CompiledSkill | null {
  return ensureInitialized().byId.get(skillId) || null;
}

export function isSkillRegistryInitialized(): boolean {
  return state !== null;
}

export function getSkillNarrativeBody(skillId: string): string {
  const skill = getRegisteredSkill(skillId);
  return skill?.narrativeBody || "";
}

export function getSkillDisplayMetadata(): SkillDisplayMetadata[] {
  return getRegisteredSkills().map(deriveDisplayMetadata);
}

export function getSkillDisplayMetadataById(
  skillId: string
): SkillDisplayMetadata | null {
  const skill = getRegisteredSkill(skillId);
  return skill ? deriveDisplayMetadata(skill) : null;
}

export function getSkillCapabilityKnowledgeMap(): Record<
  string,
  SkillCapabilityKnowledge
> {
  return Object.fromEntries(
    getRegisteredSkills().map((skill) => [
      skill.id,
      deriveCapabilityKnowledge(skill),
    ])
  );
}

export function getSkillCapabilityKnowledge(
  skillId: string
): SkillCapabilityKnowledge | undefined {
  const skill = getRegisteredSkill(skillId);
  return skill ? deriveCapabilityKnowledge(skill) : undefined;
}

function deriveDisplayMetadata(skill: CompiledSkill): SkillDisplayMetadata {
  return {
    id: skill.id,
    title: skill.name,
    summary: skill.description,
    stages: skill.workflow.stages.map((stage) => ({
      id: stage.id,
      label: stage.kind,
    })),
  };
}

function deriveCapabilityKnowledge(skill: CompiledSkill): SkillCapabilityKnowledge {
  const intents = skill.workflow.entry?.intents || [];
  const preferredTools = readPreferredTools(skill.toolPolicy);
  const requiredContext = skill.workflow.required_context || [];

  return {
    useWhen:
      intents.length > 0 ? intents.join(" / ") : skill.description,
    avoidWhen: "Not provided in the machine-readable contract yet.",
    preferredTools,
    scopeHint:
      requiredContext.length > 0
        ? `Requires context: ${requiredContext.join(", ")}`
        : "Prefer existing session context.",
    vocabulary: [],
  };
}

function readPreferredTools(
  toolPolicy: Record<string, unknown> | undefined
): string[] {
  if (!toolPolicy) {
    return [];
  }
  const value = toolPolicy.preferred_tools;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

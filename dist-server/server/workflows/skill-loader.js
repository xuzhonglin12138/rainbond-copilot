import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { glob } from "glob";
import MarkdownIt from "markdown-it";
import YAML from "yaml";
import { z } from "zod";
const MACHINE_BLOCK_KINDS = new Set([
    "workflow",
    "tool_policy",
    "output_contract",
]);
const markdownParser = new MarkdownIt();
const skillFrontmatterSchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    mode: z.enum(["embedded", "workspace"]).optional(),
});
const workflowBranchSchema = z.object({
    id: z.string().min(1),
    tool: z.string().min(1),
    args: z.record(z.unknown()).optional(),
    when: z.string().min(1).optional(),
});
const workflowStageSchema = z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    tool: z.string().min(1).optional(),
    args: z.record(z.unknown()).optional(),
    branches: z.array(workflowBranchSchema).min(1).optional(),
}).superRefine((stage, ctx) => {
    if (stage.kind === "tool_call" && !stage.tool) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "tool_call stage requires a tool field",
        });
    }
    if (stage.kind === "branch" && (!stage.branches || stage.branches.length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "branch stage requires at least one branch entry",
        });
    }
});
const workflowDefinitionSchema = z.object({
    id: z.string().min(1),
    entry: z
        .object({
        intents: z.array(z.string().min(1)).min(1).optional(),
    })
        .optional(),
    input_schema: z
        .object({
        required: z.array(z.string().min(1)).optional(),
        properties: z.record(z.record(z.unknown())).optional(),
    })
        .optional(),
    required_context: z.array(z.string().min(1)).optional(),
    stages: z.array(workflowStageSchema).min(1),
});
const genericObjectBlockSchema = z.record(z.unknown());
const toolRequiredArgsMap = {
    rainbond_query_components: ["enterprise_id", "app_id"],
    rainbond_query_cloud_markets: ["enterprise_id"],
    rainbond_query_local_app_models: ["enterprise_id"],
    rainbond_query_cloud_app_models: ["enterprise_id", "market_name"],
    rainbond_query_app_model_versions: ["enterprise_id", "source", "app_model_id"],
    rainbond_get_component_pods: ["team_name", "region_name", "app_id", "service_id"],
    rainbond_get_pod_detail: [
        "team_name",
        "region_name",
        "app_id",
        "service_id",
        "pod_name",
    ],
    rainbond_get_component_summary: ["team_name", "region_name", "app_id", "service_id"],
    rainbond_get_component_logs: ["team_name", "region_name", "app_id", "service_id"],
    rainbond_get_component_build_logs: [
        "team_name",
        "region_name",
        "app_id",
        "service_id",
        "event_id",
    ],
    rainbond_get_component_events: ["team_name", "region_name", "app_id", "service_id"],
    rainbond_install_app_model: [
        "team_name",
        "region_name",
        "app_id",
        "source",
        "app_model_id",
        "app_model_version",
    ],
    rainbond_get_app_version_overview: ["team_name", "region_name", "app_id"],
    rainbond_list_app_version_snapshots: ["team_name", "region_name", "app_id"],
    rainbond_get_app_version_snapshot_detail: [
        "team_name",
        "region_name",
        "app_id",
        "version_id",
    ],
    rainbond_create_app_version_snapshot: ["team_name", "region_name", "app_id"],
    rainbond_create_app_share_record: ["team_name", "region_name", "app_id"],
    rainbond_get_app_publish_candidates: ["team_name", "region_name", "app_id"],
    rainbond_manage_component_envs: [
        "team_name",
        "region_name",
        "app_id",
        "service_id",
        "operation",
    ],
    rainbond_manage_component_connection_envs: [
        "team_name",
        "region_name",
        "app_id",
        "service_id",
        "operation",
    ],
    rainbond_manage_component_probe: [
        "team_name",
        "region_name",
        "app_id",
        "service_id",
        "operation",
    ],
    rainbond_manage_component_dependency: [
        "team_name",
        "region_name",
        "app_id",
        "service_id",
        "operation",
    ],
    rainbond_rollback_app_version_snapshot: [
        "team_name",
        "region_name",
        "app_id",
        "version_id",
    ],
};
export async function discoverSkillMarkdownFiles(rootDir) {
    const matched = await glob("*/SKILL.md", {
        cwd: rootDir,
        absolute: true,
        nodir: true,
    });
    return matched.sort();
}
export async function loadSkillFromFile(sourcePath) {
    const rawContent = await readFile(sourcePath, "utf-8");
    return compileSkillMarkdown({
        sourcePath,
        rawContent,
    });
}
export function compileSkillMarkdown(input) {
    const parsedMatter = matter(input.rawContent);
    const frontmatter = skillFrontmatterSchema.parse(parsedMatter.data);
    const blocks = extractMachineBlocks(parsedMatter.content);
    const workflowBlock = blocks.find((block) => block.kind === "workflow");
    if (!workflowBlock) {
        throw new Error(`Skill ${frontmatter.name} at ${input.sourcePath} is missing a required yaml workflow block`);
    }
    const workflow = workflowDefinitionSchema.parse(parseYamlBlock(workflowBlock.raw, "workflow", input.sourcePath));
    const toolPolicy = parseOptionalObjectBlock(blocks, "tool_policy", input.sourcePath);
    const outputContract = parseOptionalObjectBlock(blocks, "output_contract", input.sourcePath);
    const compiledSkill = {
        id: frontmatter.name,
        name: frontmatter.name,
        description: frontmatter.description,
        mode: (frontmatter.mode || "embedded"),
        sourcePath: input.sourcePath,
        workflow,
        toolPolicy,
        outputContract,
    };
    validateCompiledSkillContract(compiledSkill);
    return compiledSkill;
}
function parseOptionalObjectBlock(blocks, kind, sourcePath) {
    const block = blocks.find((candidate) => candidate.kind === kind);
    if (!block) {
        return undefined;
    }
    return genericObjectBlockSchema.parse(parseYamlBlock(block.raw, kind, sourcePath));
}
function extractMachineBlocks(markdown) {
    const tokens = markdownParser.parse(markdown, {});
    const blocks = [];
    for (const token of tokens) {
        if (token.type !== "fence") {
            continue;
        }
        const infoParts = token.info
            .trim()
            .split(/\s+/)
            .map((part) => part.trim())
            .filter(Boolean);
        if (infoParts.length < 2) {
            continue;
        }
        const [language, kind] = infoParts;
        if (!language || (language !== "yaml" && language !== "yml")) {
            continue;
        }
        if (!kind || !MACHINE_BLOCK_KINDS.has(kind)) {
            continue;
        }
        blocks.push({
            kind: kind,
            raw: token.content,
        });
    }
    return blocks;
}
function parseYamlBlock(rawBlock, blockKind, sourcePath) {
    try {
        const parsed = YAML.parse(rawBlock);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("block must parse to an object");
        }
        return parsed;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse ${blockKind} block for ${sourcePath}: ${message}`);
    }
}
function validateCompiledSkillContract(skill) {
    const declaredContext = new Set(skill.workflow.required_context || []);
    const declaredInputs = new Set([
        ...(skill.workflow.input_schema?.required || []),
        ...Object.keys(skill.workflow.input_schema?.properties || {}),
    ]);
    for (const stage of skill.workflow.stages) {
        if (stage.tool) {
            validateToolInvocation({
                skill,
                location: `stage ${stage.id}`,
                toolName: stage.tool,
                args: stage.args,
                declaredContext,
                declaredInputs,
            });
        }
        for (const branch of stage.branches || []) {
            validateToolInvocation({
                skill,
                location: `stage ${stage.id} branch ${branch.id}`,
                toolName: branch.tool,
                args: branch.args,
                declaredContext,
                declaredInputs,
            });
        }
    }
}
function validateToolInvocation(params) {
    const { skill, location, toolName, args, declaredContext, declaredInputs } = params;
    const requiredArgs = toolRequiredArgsMap[toolName] || [];
    for (const requiredArg of requiredArgs) {
        if (!args || !(requiredArg in args)) {
            throw new Error(`Skill ${skill.id} ${location} calling ${toolName} is missing required arg "${requiredArg}"`);
        }
    }
    if ((toolName === "rainbond_query_app_model_versions" ||
        toolName === "rainbond_install_app_model") &&
        sourceMayRequireCloudMarket(args?.source) &&
        (!args || !("market_name" in args))) {
        throw new Error(`Skill ${skill.id} ${location} calling ${toolName} must declare "market_name" when source may be cloud`);
    }
    validateTemplateReferences(args, skill, location, declaredContext, declaredInputs);
}
function sourceMayRequireCloudMarket(source) {
    return !(typeof source === "string" && source === "local");
}
function validateTemplateReferences(value, skill, location, declaredContext, declaredInputs) {
    if (typeof value === "string" && value.startsWith("$")) {
        if (value.startsWith("$context.")) {
            const contextKey = value.slice("$context.".length);
            if (!declaredContext.has(contextKey)) {
                throw new Error(`Skill ${skill.id} ${location} uses undeclared context placeholder ${value}`);
            }
            return;
        }
        if (value.startsWith("$input.")) {
            const inputKey = value.slice("$input.".length);
            if (!declaredInputs.has(inputKey)) {
                throw new Error(`Skill ${skill.id} ${location} uses undeclared input placeholder ${value}`);
            }
            return;
        }
        if (value.startsWith("$actor.")) {
            return;
        }
        throw new Error(`Skill ${skill.id} ${location} uses unsupported placeholder ${value}`);
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            validateTemplateReferences(item, skill, location, declaredContext, declaredInputs);
        }
        return;
    }
    if (value && typeof value === "object") {
        for (const nestedValue of Object.values(value)) {
            validateTemplateReferences(nestedValue, skill, location, declaredContext, declaredInputs);
        }
    }
}

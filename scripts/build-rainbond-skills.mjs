import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { glob } from 'glob';
import MarkdownIt from 'markdown-it';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(projectRoot, 'skills-src', 'rainbond');
const generatedRoot = path.join(projectRoot, 'src', 'generated', 'rainbond');

const markdownParser = new MarkdownIt();
const machineBlockKinds = new Set([
  'workflow',
  'tool_policy',
  'output_contract',
]);
const toolRequiredArgsMap = {
  rainbond_query_components: ['enterprise_id', 'app_id'],
  rainbond_query_cloud_markets: ['enterprise_id'],
  rainbond_query_local_app_models: ['enterprise_id'],
  rainbond_query_cloud_app_models: ['enterprise_id', 'market_name'],
  rainbond_query_app_model_versions: ['enterprise_id', 'source', 'app_model_id'],
  rainbond_get_component_pods: ['team_name', 'region_name', 'app_id', 'service_id'],
  rainbond_get_pod_detail: [
    'team_name',
    'region_name',
    'app_id',
    'service_id',
    'pod_name',
  ],
  rainbond_get_component_summary: ['team_name', 'region_name', 'app_id', 'service_id'],
  rainbond_get_component_logs: ['team_name', 'region_name', 'app_id', 'service_id'],
  rainbond_get_component_build_logs: [
    'team_name',
    'region_name',
    'app_id',
    'service_id',
    'event_id',
  ],
  rainbond_get_component_events: ['team_name', 'region_name', 'app_id', 'service_id'],
  rainbond_install_app_model: [
    'team_name',
    'region_name',
    'app_id',
    'source',
    'app_model_id',
    'app_model_version',
  ],
  rainbond_get_app_version_overview: ['team_name', 'region_name', 'app_id'],
  rainbond_list_app_version_snapshots: ['team_name', 'region_name', 'app_id'],
  rainbond_get_app_version_snapshot_detail: [
    'team_name',
    'region_name',
    'app_id',
    'version_id',
  ],
  rainbond_create_app_version_snapshot: ['team_name', 'region_name', 'app_id'],
  rainbond_create_app_share_record: ['team_name', 'region_name', 'app_id'],
  rainbond_get_app_publish_candidates: ['team_name', 'region_name', 'app_id'],
  rainbond_manage_component_envs: [
    'team_name',
    'region_name',
    'app_id',
    'service_id',
    'operation',
  ],
  rainbond_manage_component_connection_envs: [
    'team_name',
    'region_name',
    'app_id',
    'service_id',
    'operation',
  ],
  rainbond_manage_component_probe: [
    'team_name',
    'region_name',
    'app_id',
    'service_id',
    'operation',
  ],
  rainbond_manage_component_dependency: [
    'team_name',
    'region_name',
    'app_id',
    'service_id',
    'operation',
  ],
  rainbond_rollback_app_version_snapshot: [
    'team_name',
    'region_name',
    'app_id',
    'version_id',
  ],
};

async function discoverSkillMarkdownFiles(rootDir) {
  const matched = await glob('*/SKILL.md', {
    cwd: rootDir,
    absolute: true,
    nodir: true,
  });
  return matched.sort();
}

function extractMachineBlocks(markdown) {
  const tokens = markdownParser.parse(markdown, {});
  const blocks = [];

  for (const token of tokens) {
    if (token.type !== 'fence') {
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
    if (!language || (language !== 'yaml' && language !== 'yml')) {
      continue;
    }
    if (!kind || !machineBlockKinds.has(kind)) {
      continue;
    }

    blocks.push({
      kind,
      raw: token.content,
    });
  }

  return blocks;
}

function parseObjectYaml(rawBlock, blockKind, sourcePath) {
  try {
    const parsed = YAML.parse(rawBlock);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('block must parse to an object');
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse ${blockKind} block for ${sourcePath}: ${message}`,
    );
  }
}

function compileSkillMarkdown(sourcePath, rawContent) {
  const parsedMatter = matter(rawContent);
  const { name, description, mode = 'embedded' } = parsedMatter.data || {};

  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`Missing frontmatter name for ${sourcePath}`);
  }
  if (typeof description !== 'string' || !description.trim()) {
    throw new Error(`Missing frontmatter description for ${sourcePath}`);
  }

  const blocks = extractMachineBlocks(parsedMatter.content);
  const workflowBlock = blocks.find((block) => block.kind === 'workflow');

  if (!workflowBlock) {
    throw new Error(`Missing yaml workflow block for ${sourcePath}`);
  }

  const workflow = parseObjectYaml(workflowBlock.raw, 'workflow', sourcePath);
  if (
    typeof workflow.id !== 'string' ||
    !Array.isArray(workflow.stages) ||
    workflow.stages.length === 0
  ) {
    throw new Error(`Invalid workflow contract for ${sourcePath}`);
  }

  const toolPolicyBlock = blocks.find((block) => block.kind === 'tool_policy');
  const outputContractBlock = blocks.find(
    (block) => block.kind === 'output_contract',
  );

  const compiledSkill = {
    id: name,
    name,
    description,
    mode,
    sourcePath,
    workflow,
    toolPolicy: toolPolicyBlock
      ? parseObjectYaml(toolPolicyBlock.raw, 'tool_policy', sourcePath)
      : undefined,
    outputContract: outputContractBlock
      ? parseObjectYaml(
          outputContractBlock.raw,
          'output_contract',
          sourcePath,
        )
      : undefined,
  };

  validateCompiledSkillContract(compiledSkill);

  return compiledSkill;
}

function validateCompiledSkillContract(skill) {
  const workflow = skill.workflow || {};
  const declaredContext = new Set(workflow.required_context || []);
  const declaredInputs = new Set([
    ...((workflow.input_schema && workflow.input_schema.required) || []),
    ...Object.keys((workflow.input_schema && workflow.input_schema.properties) || {}),
  ]);

  for (const stage of workflow.stages || []) {
    if (stage.kind === 'tool_call' && !stage.tool) {
      throw new Error(`Skill ${skill.id} stage ${stage.id} is missing a tool field`);
    }
    if (stage.kind === 'branch' && (!Array.isArray(stage.branches) || stage.branches.length === 0)) {
      throw new Error(`Skill ${skill.id} stage ${stage.id} must declare at least one branch`);
    }

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

function validateToolInvocation({
  skill,
  location,
  toolName,
  args,
  declaredContext,
  declaredInputs,
}) {
  const requiredArgs = toolRequiredArgsMap[toolName] || [];

  for (const requiredArg of requiredArgs) {
    if (!args || !(requiredArg in args)) {
      throw new Error(
        `Skill ${skill.id} ${location} calling ${toolName} is missing required arg "${requiredArg}"`,
      );
    }
  }

  if (
    (toolName === 'rainbond_query_app_model_versions' ||
      toolName === 'rainbond_install_app_model') &&
    sourceMayRequireCloudMarket(args && args.source) &&
    (!args || !('market_name' in args))
  ) {
    throw new Error(
      `Skill ${skill.id} ${location} calling ${toolName} must declare "market_name" when source may be cloud`,
    );
  }

  validateTemplateReferences({
    value: args,
    skill,
    location,
    declaredContext,
    declaredInputs,
  });
}

function sourceMayRequireCloudMarket(source) {
  return !(typeof source === 'string' && source === 'local');
}

function validateTemplateReferences({
  value,
  skill,
  location,
  declaredContext,
  declaredInputs,
}) {
  if (typeof value === 'string' && value.startsWith('$')) {
    if (value.startsWith('$context.')) {
      const contextKey = value.slice('$context.'.length);
      if (!declaredContext.has(contextKey)) {
        throw new Error(
          `Skill ${skill.id} ${location} uses undeclared context placeholder ${value}`,
        );
      }
      return;
    }

    if (value.startsWith('$input.')) {
      const inputKey = value.slice('$input.'.length);
      if (!declaredInputs.has(inputKey)) {
        throw new Error(
          `Skill ${skill.id} ${location} uses undeclared input placeholder ${value}`,
        );
      }
      return;
    }

    if (value.startsWith('$actor.')) {
      return;
    }

    throw new Error(
      `Skill ${skill.id} ${location} uses unsupported placeholder ${value}`,
    );
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      validateTemplateReferences({
        value: item,
        skill,
        location,
        declaredContext,
        declaredInputs,
      });
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      validateTemplateReferences({
        value: nestedValue,
        skill,
        location,
        declaredContext,
        declaredInputs,
      });
    }
  }
}

async function main() {
  await mkdir(generatedRoot, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    compiled: [],
    skipped: [],
    errors: [],
  };

  const compiledSkills = [];
  const skillFiles = await discoverSkillMarkdownFiles(skillsRoot);

  for (const sourcePath of skillFiles) {
    try {
      const rawContent = await readFile(sourcePath, 'utf-8');
      const compiled = compileSkillMarkdown(sourcePath, rawContent);
      compiledSkills.push(compiled);
      report.compiled.push({
        id: compiled.id,
        sourcePath: compiled.sourcePath,
        stageCount: compiled.workflow.stages.length,
      });
    } catch (error) {
      report.errors.push({
        sourcePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const metadata = compiledSkills.map((skill) => ({
    id: skill.id,
    title: skill.name,
    summary: skill.description,
    stages: skill.workflow.stages.map((stage) => ({
      id: stage.id,
      label: stage.kind,
    })),
  }));

  const capabilityEntries = Object.fromEntries(
    compiledSkills.map((skill) => [
      skill.id,
      {
        useWhen:
          Array.isArray(skill.workflow.entry?.intents) &&
          skill.workflow.entry.intents.length > 0
            ? skill.workflow.entry.intents.join(' / ')
            : skill.description,
        avoidWhen: 'Not provided in the machine-readable contract yet.',
        preferredTools: Array.isArray(skill.toolPolicy?.preferred_tools)
          ? skill.toolPolicy.preferred_tools
          : [],
        scopeHint:
          Array.isArray(skill.workflow.required_context) &&
          skill.workflow.required_context.length > 0
            ? `Requires context: ${skill.workflow.required_context.join(', ')}`
            : 'Prefer existing session context.',
        vocabulary: [],
      },
    ]),
  );

  await writeFile(
    path.join(generatedRoot, 'compiled-skills.ts'),
    `export const compiledRainbondSkills = ${JSON.stringify(compiledSkills, null, 2)} as const;\n`,
    'utf-8',
  );
  await writeFile(
    path.join(generatedRoot, 'workflow-metadata.ts'),
    `export const generatedRainbondWorkflowMetadata = ${JSON.stringify(metadata, null, 2)} as const;\n`,
    'utf-8',
  );
  await writeFile(
    path.join(generatedRoot, 'capability-knowledge.ts'),
    `export const generatedEmbeddedWorkflowKnowledge = ${JSON.stringify(capabilityEntries, null, 2)} as const;\n`,
    'utf-8',
  );
  await writeFile(
    path.join(generatedRoot, 'compile-report.json'),
    JSON.stringify(report, null, 2),
    'utf-8',
  );

  if (report.errors.length > 0) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Compiled ${compiledSkills.length} Rainbond skill(s) into ${generatedRoot}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

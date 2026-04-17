import type { Skill, ActionSkill, PromptSkill } from "./types";

// Import all action skills directly
import * as getComponentStatus from "./actions/get-component-status/plugin";
import * as getComponentLogs from "./actions/get-component-logs/plugin";
import * as restartComponent from "./actions/restart-component/plugin";
import * as scaleComponentMemory from "./actions/scale-component-memory/plugin";

// Import prompt skills
import rainbondCoreSkill from "./prompt/rainbond-core/skill.md?raw";
import diagnoseServiceSkill from "./prompt/diagnose-service/skill.md?raw";
import deployApplicationSkill from "./prompt/deploy-application/skill.md?raw";
import performanceOptimizationSkill from "./prompt/performance-optimization/skill.md?raw";
import securityBestPracticesSkill from "./prompt/security-best-practices/skill.md?raw";
import backupAndRecoverySkill from "./prompt/backup-and-recovery/skill.md?raw";
import rainbondMcpExternalToolsSkill from "./prompt/rainbond-mcp-external-tools/skill.md?raw";
import rainbondEmbeddedAgentSkill from "./prompt/rainbond-embedded-agent/skill.md?raw";
import rainbondMcpScenarioTestingSkill from "./prompt/rainbond-mcp-scenario-testing/skill.md?raw";

// Convert plugin exports to ActionSkill objects
function createActionSkill(
  id: string,
  plugin: {
    name: string;
    description: string;
    risk?: "low" | "medium" | "high";
    requiresApproval?: boolean;
    approvalPolicy?: ActionSkill["approvalPolicy"];
    execute: (input: any) => Promise<any>;
  }
): ActionSkill {
  return {
    id,
    name: plugin.name,
    kind: "action",
    description: plugin.description,
    risk: plugin.risk || "low",
    requiresApproval: plugin.requiresApproval || false,
    approvalPolicy: plugin.approvalPolicy,
    execute: plugin.execute,
  };
}

// Create prompt skill from markdown content
function createPromptSkill(
  id: string,
  name: string,
  description: string,
  content: string
): PromptSkill {
  return {
    id,
    name,
    kind: "prompt",
    description,
    content,
  };
}

export class SkillRegistry {
  private skills: Skill[];

  constructor(_baseDir?: string) {
    // Directly register all skills (baseDir is ignored in browser environment)
    this.skills = [
      // Action skills
      createActionSkill("get-component-status", getComponentStatus),
      createActionSkill("get-component-logs", getComponentLogs),
      createActionSkill("restart-component", restartComponent),
      createActionSkill("scale-component-memory", scaleComponentMemory),

      // Prompt skills
      createPromptSkill(
        "rainbond-core",
        "Rainbond Core Knowledge",
        "Core knowledge and patterns for Rainbond platform operations",
        rainbondCoreSkill
      ),
      createPromptSkill(
        "diagnose-service",
        "Service Diagnosis Workflow",
        "Systematically diagnose a Rainbond service component",
        diagnoseServiceSkill
      ),
      createPromptSkill(
        "deploy-application",
        "Application Deployment Guide",
        "Guide users through deploying applications on Rainbond",
        deployApplicationSkill
      ),
      createPromptSkill(
        "performance-optimization",
        "Performance Optimization",
        "Help users optimize Rainbond application performance",
        performanceOptimizationSkill
      ),
      createPromptSkill(
        "security-best-practices",
        "Security Best Practices",
        "Guide users on securing their Rainbond applications",
        securityBestPracticesSkill
      ),
      createPromptSkill(
        "backup-and-recovery",
        "Backup and Recovery",
        "Guide users through backup and disaster recovery procedures",
        backupAndRecoverySkill
      ),
      createPromptSkill(
        "rainbond-mcp-external-tools",
        "Rainbond MCP for Codex / Claude Code",
        "Best practices and usage guide for integrating Rainbond MCP with external agent tools",
        rainbondMcpExternalToolsSkill
      ),
      createPromptSkill(
        "rainbond-embedded-agent",
        "Rainbond Embedded Agent Playbook",
        "Playbook for Rainbond in-console agent workflows, approvals, and page-context operations",
        rainbondEmbeddedAgentSkill
      ),
      createPromptSkill(
        "rainbond-mcp-scenario-testing",
        "Rainbond MCP Scenario Testing",
        "Scenario-based development and testing guide for Rainbond MCP workflows",
        rainbondMcpScenarioTestingSkill
      ),
    ];
  }

  async loadAll(): Promise<Skill[]> {
    return this.skills;
  }

  async getSkill(skillId: string): Promise<Skill | null> {
    return this.skills.find((s) => s.id === skillId) || null;
  }
}

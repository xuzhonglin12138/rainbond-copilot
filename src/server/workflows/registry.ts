import { listCompiledEmbeddedWorkflows } from "./compiled-registry.js";

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  mode: "embedded" | "workspace";
  stages: string[];
}

const EMBEDDED_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "rainbond-app-assistant",
    name: "Rainbond App Assistant",
    description: "Top-level embedded orchestrator for deployment, diagnosis, and verification flows.",
    mode: "embedded",
    stages: ["resolve-context", "assess-state", "select-subflow", "report"],
  },
  {
    id: "rainbond-fullstack-bootstrap",
    name: "Rainbond Fullstack Bootstrap",
    description: "Bootstrap app topology through embedded-safe create and deploy paths.",
    mode: "embedded",
    stages: ["resolve-scope", "check-topology", "create-or-reuse", "deploy"],
  },
  {
    id: "rainbond-fullstack-troubleshooter",
    name: "Rainbond Fullstack Troubleshooter",
    description: "Low-risk runtime convergence and bounded repair flow.",
    mode: "embedded",
    stages: ["resolve-scope", "inspect-runtime", "classify-blocker", "repair-or-stop"],
  },
  {
    id: "rainbond-delivery-verifier",
    name: "Rainbond Delivery Verifier",
    description: "Final delivery verification and access-path reporting.",
    mode: "embedded",
    stages: ["resolve-scope", "inspect-runtime", "determine-access", "report"],
  },
  {
    id: "rainbond-template-installer",
    name: "Rainbond Template Installer",
    description: "Install app templates into a verified target app.",
    mode: "embedded",
    stages: ["resolve-scope", "discover-template", "resolve-version", "install"],
  },
  {
    id: "rainbond-app-version-assistant",
    name: "Rainbond App Version Assistant",
    description: "Version-center snapshot, publish, and rollback workflow.",
    mode: "embedded",
    stages: ["resolve-scope", "inspect-version-center", "execute-version-action", "report"],
  },
];

export interface WorkflowRegistry {
  list(): WorkflowDefinition[];
  get(id: string): WorkflowDefinition | null;
}

function listMergedEmbeddedWorkflows(): WorkflowDefinition[] {
  const compiledById = new Map(
    listCompiledEmbeddedWorkflows().map((workflow) => [workflow.id, workflow])
  );
  const merged: WorkflowDefinition[] = [];

  for (const workflow of EMBEDDED_WORKFLOWS) {
    merged.push(compiledById.get(workflow.id) || workflow);
    compiledById.delete(workflow.id);
  }

  for (const workflow of compiledById.values()) {
    merged.push(workflow);
  }

  return merged;
}

export function createWorkflowRegistry(): WorkflowRegistry {
  return {
    list() {
      return listMergedEmbeddedWorkflows();
    },
    get(id: string) {
      return listMergedEmbeddedWorkflows().find((workflow) => workflow.id === id) || null;
    },
  };
}

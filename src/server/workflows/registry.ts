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

export function createWorkflowRegistry(): WorkflowRegistry {
  return {
    list() {
      return EMBEDDED_WORKFLOWS.slice();
    },
    get(id: string) {
      return EMBEDDED_WORKFLOWS.find((workflow) => workflow.id === id) || null;
    },
  };
}

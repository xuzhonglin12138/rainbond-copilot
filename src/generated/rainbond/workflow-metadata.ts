export const generatedRainbondWorkflowMetadata = [
  {
    "id": "rainbond-app-version-assistant",
    "title": "rainbond-app-version-assistant",
    "summary": "Use when working in the Rainbond app version center flow under `/team/.../apps/:appID/version`, especially to create snapshots, publish to the local library or cloud market, inspect publish drafts and events, or rollback app runtime to a snapshot.",
    "stages": [
      {
        "id": "resolve-scope",
        "label": "resolve_context"
      },
      {
        "id": "inspect-version-center",
        "label": "tool_call"
      },
      {
        "id": "list-snapshots",
        "label": "tool_call"
      },
      {
        "id": "execute-version-action",
        "label": "branch"
      },
      {
        "id": "report",
        "label": "summarize"
      }
    ]
  },
  {
    "id": "rainbond-delivery-verifier",
    "title": "rainbond-delivery-verifier",
    "summary": "Use only when the next step is already known to be final delivery verification for an existing Rainbond app. Do not use as the first or default response to a generic current-project deployment request; route those to rainbond-app-assistant.",
    "stages": [
      {
        "id": "resolve-scope",
        "label": "resolve_context"
      },
      {
        "id": "inspect-app",
        "label": "tool_call"
      },
      {
        "id": "inspect-components",
        "label": "tool_call"
      },
      {
        "id": "report",
        "label": "summarize"
      }
    ]
  },
  {
    "id": "rainbond-fullstack-troubleshooter",
    "title": "rainbond-fullstack-troubleshooter",
    "summary": "Use only when the current task is already known to be runtime or build troubleshooting for an existing Rainbond app. Do not use as the first or default response to a generic current-project deployment request; route those to rainbond-app-assistant.",
    "stages": [
      {
        "id": "resolve-scope",
        "label": "resolve_context"
      },
      {
        "id": "inspect-app",
        "label": "tool_call"
      },
      {
        "id": "inspect-components",
        "label": "tool_call"
      },
      {
        "id": "inspect-runtime",
        "label": "branch"
      },
      {
        "id": "classify-and-repair",
        "label": "branch"
      },
      {
        "id": "report",
        "label": "summarize"
      }
    ]
  },
  {
    "id": "rainbond-template-installer",
    "title": "rainbond-template-installer",
    "summary": "Use when installing a local or cloud Rainbond app template into an existing or newly created target app through the current Rainbond MCP template-install workflow.",
    "stages": [
      {
        "id": "resolve-scope",
        "label": "resolve_context"
      },
      {
        "id": "discover-template",
        "label": "branch"
      },
      {
        "id": "resolve-version",
        "label": "tool_call"
      },
      {
        "id": "install",
        "label": "tool_call"
      },
      {
        "id": "report",
        "label": "summarize"
      }
    ]
  }
] as const;

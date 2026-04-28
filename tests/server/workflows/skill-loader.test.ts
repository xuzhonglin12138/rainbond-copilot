// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileSkillMarkdown,
  discoverSkillMarkdownFiles,
  loadSkillFromFile,
} from "../../../src/server/workflows/skill-loader";

const rainbondSkillsRoot = path.resolve(process.cwd(), "skills-src/rainbond");

describe("skill loader", () => {
  it("discovers vendored rainbond skill markdown files", async () => {
    const discovered = await discoverSkillMarkdownFiles(rainbondSkillsRoot);

    expect(discovered.length).toBeGreaterThanOrEqual(3);
    expect(
      discovered.some((filePath) =>
        filePath.endsWith("rainbond-delivery-verifier/SKILL.md")
      )
    ).toBe(true);
  });

  it("compiles the vendored rainbond-delivery-verifier skill", async () => {
    const compiled = await loadSkillFromFile(
      path.join(
        rainbondSkillsRoot,
        "rainbond-delivery-verifier",
        "SKILL.md"
      )
    );

    expect(compiled).toMatchObject({
      id: "rainbond-delivery-verifier",
      mode: "embedded",
      workflow: {
        id: "rainbond-delivery-verifier",
        required_context: ["team_name", "region_name", "app_id"],
      },
    });
    expect(compiled.workflow.stages.map((stage) => stage.id)).toEqual([
      "resolve-scope",
      "inspect-app",
      "inspect-components",
      "report",
    ]);
  });

  it("compiles the vendored rainbond-template-installer skill with MCP-aligned args", async () => {
    const compiled = await loadSkillFromFile(
      path.join(
        rainbondSkillsRoot,
        "rainbond-template-installer",
        "SKILL.md"
      )
    );

    expect(compiled.workflow.required_context).toEqual([
      "team_name",
      "region_name",
      "app_id",
    ]);
    expect(compiled.workflow.input_schema).toMatchObject({
      required: ["source", "app_model_id", "app_model_version"],
      properties: {
        source: {
          type: "string",
          enum: ["local", "cloud"],
        },
        market_name: {
          type: "string",
        },
        app_model_id: {
          type: "string",
        },
        app_model_version: {
          type: "string",
        },
      },
    });

    expect(compiled.workflow.stages.map((stage) => stage.id)).toEqual([
      "resolve-scope",
      "discover-template",
      "resolve-version",
      "install",
      "report",
    ]);

    expect(compiled.workflow.stages[1]).toMatchObject({
      id: "discover-template",
      kind: "branch",
      branches: [
        {
          id: "discover-local-templates",
          tool: "rainbond_query_local_app_models",
          args: {
            enterprise_id: "$actor.enterprise_id",
          },
        },
        {
          id: "discover-cloud-markets",
          tool: "rainbond_query_cloud_markets",
          args: {
            enterprise_id: "$actor.enterprise_id",
          },
        },
        {
          id: "discover-cloud-templates",
          tool: "rainbond_query_cloud_app_models",
          args: {
            enterprise_id: "$actor.enterprise_id",
            market_name: "$input.market_name",
          },
        },
      ],
    });

    expect(compiled.workflow.stages[2]).toMatchObject({
      id: "resolve-version",
      kind: "tool_call",
      tool: "rainbond_query_app_model_versions",
      args: {
        enterprise_id: "$actor.enterprise_id",
        source: "$input.source",
        market_name: "$input.market_name",
        app_model_id: "$input.app_model_id",
      },
    });

    expect(compiled.workflow.stages[3]).toMatchObject({
      id: "install",
      kind: "tool_call",
      tool: "rainbond_install_app_model",
      args: {
        team_name: "$context.team_name",
        region_name: "$context.region_name",
        app_id: "$context.app_id",
        source: "$input.source",
        market_name: "$input.market_name",
        app_model_id: "$input.app_model_id",
        app_model_version: "$input.app_model_version",
        is_deploy: "$input.is_deploy",
      },
    });
  });

  it("compiles the vendored rainbond-app-version-assistant skill with explicit branch actions", async () => {
    const compiled = await loadSkillFromFile(
      path.join(
        rainbondSkillsRoot,
        "rainbond-app-version-assistant",
        "SKILL.md"
      )
    );

    expect(compiled.workflow.input_schema).toMatchObject({
      properties: {
        version: { type: "string" },
        version_alias: { type: "string" },
        app_version_info: { type: "string" },
        snapshot_mode: { type: "boolean" },
        snapshot_version: { type: "string" },
        version_id: { type: "integer" },
        scope: {
          type: "string",
          enum: ["local", "goodrain"],
        },
        market_name: { type: "string" },
        preferred_app_id: { type: "string" },
        preferred_version: { type: "string" },
      },
    });

    expect(compiled.workflow.stages[3]).toMatchObject({
      id: "execute-version-action",
      kind: "branch",
      branches: [
        {
          id: "inspect-snapshot-detail",
          tool: "rainbond_get_app_version_snapshot_detail",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            version_id: "$input.version_id",
          },
        },
        {
          id: "create-snapshot",
          tool: "rainbond_create_app_version_snapshot",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            version: "$input.version",
            version_alias: "$input.version_alias",
            app_version_info: "$input.app_version_info",
          },
        },
        {
          id: "create-snapshot-draft",
          tool: "rainbond_create_app_share_record",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            snapshot_mode: "$input.snapshot_mode",
            snapshot_version: "$input.snapshot_version",
          },
        },
        {
          id: "inspect-publish-candidates",
          tool: "rainbond_get_app_publish_candidates",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            scope: "$input.scope",
            market_name: "$input.market_name",
            preferred_app_id: "$input.preferred_app_id",
            preferred_version: "$input.preferred_version",
          },
        },
        {
          id: "rollback-to-snapshot",
          tool: "rainbond_rollback_app_version_snapshot",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            version_id: "$input.version_id",
          },
        },
      ],
    });
  });

  it("rejects tool calls that omit MCP-required args", () => {
    expect(() =>
      compileSkillMarkdown({
        sourcePath: "/tmp/bad-skill/SKILL.md",
        rawContent: `---
name: bad-template-installer
description: Broken example
mode: embedded
---

\`\`\`yaml workflow
id: bad-template-installer
required_context:
  - team_name
  - region_name
  - app_id
input_schema:
  required:
    - source
    - app_model_id
  properties:
    source:
      type: string
      enum: [local, cloud]
    app_model_id:
      type: string
stages:
  - id: install
    kind: tool_call
    tool: rainbond_install_app_model
    args:
      team_name: $context.team_name
      region_name: $context.region_name
      app_id: $context.app_id
      source: $input.source
      app_model_id: $input.app_model_id
  - id: report
    kind: summarize
\`\`\`
`,
      })
    ).toThrow(/rainbond_install_app_model/);
  });

  it("compiles the vendored rainbond-fullstack-troubleshooter skill with MCP-aligned runtime inspection branches", async () => {
    const compiled = await loadSkillFromFile(
      path.join(
        rainbondSkillsRoot,
        "rainbond-fullstack-troubleshooter",
        "SKILL.md"
      )
    );

    expect(compiled).toMatchObject({
      id: "rainbond-fullstack-troubleshooter",
      mode: "embedded",
      workflow: {
        id: "rainbond-fullstack-troubleshooter",
        required_context: ["team_name", "region_name", "app_id"],
      },
      outputContract: {
        schema_ref: "./schemas/troubleshoot-result.schema.yaml",
        top_level_object: "TroubleshootResult",
      },
    });

    expect(compiled.workflow.input_schema).toMatchObject({
      properties: {
        service_id: { type: "string" },
        inspection_mode: {
          type: "string",
          enum: [
            "summary",
            "logs",
            "events",
            "pods",
            "pod_detail",
            "build_logs",
            "envs",
            "connection_envs",
            "dependency",
            "probe",
          ],
        },
        pod_name: { type: "string" },
        event_id: { type: "string" },
        action: {
          type: "string",
          enum: ["service", "container"],
        },
        lines: { type: "integer" },
        container_name: { type: "string" },
        follow: { type: "boolean" },
        envs: { type: "array" },
        build_env_dict: { type: "object" },
        dep_service_id: { type: "string" },
        open_inner: { type: "boolean" },
        container_port: { type: "integer" },
        attr_name: { type: "string" },
        attr_value: { type: "string" },
        probe_id: { type: "string" },
        mode: { type: "string" },
        port: { type: "integer" },
        path: { type: "string" },
        cmd: { type: "string" },
      },
    });

    expect(compiled.workflow.stages.map((stage) => stage.id)).toEqual([
      "resolve-scope",
      "inspect-app",
      "inspect-components",
      "inspect-runtime",
      "classify-and-repair",
      "report",
    ]);

    expect(compiled.workflow.stages[3]).toMatchObject({
      id: "inspect-runtime",
      kind: "branch",
      branches: [
        {
          id: "inspect-component-summary",
          tool: "rainbond_get_component_summary",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
          },
        },
        {
          id: "inspect-component-pods",
          tool: "rainbond_get_component_pods",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
          },
        },
        {
          id: "inspect-pod-detail",
          tool: "rainbond_get_pod_detail",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            pod_name: "$input.pod_name",
          },
        },
        {
          id: "inspect-component-events",
          tool: "rainbond_get_component_events",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            page: 1,
            page_size: 20,
          },
        },
        {
          id: "inspect-component-logs",
          tool: "rainbond_get_component_logs",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            action: "$input.action",
            lines: "$input.lines",
            pod_name: "$input.pod_name",
            container_name: "$input.container_name",
            follow: "$input.follow",
          },
        },
        {
          id: "inspect-component-build-logs",
          tool: "rainbond_get_component_build_logs",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            event_id: "$input.event_id",
          },
        },
        {
          id: "inspect-runtime-envs",
          tool: "rainbond_manage_component_envs",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "summary",
          },
        },
        {
          id: "inspect-connection-envs",
          tool: "rainbond_manage_component_connection_envs",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "summary",
          },
        },
        {
          id: "inspect-dependencies",
          tool: "rainbond_manage_component_dependency",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "summary",
          },
        },
        {
          id: "inspect-probes",
          tool: "rainbond_manage_component_probe",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "summary",
          },
        },
      ],
    });

    expect(compiled.workflow.stages[4]).toMatchObject({
      id: "classify-and-repair",
      kind: "branch",
      branches: [
        {
          id: "replace-build-envs",
          tool: "rainbond_manage_component_envs",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "replace_build_envs",
            build_env_dict: "$input.build_env_dict",
          },
        },
        {
          id: "upsert-runtime-envs",
          tool: "rainbond_manage_component_envs",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "upsert",
            envs: "$input.envs",
          },
        },
        {
          id: "create-connection-env",
          tool: "rainbond_manage_component_connection_envs",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "create",
            attr_name: "$input.attr_name",
            attr_value: "$input.attr_value",
          },
        },
        {
          id: "add-dependency",
          tool: "rainbond_manage_component_dependency",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "add",
            dep_service_id: "$input.dep_service_id",
            open_inner: "$input.open_inner",
            container_port: "$input.container_port",
          },
        },
        {
          id: "update-probe",
          tool: "rainbond_manage_component_probe",
          args: {
            team_name: "$context.team_name",
            region_name: "$context.region_name",
            app_id: "$context.app_id",
            service_id: "$input.service_id",
            operation: "update",
            probe_id: "$input.probe_id",
            mode: "$input.mode",
            port: "$input.port",
            path: "$input.path",
            cmd: "$input.cmd",
          },
        },
      ],
    });

    expect(compiled.toolPolicy).toMatchObject({
      preferred_tools: expect.arrayContaining([
        "rainbond_get_component_pods",
        "rainbond_get_pod_detail",
        "rainbond_get_component_build_logs",
      ]),
    });
  });
});

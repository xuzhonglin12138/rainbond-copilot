// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createWorkflowRegistry } from "../../../src/server/workflows/registry";

describe("workflow registry", () => {
  it("loads the embedded-first rainbond workflows only", () => {
    const registry = createWorkflowRegistry();
    const ids = registry.list().map((item) => item.id);

    expect(ids).toContain("rainbond-app-assistant");
    expect(ids).toContain("rainbond-fullstack-bootstrap");
    expect(ids).toContain("rainbond-fullstack-troubleshooter");
    expect(ids).toContain("rainbond-delivery-verifier");
    expect(ids).toContain("rainbond-template-installer");
    expect(ids).toContain("rainbond-app-version-assistant");
    expect(ids).not.toContain("rainbond-project-init");
    expect(ids).not.toContain("rainbond-env-sync");
  });

  it("returns workflow metadata by id", () => {
    const registry = createWorkflowRegistry();
    const workflow = registry.get("rainbond-app-assistant");

    expect(workflow).toMatchObject({
      id: "rainbond-app-assistant",
      mode: "embedded",
    });
  });
});

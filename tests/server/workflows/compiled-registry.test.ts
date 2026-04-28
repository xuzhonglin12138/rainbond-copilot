// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listCompiledEmbeddedWorkflows } from "../../../src/server/workflows/compiled-registry";

describe("compiled workflow registry", () => {
  it("loads generated embedded workflows from compiled skills", () => {
    const workflows = listCompiledEmbeddedWorkflows();
    const ids = workflows.map((workflow) => workflow.id);

    expect(ids).toContain("rainbond-delivery-verifier");
    expect(ids).toContain("rainbond-fullstack-troubleshooter");
    expect(ids).toContain("rainbond-template-installer");
    expect(ids).toContain("rainbond-app-version-assistant");
  });
});

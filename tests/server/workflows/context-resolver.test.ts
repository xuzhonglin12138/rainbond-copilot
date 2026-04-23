// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyVerifiedScope,
  buildExecutionScopeCandidate,
  buildScopeSignature,
} from "../../../src/server/workflows/context-resolver";

describe("context resolver", () => {
  it("prefers explicit input over UI context and prior scope", () => {
    const candidate = buildExecutionScopeCandidate({
      explicit: {
        teamName: "team-explicit",
        appId: "app-explicit",
      },
      uiContext: {
        teamName: "team-ui",
        regionName: "region-ui",
        appId: "app-ui",
        componentId: "component-ui",
      },
      priorScope: {
        teamName: "team-prior",
        regionName: "region-prior",
        appId: "app-prior",
      },
    });

    expect(candidate).toMatchObject({
      teamName: "team-explicit",
      regionName: "region-ui",
      appId: "app-explicit",
      componentId: "component-ui",
    });
  });

  it("falls back from UI context to prior scope when fields are missing", () => {
    const candidate = buildExecutionScopeCandidate({
      uiContext: {
        teamName: "team-ui",
      },
      priorScope: {
        regionName: "region-prior",
        appId: "app-prior",
      },
    });

    expect(candidate).toMatchObject({
      teamName: "team-ui",
      regionName: "region-prior",
      appId: "app-prior",
    });
  });

  it("creates a stable scope signature and applies verified scope over candidate", () => {
    const candidate = buildExecutionScopeCandidate({
      uiContext: {
        teamName: "team-ui",
        regionName: "region-ui",
        appId: "app-ui",
      },
    });
    const verified = applyVerifiedScope(candidate, {
      teamName: "team-ui",
      regionName: "region-ui",
      appId: "app-real",
      componentId: "component-real",
      verified: true,
    });

    expect(buildScopeSignature(verified)).toBe(
      "team-ui|region-ui|app-real|component-real|verified"
    );
  });
});

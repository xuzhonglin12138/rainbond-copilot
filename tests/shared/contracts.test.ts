import { drawerEventSchema } from "../../src/shared/contracts";

it("accepts a ui.effect highlight event", () => {
  const parsed = drawerEventSchema.parse({
    type: "ui.effect",
    runId: "run-1",
    effect: "highlight_node",
    payload: { targetId: "frontend-ui" },
  });

  expect(parsed.type).toBe("ui.effect");
});

it("accepts a memory.recalled event", () => {
  const parsed = drawerEventSchema.parse({
    type: "memory.recalled",
    runId: "run-2",
    query: "check frontend-ui status",
    entries: [
      {
        content: "执行 Get Component Status: {\"name\":\"frontend-ui\"}",
        relevance: 0.82,
      },
    ],
  });

  expect(parsed.type).toBe("memory.recalled");
  expect(parsed.entries).toHaveLength(1);
});

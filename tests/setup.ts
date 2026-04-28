import "@testing-library/jest-dom";
import { initializeSkillRegistry } from "../src/server/skills/skill-registry";

// Mock scrollIntoView for tests
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof globalThis !== "undefined") {
  // Silence React 18 act() environment warnings in jsdom-based tests.
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
}

beforeAll(async () => {
  await initializeSkillRegistry();
});

afterEach(() => {
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});

# Phase 2: Rainbond Integration Notes

## Overview

Phase 1 built a working prototype with a mock adapter. Phase 2 will swap the `MockActionAdapter` for a real `RainbondActionAdapter` that calls Rainbond APIs or uses Rainbond MCP tools.

## Integration Seam: ActionAdapter Interface

All action skills depend on the `ActionAdapter` interface defined in `src/skills/types.ts`:

```typescript
export interface ActionAdapter {
  getComponentStatus(input: { name: string }): Promise<{
    name: string;
    status: string;
    memory: number;
  }>;

  getComponentLogs(input: { name: string; lines?: number }): Promise<{
    name: string;
    logs: string[];
  }>;

  restartComponent(input: { name: string }): Promise<{
    name: string;
    status: string;
  }>;

  scaleComponentMemory(input: { name: string; memory: number }): Promise<{
    name: string;
    memory: number;
  }>;
}
```

## Phase 2 Implementation Steps

### 1. Create RainbondActionAdapter

Create `src/adapters/rainbond/rainbond-action-adapter.ts` that implements `ActionAdapter`:

- Use Rainbond REST API or MCP tools
- Map Rainbond component states to the adapter interface
- Handle authentication and error cases

### 2. Update Action Skills to Use Dependency Injection

Modify action skill plugins to accept an adapter instance:

```typescript
// Before (Phase 1)
const adapter = new MockActionAdapter();

// After (Phase 2)
export function createSkill(adapter: ActionAdapter) {
  return {
    name: "Get Component Status",
    execute: (input) => adapter.getComponentStatus(input),
  };
}
```

### 3. Wire RainbondActionAdapter into the Runtime

Update `AgentRuntime` to instantiate `RainbondActionAdapter` instead of `MockActionAdapter`.

### 4. Add Integration Tests

Create `tests/adapters/rainbond-action-adapter.test.ts` to verify:
- API calls are made correctly
- Error handling works
- Response mapping is correct

### 5. Preserve MockActionAdapter for Development

Keep `MockActionAdapter` for:
- Local development without Rainbond cluster
- Fast unit tests
- Demo and documentation

## Key Design Principles

1. **Stable Interface**: The `ActionAdapter` interface is the contract. Changing it requires updating all adapters and skills.

2. **No Leaky Abstractions**: Action skills should never import Rainbond-specific types or logic. All Rainbond details stay in `RainbondActionAdapter`.

3. **Testability**: Both adapters implement the same interface, so tests can run against either.

4. **Swappable**: Switching from mock to real adapter should be a one-line change in the runtime initialization.

## Phase 2 Validation Checklist

- [ ] `RainbondActionAdapter` implements `ActionAdapter`
- [ ] All action skills work with both adapters
- [ ] Integration tests pass against real Rainbond cluster
- [ ] Mock adapter still works for local development
- [ ] No Rainbond-specific code leaked into skills or runtime

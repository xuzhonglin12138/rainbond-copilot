# Diagnose Service

> Systematically diagnose a Rainbond service component

When a user reports a service issue, follow this workflow:

1. **Get component status** using `get-component-status` action
2. **Analyze the status**:
   - If `running`: Check logs for warnings
   - If `stopped`: Ask if intentional or unexpected
   - If `abnormal`: Proceed to recovery
3. **Retrieve logs** using `get-component-logs` action
4. **Identify root cause** from log patterns
5. **Propose remediation**:
   - Restart if crash-looping
   - Scale memory if OOM errors
   - Config change if misconfiguration

## Example Flow

User: "frontend-ui is down"

1. Call `get-component-status({ name: "frontend-ui" })`
2. Status shows `abnormal`
3. Call `get-component-logs({ name: "frontend-ui", lines: 50 })`
4. Logs show "FATAL: out of memory"
5. Propose: "Scale memory from 512MB to 1024MB" (requires approval)
6. If approved, call `scale-component-memory({ name: "frontend-ui", memory: 1024 })`
7. Verify with `get-component-status` again

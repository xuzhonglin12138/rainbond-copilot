# Rainbond Core

> Core knowledge and patterns for Rainbond platform operations

This skill provides foundational knowledge about Rainbond architecture, component lifecycle, and operational patterns.

## Component Lifecycle

1. **Building**: Source code is being built into a container image
2. **Starting**: Container is being scheduled and started
3. **Running**: Component is healthy and serving traffic
4. **Stopped**: Component is intentionally stopped
5. **Abnormal**: Component has errors or is crash-looping

## Common Diagnosis Patterns

When a component is abnormal:
1. Check component status
2. Retrieve recent logs
3. Identify error patterns
4. Suggest remediation (restart, scale, config change)

## Risk Levels

- **Low**: Read-only operations (status, logs)
- **Medium**: Non-destructive changes (scale memory up)
- **High**: Potentially disruptive operations (restart, scale down)

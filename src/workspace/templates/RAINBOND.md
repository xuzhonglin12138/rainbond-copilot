# RAINBOND

Rainbond is a cloud-native application management platform.

## Key Concepts
- **Component**: A deployable unit (service, job, or plugin)
- **Application**: A group of components
- **Team**: An organizational unit containing applications
- **Cluster**: The underlying Kubernetes cluster

## Component Status Values
- running: Component is healthy and serving traffic
- stopped: Component is intentionally stopped
- abnormal: Component has errors or is crash-looping
- building: Component is being built or deployed

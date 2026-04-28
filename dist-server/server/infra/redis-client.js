import { createClient } from "redis";
export function createRedisRuntimeClient(url) {
    const client = createClient({ url });
    client.on("error", (error) => {
        console.warn("Redis client error:", error);
    });
    return client;
}

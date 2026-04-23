let sequence = 0;
export function createServerId(prefix) {
    sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
    return `${prefix}_${Date.now()}_${sequence.toString(36)}`;
}

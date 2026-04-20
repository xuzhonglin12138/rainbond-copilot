import { Pool } from "pg";
export function createPostgresPool(connectionString, options = {}) {
    const pool = new Pool({
        connectionString,
        ...options,
    });
    return {
        async query(text, values = []) {
            const result = await pool.query(text, values);
            return {
                rows: result.rows,
            };
        },
        end() {
            return pool.end();
        },
    };
}

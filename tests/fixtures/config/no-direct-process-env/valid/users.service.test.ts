process.env.NODE_ENV = "test";

export function setupTestEnv(): void {
	process.env.LOG_LEVEL = "silent";
}

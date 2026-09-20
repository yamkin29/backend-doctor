import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePullRequestContext } from "../../../src/ci/context.js";

const PR_EVENT = {
	action: "synchronize",
	number: 7,
	pull_request: {
		number: 7,
		base: { ref: "main" },
		head: { sha: "abc123" },
	},
};

function writeEvent(dir: string, payload: unknown): string {
	const file = path.join(dir, "event.json");
	fs.writeFileSync(file, JSON.stringify(payload));
	return file;
}

function baseEnv(): Record<string, string> {
	return { GITHUB_REPOSITORY: "acme/widgets" };
}

describe("resolvePullRequestContext", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bd-ci-context-"));
	});
	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("resolves the context from a pull_request event", () => {
		const eventPath = writeEvent(tmp, PR_EVENT);
		const result = resolvePullRequestContext({
			env: { ...baseEnv(), GITHUB_EVENT_PATH: eventPath },
		});
		expect(result).toEqual({
			ok: true,
			context: {
				repository: "acme/widgets",
				prNumber: 7,
				baseRef: "main",
				headSha: "abc123",
				apiUrl: "https://api.github.com",
				serverUrl: "https://github.com",
				runId: "0",
			},
		});
	});

	it("prefers an explicit event path over GITHUB_EVENT_PATH", () => {
		const explicit = path.join(tmp, "explicit.json");
		fs.writeFileSync(explicit, JSON.stringify(PR_EVENT));
		const stale = path.join(tmp, "stale.json");
		fs.writeFileSync(stale, JSON.stringify({ nope: true }));
		const result = resolvePullRequestContext({
			eventPath: explicit,
			env: {
				...baseEnv(),
				GITHUB_EVENT_PATH: stale,
			},
		});
		expect(result).toMatchObject({ ok: true });
	});

	it("honors GITHUB_API_URL, GITHUB_SERVER_URL and GITHUB_RUN_ID", () => {
		const eventPath = writeEvent(tmp, PR_EVENT);
		const result = resolvePullRequestContext({
			env: {
				...baseEnv(),
				GITHUB_EVENT_PATH: eventPath,
				GITHUB_API_URL: "https://gh.example/api/v3",
				GITHUB_SERVER_URL: "https://gh.example",
				GITHUB_RUN_ID: "12345",
			},
		});
		expect(result).toEqual({
			ok: true,
			context: {
				repository: "acme/widgets",
				prNumber: 7,
				baseRef: "main",
				headSha: "abc123",
				apiUrl: "https://gh.example/api/v3",
				serverUrl: "https://gh.example",
				runId: "12345",
			},
		});
	});

	it("fails naming GITHUB_EVENT_PATH when the event file is missing", () => {
		const result = resolvePullRequestContext({ env: baseEnv() });
		expect(result).toMatchObject({
			ok: false,
			error: expect.stringContaining("GITHUB_EVENT_PATH"),
		});
	});

	it("fails when the event file cannot be parsed", () => {
		const file = path.join(tmp, "broken.json");
		fs.writeFileSync(file, "{not json");
		const result = resolvePullRequestContext({
			env: { ...baseEnv(), GITHUB_EVENT_PATH: file },
		});
		expect(result).toMatchObject({ ok: false });
	});

	it("rejects a non-pull_request event by name", () => {
		const eventPath = writeEvent(tmp, { ref: "refs/heads/main" });
		const result = resolvePullRequestContext({
			env: {
				...baseEnv(),
				GITHUB_EVENT_PATH: eventPath,
				GITHUB_EVENT_NAME: "push",
			},
		});
		expect(result).toMatchObject({
			ok: false,
			error: expect.stringContaining("push"),
		});
	});

	it("rejects an event payload without a pull_request object", () => {
		const eventPath = writeEvent(tmp, { ref: "refs/heads/main" });
		const result = resolvePullRequestContext({
			env: { ...baseEnv(), GITHUB_EVENT_PATH: eventPath },
		});
		expect(result).toMatchObject({ ok: false });
	});

	it("fails when GITHUB_REPOSITORY is missing", () => {
		const eventPath = writeEvent(tmp, PR_EVENT);
		const result = resolvePullRequestContext({
			env: { GITHUB_EVENT_PATH: eventPath },
		});
		expect(result).toMatchObject({
			ok: false,
			error: expect.stringContaining("GITHUB_REPOSITORY"),
		});
	});

	it("fails naming the missing PR field", () => {
		const eventPath = writeEvent(tmp, {
			number: 7,
			pull_request: { base: { ref: "main" }, head: {} },
		});
		const result = resolvePullRequestContext({
			env: { ...baseEnv(), GITHUB_EVENT_PATH: eventPath },
		});
		expect(result).toMatchObject({
			ok: false,
			error: expect.stringContaining("head.sha"),
		});
	});
});

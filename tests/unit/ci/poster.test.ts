import { describe, expect, it } from "vitest";
import { postSurfaces } from "../../../src/ci/poster.js";
import { STICKY_MARKER } from "../../../src/ci/surfaces.js";
import type {
	PullRequestContext,
	ReportSurfaces,
} from "../../../src/ci/types.js";

const context: PullRequestContext = {
	repository: "acme/widgets",
	prNumber: 7,
	baseRef: "main",
	headSha: "abc123",
	apiUrl: "https://api.example",
	serverUrl: "https://github.com",
	runId: "42",
};

const API = "https://api.example/repos/acme/widgets";

interface RecordedCall {
	method?: string;
	url: string;
	body?: unknown;
}

interface FakeResponseSpec {
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
}

function fakeFetch(
	routes: Array<{
		match: (call: { method: string; url: string; seq: number }) => boolean;
		respond: FakeResponseSpec;
	}>,
	calls: RecordedCall[],
) {
	let seq = 0;
	return async (
		url: string,
		init?: { method?: string; headers?: Record<string, string>; body?: string },
	) => {
		const method = init?.method ?? "GET";
		const index = seq++;
		calls.push({
			method,
			url,
			body: init?.body ? JSON.parse(init.body) : undefined,
		});
		const route = routes.find((r) => r.match({ method, url, seq: index }));
		const spec = route?.respond ?? { status: 500 };
		return {
			ok: spec.status < 300,
			status: spec.status,
			headers: {
				get: (name: string) => spec.headers?.[name.toLowerCase()] ?? null,
			},
			json: async () => spec.body,
		};
	};
}

const ENVELOPE: ReportSurfaces = {
	comment: { body: `summary\n\n${STICKY_MARKER}\n` },
	reviewComments: [
		{
			commit_id: "abc123",
			path: "src/a.ts",
			line: 3,
			side: "RIGHT",
			body: "one",
		},
		{
			commit_id: "abc123",
			path: "src/b.ts",
			line: 8,
			side: "RIGHT",
			body: "two",
		},
	],
	status: {
		state: "success",
		description: "0 errors, 2 warnings (blocking: none)",
		context: "backend-doctor",
		target_url: "https://github.com/acme/widgets/actions/runs/42",
	},
};

const OK = { status: 201, body: { id: 1 } };

describe("postSurfaces", () => {
	it("skips every surface with a named warning when no token is set", async () => {
		const calls: RecordedCall[] = [];
		const warnings = await postSurfaces(ENVELOPE, {
			context,
			token: undefined,
			fetchImpl: fakeFetch([], calls),
		});
		expect(calls).toHaveLength(0);
		expect(warnings).toHaveLength(3);
		expect(warnings.every((w) => w.includes("GITHUB_TOKEN is not set"))).toBe(
			true,
		);
		expect(warnings.join("\n")).toContain("sticky comment");
		expect(warnings.join("\n")).toContain("inline review comments");
		expect(warnings.join("\n")).toContain("commit status");
	});

	it("posts comment, reviews and status on the happy path", async () => {
		const calls: RecordedCall[] = [];
		const warnings = await postSurfaces(ENVELOPE, {
			context,
			token: "t0k3n",
			fetchImpl: fakeFetch(
				[
					{
						match: (c) =>
							c.method === "GET" && c.url.includes("/issues/7/comments"),
						respond: { status: 200, body: [] },
					},
					{ match: (c) => c.method === "POST", respond: OK },
				],
				calls,
			),
		});
		expect(warnings).toEqual([]);
		const urls = calls.map((c) => `${c.method} ${c.url}`);
		expect(urls).toContain(`GET ${API}/issues/7/comments?per_page=100`);
		expect(urls).toContain(`POST ${API}/issues/7/comments`);
		expect(urls).toContain(`POST ${API}/pulls/7/comments`);
		expect(urls).toContain(`POST ${API}/statuses/abc123`);
		const statusCall = calls.find((c) => c.url.endsWith("/statuses/abc123"));
		expect(statusCall?.body).toMatchObject({
			state: "success",
			context: "backend-doctor",
		});
	});

	it("updates the existing sticky comment instead of stacking a new one", async () => {
		const calls: RecordedCall[] = [];
		await postSurfaces(ENVELOPE, {
			context,
			token: "t0k3n",
			fetchImpl: fakeFetch(
				[
					{
						match: (c) => c.method === "GET",
						respond: {
							status: 200,
							body: [
								{ id: 4, body: "unrelated bot comment" },
								{ id: 9, body: `older report\n\n${STICKY_MARKER}` },
							],
						},
					},
					{
						match: (c) => c.method === "PATCH",
						respond: { status: 200, body: { id: 9 } },
					},
					{ match: (c) => c.method === "POST", respond: OK },
				],
				calls,
			),
		});
		expect(
			calls.some(
				(c) => c.method === "PATCH" && c.url.endsWith("/issues/comments/9"),
			),
		).toBe(true);
		expect(
			calls.some(
				(c) => c.method === "POST" && c.url.endsWith("/issues/7/comments"),
			),
		).toBe(false);
	});

	it("follows the Link header when walking comment pages", async () => {
		const calls: RecordedCall[] = [];
		await postSurfaces(ENVELOPE, {
			context,
			token: "t0k3n",
			fetchImpl: fakeFetch(
				[
					{
						match: (c) => c.method === "GET" && c.seq === 0,
						respond: {
							status: 200,
							body: [{ id: 4, body: "page one, no marker" }],
							headers: {
								link: `<${API}/issues/7/comments?per_page=100&page=2>; rel="next"`,
							},
						},
					},
					{
						match: (c) => c.method === "GET" && c.seq === 1,
						respond: {
							status: 200,
							body: [{ id: 9, body: `page two ${STICKY_MARKER}` }],
						},
					},
					{
						match: (c) => c.method === "PATCH",
						respond: { status: 200, body: { id: 9 } },
					},
					{ match: (c) => c.method === "POST", respond: OK },
				],
				calls,
			),
		});
		expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
		expect(calls.some((c) => c.url.includes("page=2"))).toBe(true);
		expect(
			calls.some(
				(c) => c.method === "PATCH" && c.url.endsWith("/issues/comments/9"),
			),
		).toBe(true);
	});

	it("continues with the remaining surfaces when one fails", async () => {
		const calls: RecordedCall[] = [];
		const warnings = await postSurfaces(ENVELOPE, {
			context,
			token: "t0k3n",
			fetchImpl: fakeFetch(
				[
					{
						match: (c) => c.method === "GET",
						respond: { status: 403, body: { message: "forbidden" } },
					},
					{ match: (c) => c.method === "POST", respond: OK },
				],
				calls,
			),
		});
		expect(warnings).toEqual(["sticky comment skipped: HTTP 403"]);
		expect(calls.some((c) => c.url.endsWith("/statuses/abc123"))).toBe(true);
		expect(
			calls.filter((c) => c.url.endsWith("/pulls/7/comments")),
		).toHaveLength(2);
	});

	it("aborts the review surface on its first failure but still posts the status", async () => {
		const calls: RecordedCall[] = [];
		const warnings = await postSurfaces(ENVELOPE, {
			context,
			token: "t0k3n",
			fetchImpl: fakeFetch(
				[
					{
						match: (c) => c.method === "GET",
						respond: { status: 200, body: [] },
					},
					{ match: (c) => c.url.endsWith("/issues/7/comments"), respond: OK },
					{
						match: (c) => c.url.endsWith("/pulls/7/comments"),
						respond: { status: 422, body: {} },
					},
					{
						match: (c) => c.url.endsWith("/statuses/abc123"),
						respond: { status: 201, body: {} },
					},
				],
				calls,
			),
		});
		expect(warnings).toEqual([
			"inline review comments skipped: HTTP 422 after 0 posted",
		]);
		expect(
			calls.filter((c) => c.url.endsWith("/pulls/7/comments")),
		).toHaveLength(1);
		expect(calls.some((c) => c.url.endsWith("/statuses/abc123"))).toBe(true);
	});

	it("warns when the status POST fails", async () => {
		const calls: RecordedCall[] = [];
		const warnings = await postSurfaces(ENVELOPE, {
			context,
			token: "t0k3n",
			fetchImpl: fakeFetch(
				[
					{
						match: (c) => c.method === "GET",
						respond: { status: 200, body: [] },
					},
					{
						match: (c) =>
							c.url.endsWith("/issues/7/comments") ||
							c.url.endsWith("/pulls/7/comments"),
						respond: OK,
					},
					{
						match: (c) => c.url.endsWith("/statuses/abc123"),
						respond: { status: 500, body: {} },
					},
				],
				calls,
			),
		});
		expect(warnings).toEqual(["commit status skipped: HTTP 500"]);
	});
});

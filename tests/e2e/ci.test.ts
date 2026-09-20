import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ACTION_REF } from "../../src/ci/workflow-template.js";
import { expectSuccess, makeTmpDir, runCli, runCliAsync } from "./helpers.js";

const WORKFLOW_REL = path.join(".github", "workflows", "backend-doctor.yml");

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

describe("ci install (AC-1..AC-3)", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = makeTmpDir();
	});
	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	function workflowPath(): string {
		return path.join(tmp, WORKFLOW_REL);
	}

	it("creates the workflow deterministically (AC-1, AC-3 default ref)", () => {
		const result = runCli(["ci", "install"], { cwd: tmp });
		expectSuccess(result);
		expect(result.stdout).toContain(workflowPath());
		const content = fs.readFileSync(workflowPath(), "utf8");
		expect(content).toContain("types: [opened, synchronize, reopened]");
		expect(content).toContain("  contents: read");
		expect(content).toContain("  issues: write");
		expect(content).toContain("  pull-requests: write");
		expect(content).toContain("  statuses: write");
		expect(content).toContain("cancel-in-progress: true");
		expect(content).toContain("fetch-depth: 0");
		expect(content).toContain(`uses: ${DEFAULT_ACTION_REF}`);
	});

	it("is byte-identical across fresh installs (AC-1)", () => {
		runCli(["ci", "install"], { cwd: tmp });
		const other = makeTmpDir();
		try {
			runCli(["ci", "install"], { cwd: other });
			expect(fs.readFileSync(workflowPath(), "utf8")).toBe(
				fs.readFileSync(path.join(other, WORKFLOW_REL), "utf8"),
			);
		} finally {
			fs.rmSync(other, { recursive: true, force: true });
		}
	});

	it("refuses to overwrite an existing workflow without --force (AC-2)", () => {
		runCli(["ci", "install"], { cwd: tmp });
		const before = fs.readFileSync(workflowPath(), "utf8");
		fs.writeFileSync(workflowPath(), "# hand-edited\n");
		const result = runCli(["ci", "install"], { cwd: tmp });
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain(workflowPath());
		expect(result.stdout).toBe("");
		expect(fs.readFileSync(workflowPath(), "utf8")).toBe("# hand-edited\n");
		expect(before).not.toBe("# hand-edited\n");
	});

	it("overwrites with --force (AC-2)", () => {
		runCli(["ci", "install"], { cwd: tmp });
		fs.writeFileSync(workflowPath(), "# hand-edited\n");
		const result = runCli(["ci", "install", "--force"], { cwd: tmp });
		expectSuccess(result);
		expect(fs.readFileSync(workflowPath(), "utf8")).not.toContain(
			"# hand-edited",
		);
	});

	it("bakes a custom --action-ref verbatim (AC-3)", () => {
		const result = runCli(
			["ci", "install", "--action-ref", "someone/else@main"],
			{ cwd: tmp },
		);
		expectSuccess(result);
		expect(fs.readFileSync(workflowPath(), "utf8")).toContain(
			"uses: someone/else@main",
		);
	});
});

describe("action.yml static contract (AC-4)", () => {
	const actionYml = fs.readFileSync(path.join(REPO_ROOT, "action.yml"), "utf8");

	it("is a composite action declaring the eight spec inputs", () => {
		expect(actionYml).toContain("using: composite");
		for (const input of [
			"blocking:",
			"base:",
			"directory:",
			"comment:",
			"review-comments:",
			"commit-status:",
			"review-comments-max:",
			"version:",
		]) {
			expect(actionYml).toContain(input);
		}
	});

	it("carries the spec defaults", () => {
		expect(actionYml).toContain('default: "none"');
		expect(actionYml).toContain('default: "."');
		expect(actionYml).toContain('default: "true"');
		expect(actionYml).toContain('default: "50"');
		expect(actionYml).toContain('default: "latest"');
	});

	it("runs the scan with lines scope and json format into the report file", () => {
		expect(actionYml).toContain("--scope lines");
		expect(actionYml).toContain("--base");
		expect(actionYml).toContain("--format json");
		expect(actionYml).toContain("backend-doctor-report.json");
	});

	it("hands the report to ci report with GITHUB_TOKEN", () => {
		expect(actionYml).toContain("ci report");
		expect(actionYml).toContain("GITHUB_TOKEN:");
	});
});

describe("ci report — dry run (AC-5..AC-11, AC-14)", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = makeTmpDir();
	});
	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	const PR_EVENT = {
		action: "synchronize",
		number: 7,
		pull_request: {
			number: 7,
			base: { ref: "main" },
			head: { sha: "abc123" },
		},
	};

	function writeJson(name: string, payload: unknown): string {
		const file = path.join(tmp, name);
		fs.writeFileSync(file, JSON.stringify(payload));
		return file;
	}

	function reportDoc(
		over: Record<string, unknown> = {},
	): Record<string, unknown> {
		const filePath = (f: string) => path.join(tmp, f);
		return {
			schemaVersion: 1,
			mode: "lines",
			scope: { base: "origin/main" },
			directory: tmp,
			diagnostics: [
				{
					id: "d1",
					filePath: filePath("src/a.ts"),
					line: 3,
					column: 1,
					rule: "backend-doctor/no-eval",
					category: "Security",
					severity: "error",
					message: "eval usage",
					tags: [],
				},
				{
					id: "d2",
					filePath: filePath("src/a.ts"),
					line: 9,
					column: 5,
					rule: "backend-doctor/no-sync-fs",
					category: "Performance",
					severity: "warn",
					message: "sync fs in request path",
					tags: [],
				},
				{
					id: "d3",
					filePath: filePath("src/b.ts"),
					line: 2,
					column: 3,
					rule: "backend-doctor/no-weak-crypto",
					category: "Security",
					severity: "warn",
					message: "md5 usage",
					tags: [],
				},
			],
			projects: [],
			...over,
		};
	}

	const BASE_ENV = {
		GITHUB_REPOSITORY: "acme/widgets",
		GITHUB_SERVER_URL: "https://github.com",
		GITHUB_RUN_ID: "42",
		GITHUB_EVENT_NAME: "",
		GITHUB_EVENT_PATH: "",
	};

	function dryRun(
		extraArgs: string[],
		env: Record<string, string> = {},
		doc: Record<string, unknown> = {},
	) {
		const reportFile = writeJson("report.json", reportDoc(doc));
		const eventFile = writeJson("event.json", PR_EVENT);
		return runCli(
			[
				"ci",
				"report",
				"--report",
				reportFile,
				"--event",
				eventFile,
				"--dry-run",
				...extraArgs,
			],
			{ cwd: tmp, env: { ...BASE_ENV, ...env } },
		);
	}

	it("prints the payload envelope and exits 0 under blocking none despite error findings (AC-5)", () => {
		const result = dryRun([]);
		expectSuccess(result);
		const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
		const comment = envelope.comment as { body: string };
		expect(comment.body).toContain("**1 error, 2 warnings** found");
		expect(comment.body).toContain("scope: lines, base: origin/main");
		expect(
			comment.body.trimEnd().endsWith("<!-- backend-doctor:sticky -->"),
		).toBe(true);
		const reviews = envelope.reviewComments as Array<{
			path: string;
			line: number;
			side: string;
			commit_id: string;
		}>;
		expect(reviews).toHaveLength(3);
		expect(reviews[0]).toMatchObject({
			path: "src/a.ts",
			line: 3,
			side: "RIGHT",
			commit_id: "abc123",
		});
		expect(envelope.status).toMatchObject({
			state: "success",
			description: "1 error, 2 warnings (blocking: none)",
			context: "backend-doctor",
			target_url: "https://github.com/acme/widgets/actions/runs/42",
		});
	});

	it("is byte-identical across runs (AC-14)", () => {
		expect(dryRun([]).stdout).toBe(dryRun([]).stdout);
	});

	it("fails under blocking error with error-severity findings (AC-6)", () => {
		const result = dryRun(["--blocking", "error"]);
		expect(result.exitCode).toBe(1);
		const envelope = JSON.parse(result.stdout) as {
			status?: { state: string };
		};
		expect(envelope.status?.state).toBe("failure");
	});

	it("passes under blocking error with only warnings (AC-6)", () => {
		const warnOnly = reportDoc();
		warnOnly.diagnostics = (
			warnOnly.diagnostics as Array<Record<string, unknown>>
		).filter((d) => d.severity === "warn");
		const reportFile = writeJson("warn-only.json", warnOnly);
		const eventFile = writeJson("event.json", PR_EVENT);
		const result = runCli(
			[
				"ci",
				"report",
				"--report",
				reportFile,
				"--event",
				eventFile,
				"--dry-run",
				"--blocking",
				"error",
			],
			{ cwd: tmp, env: BASE_ENV },
		);
		expectSuccess(result);
	});

	it("fails under blocking warn with any finding (AC-6)", () => {
		const result = dryRun(["--blocking", "warn"]);
		expect(result.exitCode).toBe(1);
	});

	it("caps review comments with the +N note (AC-7)", () => {
		const result = dryRun(["--max-review-comments", "2"]);
		expectSuccess(result);
		const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(envelope.reviewComments).toHaveLength(2);
		expect((envelope.comment as { body: string }).body).toContain(
			"1 more omitted",
		);
	});

	it("omits disabled surfaces (AC-8)", () => {
		const result = dryRun([
			"--no-comment",
			"--no-review-comments",
			"--no-commit-status",
		]);
		expectSuccess(result);
		const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
		expect("comment" in envelope).toBe(false);
		expect("reviewComments" in envelope).toBe(false);
		expect("status" in envelope).toBe(false);
		expect(result.stdout).toBe("{}\n");
	});

	it("rejects a non-PR event loudly (AC-9)", () => {
		const reportFile = writeJson("report.json", reportDoc());
		const eventFile = writeJson("push.json", { ref: "refs/heads/main" });
		const result = runCli(
			[
				"ci",
				"report",
				"--report",
				reportFile,
				"--event",
				eventFile,
				"--dry-run",
			],
			{ cwd: tmp, env: { ...BASE_ENV, GITHUB_EVENT_NAME: "push" } },
		);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("push");
		expect(result.stdout).toBe("");
	});

	it("names the missing context (AC-10)", () => {
		const reportFile = writeJson("report.json", reportDoc());
		const eventFile = writeJson("event.json", PR_EVENT);

		const noEvent = runCli(
			["ci", "report", "--report", reportFile, "--dry-run"],
			{
				cwd: tmp,
				env: BASE_ENV,
			},
		);
		expect(noEvent.exitCode).toBe(2);
		expect(noEvent.stderr).toContain("GITHUB_EVENT_PATH");

		const noRepo = runCli(
			[
				"ci",
				"report",
				"--report",
				reportFile,
				"--event",
				eventFile,
				"--dry-run",
			],
			{ cwd: tmp, env: { ...BASE_ENV, GITHUB_REPOSITORY: "" } },
		);
		expect(noRepo.exitCode).toBe(2);
		expect(noRepo.stderr).toContain("GITHUB_REPOSITORY");
	});

	it("rejects missing, unparseable and version-mismatched reports (AC-11)", () => {
		const eventFile = writeJson("event.json", PR_EVENT);

		const missing = runCli(
			[
				"ci",
				"report",
				"--report",
				path.join(tmp, "nope.json"),
				"--event",
				eventFile,
				"--dry-run",
			],
			{ cwd: tmp, env: BASE_ENV },
		);
		expect(missing.exitCode).toBe(2);
		expect(missing.stderr).toContain("nope.json");

		const broken = writeJson("broken.json", {});
		fs.writeFileSync(broken, "{not json");
		const unparseable = runCli(
			["ci", "report", "--report", broken, "--event", eventFile, "--dry-run"],
			{ cwd: tmp, env: BASE_ENV },
		);
		expect(unparseable.exitCode).toBe(2);

		const future = writeJson("future.json", reportDoc({ schemaVersion: 2 }));
		const mismatch = runCli(
			["ci", "report", "--report", future, "--event", eventFile, "--dry-run"],
			{ cwd: tmp, env: BASE_ENV },
		);
		expect(mismatch.exitCode).toBe(2);
		expect(mismatch.stderr).toContain("schemaVersion");
	});

	it("rejects a non-positive --max-review-comments", () => {
		const result = dryRun(["--max-review-comments", "0"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--max-review-comments");
	});
});

describe("ci report — posting path (AC-12)", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = makeTmpDir();
	});
	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	const PR_EVENT = {
		number: 7,
		pull_request: { number: 7, base: { ref: "main" }, head: { sha: "abc123" } },
	};

	function writeFixtures(): { reportFile: string; eventFile: string } {
		const reportFile = path.join(tmp, "report.json");
		fs.writeFileSync(
			reportFile,
			JSON.stringify({
				schemaVersion: 1,
				mode: "lines",
				scope: { base: "origin/main" },
				directory: tmp,
				diagnostics: [
					{
						id: "d1",
						filePath: path.join(tmp, "src/a.ts"),
						line: 3,
						column: 1,
						rule: "backend-doctor/no-eval",
						category: "Security",
						severity: "error",
						message: "eval usage",
						tags: [],
					},
				],
				projects: [],
			}),
		);
		const eventFile = path.join(tmp, "event.json");
		fs.writeFileSync(eventFile, JSON.stringify(PR_EVENT));
		return { reportFile, eventFile };
	}

	function runReport(
		reportFile: string,
		eventFile: string,
		apiUrl: string,
		extraArgs: string[] = [],
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return runCliAsync(
			[
				"ci",
				"report",
				"--report",
				reportFile,
				"--event",
				eventFile,
				...extraArgs,
			],
			{
				cwd: tmp,
				env: {
					GITHUB_REPOSITORY: "acme/widgets",
					GITHUB_EVENT_NAME: "",
					GITHUB_EVENT_PATH: "",
					GITHUB_API_URL: apiUrl,
					GITHUB_TOKEN: "t0k3n",
				},
			},
		);
	}

	it("posts every surface against a live local API (AC-12 happy path)", async () => {
		const calls: Array<{ method: string; url: string }> = [];
		const server = http.createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				calls.push({ method: req.method ?? "", url: req.url ?? "" });
				res.writeHead(201, { "content-type": "application/json" });
				res.end(req.method === "GET" ? "[]" : "{}");
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const port = (server.address() as AddressInfo).port;
		try {
			const { reportFile, eventFile } = writeFixtures();
			const result = await runReport(
				reportFile,
				eventFile,
				`http://127.0.0.1:${port}`,
			);
			expectSuccess(result);
			expect(result.stdout).toBe("");
			expect(
				calls.some(
					(c) =>
						c.method === "GET" &&
						c.url.startsWith("/repos/acme/widgets/issues/7/comments"),
				),
			).toBe(true);
			expect(
				calls.some(
					(c) =>
						c.method === "POST" &&
						c.url === "/repos/acme/widgets/issues/7/comments",
				),
			).toBe(true);
			expect(
				calls.some(
					(c) =>
						c.method === "POST" &&
						c.url === "/repos/acme/widgets/pulls/7/comments",
				),
			).toBe(true);
			expect(
				calls.some(
					(c) =>
						c.method === "POST" &&
						c.url === "/repos/acme/widgets/statuses/abc123",
				),
			).toBe(true);
		} finally {
			server.close();
			server.closeAllConnections();
		}
	}, 20000);

	it("warns per surface when the API rejects everything, exit per blocking (AC-12)", async () => {
		const server = http.createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end("{}");
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const port = (server.address() as AddressInfo).port;
		try {
			const { reportFile, eventFile } = writeFixtures();
			const advisory = await runReport(
				reportFile,
				eventFile,
				`http://127.0.0.1:${port}`,
			);
			expect(advisory.exitCode).toBe(0);
			expect(advisory.stderr).toContain("sticky comment skipped: HTTP 500");
			expect(advisory.stderr).toContain(
				"inline review comments skipped: HTTP 500 after 0 posted",
			);
			expect(advisory.stderr).toContain("commit status skipped: HTTP 500");

			const blocking = await runReport(
				reportFile,
				eventFile,
				`http://127.0.0.1:${port}`,
				["--blocking", "error"],
			);
			expect(blocking.exitCode).toBe(1);
		} finally {
			server.close();
			server.closeAllConnections();
		}
	}, 20000);
});

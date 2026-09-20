import fs from "node:fs";
import type { PullRequestContext } from "./types.js";

export type ContextResolution =
	| { ok: true; context: PullRequestContext }
	| { ok: false; error: string };

interface PullRequestEvent {
	number?: unknown;
	pull_request?: {
		number?: unknown;
		base?: { ref?: unknown };
		head?: { sha?: unknown };
	};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/**
 * Derives the GitHub context `ci report` posts against: the event JSON
 * (explicit `--event` path, else $GITHUB_EVENT_PATH) plus the standard
 * Actions environment. Every failure names the missing or wrong piece —
 * the command turns `{ ok: false }` into exit 2 with the error on stderr
 * (spec 016 AC-9/AC-10).
 */
export function resolvePullRequestContext(opts: {
	eventPath?: string;
	env: NodeJS.ProcessEnv;
}): ContextResolution {
	const eventPath = opts.eventPath ?? opts.env.GITHUB_EVENT_PATH;
	if (!eventPath) {
		return {
			ok: false,
			error:
				"GitHub event file not found: pass --event or set $GITHUB_EVENT_PATH",
		};
	}
	let raw: string;
	try {
		raw = fs.readFileSync(eventPath, "utf8");
	} catch (error) {
		return {
			ok: false,
			error: `Cannot read event file ${eventPath}: ${(error as Error).message}`,
		};
	}
	let event: PullRequestEvent;
	try {
		event = JSON.parse(raw) as PullRequestEvent;
	} catch (error) {
		return {
			ok: false,
			error: `Cannot parse event file ${eventPath}: ${(error as Error).message}`,
		};
	}

	const eventName = opts.env.GITHUB_EVENT_NAME;
	if (eventName && eventName !== "pull_request") {
		return {
			ok: false,
			error: `Unsupported event: ${eventName} (backend-doctor ci report only handles pull_request)`,
		};
	}
	const pr = event.pull_request;
	if (!pr || typeof pr !== "object") {
		return {
			ok: false,
			error:
				"Event payload has no pull_request object (is this a pull_request run?)",
		};
	}

	const repository = asString(opts.env.GITHUB_REPOSITORY);
	if (!repository) {
		return { ok: false, error: "GITHUB_REPOSITORY is not set" };
	}
	const prNumber = asNumber(pr.number) ?? asNumber(event.number);
	if (prNumber === undefined) {
		return { ok: false, error: "Event payload is missing pull_request.number" };
	}
	const baseRef = asString(pr.base?.ref);
	if (!baseRef) {
		return {
			ok: false,
			error: "Event payload is missing pull_request.base.ref",
		};
	}
	const headSha = asString(pr.head?.sha);
	if (!headSha) {
		return {
			ok: false,
			error: "Event payload is missing pull_request.head.sha",
		};
	}

	return {
		ok: true,
		context: {
			repository,
			prNumber,
			baseRef,
			headSha,
			apiUrl: opts.env.GITHUB_API_URL ?? "https://api.github.com",
			serverUrl: opts.env.GITHUB_SERVER_URL ?? "https://github.com",
			runId: opts.env.GITHUB_RUN_ID ?? "0",
		},
	};
}

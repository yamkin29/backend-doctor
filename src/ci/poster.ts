import { STICKY_MARKER } from "./surfaces.js";
import type { PullRequestContext, ReportSurfaces } from "./types.js";

/**
 * The subset of the platform fetch shape the poster relies on; production
 * passes global `fetch`, unit tests pass fakes.
 */
export type FetchLike = (
	url: string,
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	},
) => Promise<{
	ok: boolean;
	status: number;
	headers: { get(name: string): string | null };
	json(): Promise<unknown>;
}>;

export interface PostDeps {
	context: PullRequestContext;
	token?: string;
	fetchImpl: FetchLike;
}

const SURFACE_LABELS = {
	comment: "sticky comment",
	reviewComments: "inline review comments",
	status: "commit status",
} as const;

function jsonHeaders(token: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"Content-Type": "application/json",
		"User-Agent": "backend-doctor-ci",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

const NEXT_LINK = /<([^>]*)>;\s*rel="next"/;

interface ExistingComment {
	id: number;
	body: string;
}

/**
 * Lists the PR's issue comments, following `Link: rel="next"` until
 * exhausted, so the sticky comment is found even when other bots have
 * pushed it past the first page.
 */
async function listComments(
	deps: PostDeps,
	url: string,
): Promise<ExistingComment[]> {
	const all: ExistingComment[] = [];
	let next: string | undefined = url;
	while (next) {
		const res = await deps.fetchImpl(next, {
			headers: jsonHeaders(deps.token),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const page = (await res.json()) as ExistingComment[];
		all.push(...page);
		const link = res.headers.get("link");
		next = link ? NEXT_LINK.exec(link)?.[1] : undefined;
	}
	return all;
}

async function postJson(
	deps: PostDeps,
	url: string,
	method: "POST" | "PATCH",
	body: unknown,
): Promise<void> {
	const res = await deps.fetchImpl(url, {
		method,
		headers: jsonHeaders(deps.token),
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Posts every enabled surface, fail-soft per surface (constitution §8):
 * a failure turns into one named stderr warning and the remaining surfaces
 * still run; the caller's exit code follows the blocking decision either
 * way (spec 016 AC-12). A missing token skips everything up front.
 */
export async function postSurfaces(
	surfaces: ReportSurfaces,
	deps: PostDeps,
): Promise<string[]> {
	const warnings: string[] = [];
	const { context } = deps;

	if (!deps.token) {
		for (const surface of ["comment", "reviewComments", "status"] as const) {
			if (surfaces[surface] !== undefined) {
				warnings.push(
					`${SURFACE_LABELS[surface]} skipped: GITHUB_TOKEN is not set`,
				);
			}
		}
		return warnings;
	}

	const base = `${context.apiUrl}/repos/${context.repository}`;

	if (surfaces.comment !== undefined) {
		try {
			const commentsUrl = `${base}/issues/${context.prNumber}/comments`;
			const existing = await listComments(deps, `${commentsUrl}?per_page=100`);
			const sticky = existing.find((c) => c.body.includes(STICKY_MARKER));
			if (sticky) {
				await postJson(deps, `${base}/issues/comments/${sticky.id}`, "PATCH", {
					body: surfaces.comment.body,
				});
			} else {
				await postJson(deps, commentsUrl, "POST", {
					body: surfaces.comment.body,
				});
			}
		} catch (error) {
			warnings.push(
				`${SURFACE_LABELS.comment} skipped: ${(error as Error).message}`,
			);
		}
	}

	if (surfaces.reviewComments !== undefined) {
		const url = `${base}/pulls/${context.prNumber}/comments`;
		let posted = 0;
		try {
			for (const payload of surfaces.reviewComments) {
				await postJson(deps, url, "POST", payload);
				posted += 1;
			}
		} catch (error) {
			warnings.push(
				`${SURFACE_LABELS.reviewComments} skipped: ${(error as Error).message} after ${posted} posted`,
			);
		}
	}

	if (surfaces.status !== undefined) {
		try {
			await postJson(
				deps,
				`${base}/statuses/${context.headSha}`,
				"POST",
				surfaces.status,
			);
		} catch (error) {
			warnings.push(
				`${SURFACE_LABELS.status} skipped: ${(error as Error).message}`,
			);
		}
	}

	return warnings;
}

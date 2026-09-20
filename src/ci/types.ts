/** Failure policy for the PR surfaces (spec 016 open question 4). */
export type BlockingMode = "none" | "error" | "warn";

/**
 * Everything needed to talk to the GitHub API and anchor payloads to the
 * PR: derived from the event JSON plus the standard Actions environment.
 */
export interface PullRequestContext {
	/** "owner/name" from GITHUB_REPOSITORY. */
	repository: string;
	prNumber: number;
	/** Base branch name (e.g. "main") from the event. */
	baseRef: string;
	/** PR head commit SHA — anchors review comments and the commit status. */
	headSha: string;
	/** REST root; GITHUB_API_URL or https://api.github.com. */
	apiUrl: string;
	/** Web root; GITHUB_SERVER_URL or https://github.com. */
	serverUrl: string;
	/** GITHUB_RUN_ID or "0" — feeds the status target_url. */
	runId: string;
}

export interface SurfaceOptions {
	blocking: BlockingMode;
	comment: boolean;
	reviewComments: boolean;
	commitStatus: boolean;
	maxReviewComments: number;
	context: PullRequestContext;
	/**
	 * $GITHUB_WORKSPACE when running in Actions: the base review-comment
	 * paths are relativized against (the API rejects absolute paths).
	 * Falls back to the report's `directory` when unset.
	 */
	workspaceRoot?: string;
}

/** A POST /pulls/{n}/comments body, exactly as sent to the API. */
export interface ReviewCommentPayload {
	commit_id: string;
	path: string;
	line: number;
	side: "RIGHT";
	body: string;
}

/** A POST /statuses/{sha} body. */
export interface CommitStatusPayload {
	state: "success" | "failure";
	description: string;
	context: string;
	target_url: string;
}

/**
 * The exact payloads the posting step would send. Disabled surfaces omit
 * their key, so `--dry-run` output doubles as the machine-readable preview
 * (spec 016 AC-5/AC-8).
 */
export interface ReportSurfaces {
	comment?: { body: string };
	reviewComments?: ReviewCommentPayload[];
	status?: CommitStatusPayload;
}

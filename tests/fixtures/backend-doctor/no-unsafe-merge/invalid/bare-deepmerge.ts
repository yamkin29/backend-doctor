import deepmerge from "deepmerge";

export function combine(req: { config: Record<string, unknown> }): object {
	return deepmerge({ retries: 1 }, req.config);
}

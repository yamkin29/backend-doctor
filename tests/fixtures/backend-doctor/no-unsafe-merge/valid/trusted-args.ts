import _ from "lodash";

const defaults = { retries: 1 };

export function patch(overrides: Record<string, unknown>): object {
	return _.merge({}, defaults, overrides);
}

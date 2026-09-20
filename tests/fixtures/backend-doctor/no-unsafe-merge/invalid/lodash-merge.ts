import _ from "lodash";

export function patch(req: { body: Record<string, unknown> }): object {
	return _.merge({}, req.body);
}

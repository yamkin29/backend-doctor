function merge(target: object, patchData: object): object {
	return { ...target, ...patchData };
}

export function patch(req: { body: Record<string, unknown> }): object {
	return merge({}, req.body);
}

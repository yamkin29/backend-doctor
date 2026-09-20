async function fetch(url: string): Promise<{ json: () => unknown }> {
	return { json: () => url };
}

export async function proxy(req: { query: { url: string } }): Promise<unknown> {
	return fetch(req.query.url).json();
}

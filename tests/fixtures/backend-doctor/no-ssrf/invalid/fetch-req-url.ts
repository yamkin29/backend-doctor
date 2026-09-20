export async function proxy(req: { query: { url: string } }): Promise<unknown> {
	const response = await fetch(req.query.url);
	return response.json();
}

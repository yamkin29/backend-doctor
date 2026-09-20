export async function mirror(req: { query: { host: string } }): Promise<unknown> {
	return fetch(`https://${req.query.host}/mirror`);
}

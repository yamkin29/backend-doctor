export async function proxy(ctx: { query: { url: string } }): Promise<unknown> {
	return fetch(ctx.query.url);
}

export async function handler(req: { query: { url: string } }): Promise<unknown> {
	const axiosish = { get: (url: string): string => url };
	return axiosish.get(req.query.url);
}

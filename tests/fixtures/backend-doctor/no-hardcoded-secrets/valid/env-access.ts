export function client(): string {
	return process.env.BACKEND_API_KEY ?? "";
}

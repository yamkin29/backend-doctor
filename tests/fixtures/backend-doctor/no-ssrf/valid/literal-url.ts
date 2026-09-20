export async function health(): Promise<unknown> {
	const response = await fetch("https://api.example.com/health");
	return response.json();
}

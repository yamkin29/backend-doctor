export class UsersService {
	getTimeout(): number {
		return Number(process.env.REQUEST_TIMEOUT);
	}

	apiUrl(): string {
		return process.env["API_URL"] ?? "/default";
	}
}

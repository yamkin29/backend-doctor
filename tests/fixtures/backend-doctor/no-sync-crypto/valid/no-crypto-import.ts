const crypto = {
	pbkdf2Sync(password: string, salt: string): string {
		return password + salt;
	},
};

export function derive(password: string, salt: string): string {
	return crypto.pbkdf2Sync(password, salt);
}

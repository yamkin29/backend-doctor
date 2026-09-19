/** Thrown for any invalid or unloadable config; message carries file + field path. */
export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

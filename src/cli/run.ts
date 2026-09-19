import { Command, CommanderError } from "commander";
import { resolveVersion } from "./version.js";

/**
 * Parses argv and dispatches to a command. Side-effect free except for stdout
 * writes performed by commander (help, version). Returns the process exit code;
 * the bin entry assigns it to process.exitCode instead of calling process.exit
 * so stdout can flush naturally.
 *
 * Exit codes (constitution §5): 0 ok, 1 error-severity diagnostics, 2 usage or
 * environment error.
 */
export async function run(argv: string[]): Promise<number> {
	const program = new Command();
	program
		.name("backend-doctor")
		.description("Deterministic static analyzer for Node.js/NestJS backends.")
		.version(resolveVersion(), "-V, --version")
		.exitOverride();

	try {
		await program.parseAsync(argv);
	} catch (error) {
		if (error instanceof CommanderError) {
			// Help and version output has already been written to stdout.
			if (
				error.code === "commander.version" ||
				error.code === "commander.help" ||
				error.code === "commander.helpDisplayed"
			) {
				return 0;
			}
			// Commander has already written the message and usage to stderr.
			return 2;
		}
		throw error;
	}
	return 0;
}

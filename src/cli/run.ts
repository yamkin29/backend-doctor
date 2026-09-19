import process from "node:process";
import { Command, CommanderError, Option } from "commander";
import type { ReportFormat } from "../reporters/index.js";
import { type ScanCommandOptions, scanCommand } from "./commands/scan.js";
import { resolveVersion } from "./version.js";

function collectIgnore(value: string, previous: string[]): string[] {
	return [...previous, value];
}

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

	let exit = 0;
	program
		.command("scan")
		.description("Scan a project for issues.")
		.argument("[path]", "directory or file to scan (default: cwd)")
		.addOption(
			new Option("--format <format>", "output format: pretty|json|jsonl")
				.choices(["pretty", "json", "jsonl"])
				.default("pretty"),
		)
		.option(
			"--ignore <glob>",
			"exclude glob; repeatable; no-op until the engine lands (F003)",
			collectIgnore,
			[],
		)
		.option("--config <path>", "reserved; config files are supported from F002")
		.exitOverride()
		.action(async (pathArg: string | undefined, opts: ScanCommandOptions) => {
			if (opts.config !== undefined) {
				process.stderr.write(
					"The --config option is reserved: config files are supported from F002.\n",
				);
				exit = 2;
				return;
			}
			exit = await scanCommand(pathArg, {
				...opts,
				format: opts.format as ReportFormat,
			});
		});

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
	return exit;
}

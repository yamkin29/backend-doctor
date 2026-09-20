import { Command, CommanderError, Option } from "commander";
import type { ReportFormat } from "../reporters/index.js";
import {
	type CiInstallOptions,
	type CiReportOptions,
	ciInstallCommand,
	ciReportCommand,
} from "./commands/ci.js";
import { initCommand } from "./commands/init.js";
import { type ScanCommandOptions, scanCommand } from "./commands/scan.js";
import { resolveVersion } from "./version.js";

function collectRepeatable(value: string, previous: string[]): string[] {
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
			"exclude glob; repeatable; unioned with config ignore.files",
			collectRepeatable,
			[],
		)
		.addOption(
			new Option(
				"--scope <mode>",
				"restrict the scan: all|changed|files|lines (spec 015)",
			)
				.choices(["all", "changed", "files", "lines"])
				.default("all"),
		)
		.option(
			"--base <ref>",
			'git ref for --scope changed|lines (default: "HEAD")',
		)
		.option(
			"--file <path>",
			"with --scope files: analyze exactly this file; repeatable",
			collectRepeatable,
			[],
		)
		.option("--config <path>", "load exactly this config file, skip discovery")
		.option(
			"--dump-config",
			"print the resolved config as JSON and exit without scanning",
		)
		.exitOverride()
		.action(async (pathArg: string | undefined, opts: ScanCommandOptions) => {
			exit = await scanCommand(pathArg, {
				...opts,
				format: opts.format as ReportFormat,
			});
		});

	program
		.command("init")
		.description(
			"Create a starter backend-doctor.config.ts in the current directory.",
		)
		.exitOverride()
		.action(async () => {
			exit = initCommand();
		});

	const ci = program
		.command("ci")
		.description("CI integration helpers (GitHub Actions).");

	ci.command("install")
		.description(
			"Write the Backend Doctor GitHub Actions workflow into the current repository.",
		)
		.option("--force", "overwrite an existing workflow file")
		.option(
			"--action-ref <ref>",
			"the uses: ref baked into the generated workflow",
		)
		.exitOverride()
		.action((opts: CiInstallOptions) => {
			exit = ciInstallCommand(opts);
		});

	ci.command("report")
		.description(
			"Post PR surfaces (sticky comment, inline review comments, commit status) from a scan report.",
		)
		.requiredOption("--report <path>", "scan JSON report file")
		.addOption(
			new Option("--blocking <mode>", "failure policy: none|error|warn")
				.choices(["none", "error", "warn"])
				.default("none"),
		)
		.option("--event <path>", "event JSON file (default: $GITHUB_EVENT_PATH)")
		.option("--no-comment", "skip the sticky PR summary comment")
		.option("--no-review-comments", "skip inline review comments")
		.option("--no-commit-status", "skip the commit status")
		.option("--max-review-comments <n>", "inline review comment cap", "50")
		.option(
			"--dry-run",
			"print the exact payloads as JSON to stdout without posting",
		)
		.exitOverride()
		.action(async (opts: CiReportOptions) => {
			exit = await ciReportCommand(opts);
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

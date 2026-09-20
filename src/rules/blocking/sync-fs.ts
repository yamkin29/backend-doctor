import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";

/**
 * The sync surface of the node:fs callback API (design §2). Every member
 * ends in "Sync", so the promise API (`fs.promises.*`) cannot match.
 */
const SYNC_FS_METHODS = [
	"accessSync",
	"appendFileSync",
	"chmodSync",
	"chownSync",
	"closeSync",
	"copyFileSync",
	"cpSync",
	"existsSync",
	"fchmodSync",
	"fchownSync",
	"fdatasyncSync",
	"fsyncSync",
	"ftruncateSync",
	"futimesSync",
	"lchmodSync",
	"lchownSync",
	"linkSync",
	"lstatSync",
	"mkdirSync",
	"mkdtempSync",
	"openSync",
	"opendirSync",
	"readFileSync",
	"readSync",
	"readvSync",
	"readdirSync",
	"readlinkSync",
	"realpathSync",
	"renameSync",
	"rmSync",
	"rmdirSync",
	"statSync",
	"symlinkSync",
	"truncateSync",
	"unlinkSync",
	"utimesSync",
	"writeFileSync",
	"writeSync",
	"writevSync",
] as const;

const FS_SPECIFIERS = [
	"fs",
	"node:fs",
	"fs/promises",
	"node:fs/promises",
] as const;

/**
 * Flags synchronous fs calls inside function bodies — blocking I/O in a
 * request path stalls every concurrent request (spec 006). Module top level
 * is exempt (startup blocking is idiomatic); handler attribution is future
 * work (F008/F013/F019), so any function body counts.
 */
export const noSyncFsInRequestPath = defineRule({
	id: "backend-doctor/no-sync-fs-in-request-path",
	title: "No sync fs in request path",
	category: "Performance",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-sync-fs-in-request-path.md",
	create(ctx) {
		for (const { call } of findModuleApiCalls(ctx.file, {
			specifiers: FS_SPECIFIERS,
			names: SYNC_FS_METHODS,
			insideFunctionBodies: true,
		})) {
			ctx.report({
				node: call,
				message:
					"Synchronous fs calls block the event loop for the whole I/O, stalling every concurrent request. Use the promise API (fs/promises) or await fs.promises instead.",
			});
		}
	},
});

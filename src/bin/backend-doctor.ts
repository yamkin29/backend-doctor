import { run } from "../cli/run.js";

process.exitCode = await run(process.argv);

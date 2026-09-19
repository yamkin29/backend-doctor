import { build } from "tsup";
import { buildOptions } from "../tsup.config.js";

export default async function globalSetup(): Promise<void> {
	await build({ ...buildOptions, silent: true });
}

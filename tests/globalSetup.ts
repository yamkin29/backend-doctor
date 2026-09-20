import { build } from "tsup";
import { allBuildOptions } from "../tsup.config.js";

export default async function globalSetup(): Promise<void> {
	for (const options of allBuildOptions) {
		await build({ ...options, silent: true });
	}
}

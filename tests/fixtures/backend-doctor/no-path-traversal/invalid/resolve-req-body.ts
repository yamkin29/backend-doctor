import { resolve } from "node:path";

export function locate(req: { body: { target: string } }): string {
	return resolve("/data", req.body.target);
}

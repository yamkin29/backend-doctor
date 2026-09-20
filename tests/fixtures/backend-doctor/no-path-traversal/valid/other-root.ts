import path from "node:path";

export function serve(ctx: { params: { file: string } }): string {
	return path.join("/uploads", ctx.params.file);
}

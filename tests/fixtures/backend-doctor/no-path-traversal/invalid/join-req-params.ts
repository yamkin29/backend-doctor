import path from "node:path";

export function serve(req: { params: { file: string } }): string {
	return path.join("/uploads", req.params.file);
}

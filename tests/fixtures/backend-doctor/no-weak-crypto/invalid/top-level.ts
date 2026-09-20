import { createHash } from "node:crypto";

export const etag = createHash("sha1").update("payload").digest("hex");

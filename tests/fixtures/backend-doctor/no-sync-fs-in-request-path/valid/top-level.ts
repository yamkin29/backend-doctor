import fs from "node:fs";

export const config = fs.readFileSync("config.json", "utf8");

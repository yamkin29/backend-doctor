// Same interception through an ESM named import (spec 020 AC-4): the
// Module._load call then carries the resolved node_modules path instead of
// the bare specifier — both forms must wrap.
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const client = new PrismaClient();
await client.rawQuery();
const server = http.createServer(async (req, res) => {
	await client.userFindMany();
	res.end("ok");
});
server.listen(0, async () => {
	const { port } = server.address();
	const res = await fetch(`http://127.0.0.1:${port}/users`);
	await res.text();
	server.close();
	console.log("prisma-esm-done");
});

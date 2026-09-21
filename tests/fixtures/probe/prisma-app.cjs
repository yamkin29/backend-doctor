// Prisma interception fixture (spec 020, CJS require): one startup query
// outside any request (must record attributed: false), then queries inside
// HTTP handlers — the per-request dbQueries counts must include only the
// in-request queries. Requires the fake @prisma/client next to this file.
const http = require("node:http");
const { PrismaClient } = require("@prisma/client");
const client = new PrismaClient();

async function main() {
	await client.rawQuery(); // startup — attributed: false
	const server = http.createServer(async (req, res) => {
		if (req.url === "/bulk") {
			req.baseUrl = "";
			req.route = { path: "/bulk" };
			for (let i = 0; i < 3; i++) {
				await client.userFindMany();
			}
			res.end("bulk");
		} else {
			res.end("ok");
		}
	});
	await new Promise((resolve) => server.listen(0, resolve));
	const { port } = server.address();
	const bulk = await fetch(`http://127.0.0.1:${port}/bulk`);
	await bulk.text();
	const other = await fetch(`http://127.0.0.1:${port}/other`);
	await other.text();
	server.close();
	console.log("prisma-app-done");
}
main();

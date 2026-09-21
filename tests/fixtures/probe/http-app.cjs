// HTTP fixture (spec 020): a plain node:http server that fetches itself — one
// route emulating the Express route marker exactly as express sets it during
// dispatch, one unmarked route (pathname fallback), one 404, and one
// client-aborted request whose response never finishes.
const http = require("node:http");

const server = http.createServer((req, res) => {
	try {
		if (req.url === "/users/42" || req.url === "/users/43") {
			// Express-style markers (spec 020 AC-2): the hook must pick the
			// pattern "/users/:id", not the concrete path.
			req.baseUrl = "";
			req.route = { path: "/users/:id" };
			res.writeHead(200);
			res.end("user");
		} else if (req.url === "/plain") {
			res.writeHead(201);
			res.end("plain");
		} else if (req.url === "/abort") {
			res.on("error", () => {}); // the client destroy is expected
			res.write("partial"); // never end(): "finish" must never fire
		} else {
			res.writeHead(404);
			res.end();
		}
	} catch {
		// an abort racing the write must not crash the fixture
	}
});

server.listen(0, () => {
	const { port } = server.address();
	const base = `http://127.0.0.1:${port}`;
	const run = async () => {
		for (const route of ["/users/42", "/users/43", "/plain", "/missing"]) {
			const res = await fetch(`${base}${route}`);
			await res.text();
		}
		const controller = new AbortController();
		const aborted = fetch(`${base}/abort`, { signal: controller.signal });
		setTimeout(() => controller.abort(), 30);
		try {
			await aborted;
		} catch {
			// expected abort rejection
		}
		setTimeout(() => server.close(), 50);
	};
	run();
});
server.on("close", () => console.log("http-app-done"));

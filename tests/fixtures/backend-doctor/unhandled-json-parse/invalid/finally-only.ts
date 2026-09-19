export function parsePayload(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} finally {
		parsed = true;
	}
}

let parsed = false;

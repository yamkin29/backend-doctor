import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import {
	type Expression,
	Node,
	type SourceFileView,
} from "../../../src/engine/parser/types.js";
import { containsRequestInput } from "../../../src/rules/security/request-input.js";
import {
	isSecretLiteral,
	isSecretName,
	normalizeName,
	shannonEntropy,
} from "../../../src/rules/security/secrets.js";

/** Parses one in-memory source through the real adapter. */
function viewOf(source: string): SourceFileView {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-sec-"));
	const file = path.join(dir, "sample.ts");
	fs.writeFileSync(file, source);
	const adapter = new TsMorphParserAdapter();
	const { files } = adapter.createProject([file]);
	const view = files[0];
	if (!view) throw new Error("adapter returned no file view");
	return view;
}

/** Wraps an expression in a variable declaration and returns the initializer. */
function initializerOf(exprSource: string): Expression {
	const view = viewOf(`const candidate = ${exprSource};\n`);
	let found: Expression | undefined;
	view.forEachDescendant((node) => {
		if (Node.isVariableDeclaration(node) && node.getName() === "candidate") {
			const initializer = node.getInitializer();
			if (initializer) found = initializer;
			return undefined;
		}
		return undefined;
	});
	if (!found) throw new Error(`no initializer parsed for: ${exprSource}`);
	return found;
}

describe("containsRequestInput (spec 007 T2)", () => {
	it("matches property chains rooted at req/request, directly or composed", () => {
		expect(containsRequestInput(initializerOf("req.params.file"))).toBe(true);
		expect(containsRequestInput(initializerOf("request.body.url"))).toBe(true);
		expect(containsRequestInput(initializerOf("req.a.b.c"))).toBe(true);
		expect(containsRequestInput(initializerOf("(req.params.file)"))).toBe(true);
		expect(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: the template
			// placeholder is the test input itself, not an accidental string.
			containsRequestInput(initializerOf("`https://${req.query.host}/x`")),
		).toBe(true);
		expect(
			containsRequestInput(initializerOf('"/uploads/" + req.params.file')),
		).toBe(true);
		expect(
			containsRequestInput(initializerOf('req.params.file + ".png"')),
		).toBe(true);
	});

	it("does not match literals, other roots, element access, or whole req", () => {
		expect(containsRequestInput(initializerOf('"/uploads"'))).toBe(false);
		expect(containsRequestInput(initializerOf("ctx.params.file"))).toBe(false);
		expect(containsRequestInput(initializerOf("request2.url"))).toBe(false);
		expect(containsRequestInput(initializerOf('req["params"]'))).toBe(false);
		expect(containsRequestInput(initializerOf("req"))).toBe(false);
		expect(containsRequestInput(initializerOf("plain.value"))).toBe(false);
		expect(containsRequestInput(initializerOf("req.x - 1"))).toBe(false);
	});
});

describe("secret-literal predicates (spec 007 T2)", () => {
	it("computes Shannon entropy with deterministic boundaries", () => {
		expect(shannonEntropy("aaaaaaaaaaaaaaaa")).toBe(0);
		expect(shannonEntropy("")).toBe(0);
		expect(shannonEntropy("abcdefghijklmnop")).toBeCloseTo(4, 10);
	});

	it("flags literals by length and entropy together", () => {
		expect(isSecretLiteral("abcdefghijklmnop")).toBe(true);
		expect(isSecretLiteral("aaaaaaaaaaaaaaaa")).toBe(false);
		expect(isSecretLiteral("abcdefghijk")).toBe(false);
		expect(isSecretLiteral("sk_live_9fK3pXwR7vTqzLm5Yh8Cd1BnJ2")).toBe(true);
		expect(isSecretLiteral("aaaa-bbbb-cccc-dddd")).toBe(false);
	});

	it("normalizes separators and case for name matching", () => {
		expect(normalizeName("MY_API_KEY")).toBe("myapikey");
		expect(normalizeName("db-password")).toBe("dbpassword");
		expect(normalizeName("clientSecret")).toBe("clientsecret");
	});

	it("matches compound secret names and rejects ambiguous ones", () => {
		expect(isSecretName("apiKey")).toBe(true);
		expect(isSecretName("AUTH_TOKEN")).toBe(true);
		expect(isSecretName("awsSecretAccessKey")).toBe(true);
		expect(isSecretName("password")).toBe(true);
		expect(isSecretName("cacheToken")).toBe(false);
		expect(isSecretName("token")).toBe(false);
		expect(isSecretName("secret")).toBe(false);
		expect(isSecretName("key")).toBe(false);
		expect(isSecretName("credentials")).toBe(false);
		expect(isSecretName("maxRetries")).toBe(false);
	});
});

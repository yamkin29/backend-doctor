/**
 * Secret-literal predicates for `no-hardcoded-secrets` (spec 007, open
 * question 4): a pinned compound-name list plus deterministic string
 * arithmetic — no dependencies, byte-identical across runs
 * (constitution §1).
 */

/**
 * A declaration name matches when its normalized form CONTAINS one of these
 * compound names. Bare `secret`, `token`, `key`, `credentials` are
 * deliberately absent — names like `cacheToken` and `key` would burn the
 * false-positive budget (spec 007 design §4).
 */
const SECRET_NAMES = [
	"password",
	"passwd",
	"apikey",
	"apisecret",
	"secretkey",
	"accesskey",
	"secretaccesskey",
	"authtoken",
	"accesstoken",
	"refreshtoken",
	"clientsecret",
	"privatekey",
	"appsecret",
	"encryptionkey",
	"signingkey",
	"sessionsecret",
	"webhooksecret",
	"dbpassword",
	"dbpass",
	"awssecretaccesskey",
] as const;

export const MIN_SECRET_LENGTH = 16;
export const MIN_SECRET_ENTROPY_BITS = 3.0;

/** Shannon entropy in bits per character. Empty strings have zero entropy. */
export function shannonEntropy(text: string): number {
	if (text.length === 0) return 0;
	const counts = new Map<string, number>();
	for (const character of text) {
		counts.set(character, (counts.get(character) ?? 0) + 1);
	}
	let bits = 0;
	for (const count of counts.values()) {
		const probability = count / text.length;
		bits -= probability * Math.log2(probability);
	}
	return bits;
}

/** Lowercases and strips `_`, `-`, `$` and whitespace. */
export function normalizeName(name: string): string {
	return name.toLowerCase().replaceAll(/[_\-$\s]/g, "");
}

export function isSecretName(name: string): boolean {
	const normalized = normalizeName(name);
	return SECRET_NAMES.some((secret) => normalized.includes(secret));
}

/** True when the literal is long enough and entropic enough to be a secret. */
export function isSecretLiteral(value: string): boolean {
	return (
		value.length >= MIN_SECRET_LENGTH &&
		shannonEntropy(value) >= MIN_SECRET_ENTROPY_BITS
	);
}

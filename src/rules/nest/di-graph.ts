import type {
	NestAppModel,
	NestInjectionRef,
	NestModuleEntry,
	NestProviderEntry,
} from "../../framework/nest/model.js";

/**
 * Pure model queries for the Nest DI rules (spec 009): consumer lookup,
 * provider-cycle components and module-graph resolvability. Everything here
 * reads the plain F008 model — no AST nodes, no parser imports (constitution
 * §4) — and produces order-independent, deterministic results.
 */

/** A provider or controller that can consume injections. */
export interface DiConsumer {
	className: string;
	filePath: string;
	line: number;
	column: number;
	/** Controllers have no scope; undefined behaves as the singleton default. */
	scope: NestProviderEntry["scope"] | undefined;
	injections: NestInjectionRef[];
}

export interface DiCycle {
	/** Deterministic simple cycle; first and last elements are the canonical member. */
	path: NestProviderEntry[];
	/** The path rendered "A → B → A". */
	pathText: string;
	/** The closing edge's injection (last member → canonical member). */
	closingEdge: NestInjectionRef;
	/** The provider entry owning the closing edge. */
	closingConsumer: NestProviderEntry;
	/** True when any edge along the path carries forwardRef. */
	hasForwardRef: boolean;
}

interface Edge {
	/** Chosen injection for this edge (first in source order for the name). */
	injection: NestInjectionRef;
	target: number;
}

/** Providers and controllers defined in one file, providers first (model order). */
export function consumersInFile(
	model: NestAppModel,
	filePath: string,
): DiConsumer[] {
	const consumers: DiConsumer[] = [];
	for (const entry of model.providers) {
		if (entry.filePath === filePath) {
			consumers.push({
				className: entry.className,
				filePath: entry.filePath,
				line: entry.line,
				column: entry.column,
				scope: entry.scope,
				injections: entry.injections,
			});
		}
	}
	for (const entry of model.controllers) {
		if (entry.filePath === filePath) {
			consumers.push({
				className: entry.className,
				filePath: entry.filePath,
				line: entry.line,
				column: entry.column,
				scope: undefined,
				injections: entry.injections,
			});
		}
	}
	return consumers;
}

/**
 * One cycle per cyclic provider component (SCC size > 1 or self-loop),
 * ordered by canonical member position in the model. The path is a fixed
 * lexicographic DFS from the canonical member, so the same graph always
 * yields the same components, paths and closing edges.
 */
export function findProviderCycles(model: NestAppModel): DiCycle[] {
	const providers = model.providers;
	const byClassName = new Map<string, number[]>();
	for (const [index, entry] of providers.entries()) {
		const indices = byClassName.get(entry.className);
		if (indices) {
			indices.push(index);
		} else {
			byClassName.set(entry.className, [index]);
		}
	}

	// Adjacency per node, edges ordered by (injected name, target position).
	const adjacency: Edge[][] = providers.map((entry) => {
		const edges: Edge[] = [];
		for (const injection of entry.injections) {
			for (const target of byClassName.get(injection.name) ?? []) {
				edges.push({ injection, target });
			}
		}
		edges.sort((a, b) => {
			const byName =
				a.injection.name < b.injection.name
					? -1
					: a.injection.name > b.injection.name
						? 1
						: 0;
			return byName !== 0 ? byName : a.target - b.target;
		});
		return edges;
	});

	// Tarjan, iterative; node order (the model sort) makes components deterministic.
	const index = new Int32Array(providers.length).fill(-1);
	const low = new Int32Array(providers.length);
	const onStack = new Array<boolean>(providers.length).fill(false);
	const stack: number[] = [];
	const componentOf = new Int32Array(providers.length).fill(-1);
	let nextIndex = 0;
	let nextComponent = 0;

	const strongConnect = (start: number): void => {
		const call: Array<{ node: number; edgePos: number }> = [
			{ node: start, edgePos: 0 },
		];
		index[start] = nextIndex;
		low[start] = nextIndex;
		nextIndex += 1;
		stack.push(start);
		onStack[start] = true;
		while (call.length > 0) {
			const frame = call[call.length - 1];
			if (!frame) break; // unreachable: frame pushed above
			const edges = adjacency[frame.node] ?? [];
			if (frame.edgePos < edges.length) {
				const edge = edges[frame.edgePos];
				frame.edgePos += 1;
				if (edge === undefined) continue;
				if (index[edge.target] === -1) {
					index[edge.target] = nextIndex;
					low[edge.target] = nextIndex;
					nextIndex += 1;
					stack.push(edge.target);
					onStack[edge.target] = true;
					call.push({ node: edge.target, edgePos: 0 });
				} else if (onStack[edge.target]) {
					const own = low[frame.node];
					const other = low[edge.target];
					if (own !== undefined && other !== undefined && other < own) {
						low[frame.node] = other;
					}
				}
				continue;
			}
			call.pop();
			const parent = call[call.length - 1];
			if (parent) {
				const own = low[parent.node];
				const child = low[frame.node];
				if (own !== undefined && child !== undefined && child < own) {
					low[parent.node] = child;
				}
			}
			if (low[frame.node] === index[frame.node]) {
				for (;;) {
					const member = stack.pop();
					if (member === undefined) break;
					onStack[member] = false;
					componentOf[member] = nextComponent;
					if (member === frame.node) break;
				}
				nextComponent += 1;
			}
		}
	};

	for (const node of providers.keys()) {
		if (index[node] === -1) strongConnect(node);
	}

	// Group nodes per component, keep the model order inside each.
	const components = new Map<number, number[]>();
	for (const [node, component] of componentOf.entries()) {
		const members = components.get(component);
		if (members) {
			members.push(node);
		} else {
			components.set(component, [node]);
		}
	}

	// Components are keyed in discovery order; order the cycle output by the
	// canonical member's position in the model.
	const firstMember = (members: number[]): number => members[0] ?? -1;
	const cycles: DiCycle[] = [];
	for (const members of [...components.values()].sort(
		(a, b) => firstMember(a) - firstMember(b),
	)) {
		const memberSet = new Set(members);
		const selfLoop = members.some((member) =>
			(adjacency[member] ?? []).some((edge) => edge.target === member),
		);
		if (members.length < 2 && !selfLoop) continue;
		const canonical = members[0];
		if (canonical === undefined) continue;
		const pathIndices = cyclePath(canonical, memberSet, adjacency);
		if (!pathIndices) continue;
		const path = pathIndices.map((i) => providers[i]);
		const lastMember = pathIndices[pathIndices.length - 2];
		const closingConsumer =
			lastMember === undefined ? undefined : providers[lastMember];
		if (!closingConsumer) continue;
		const closingEdge = closingEdgeInjection(
			closingConsumer,
			providers[canonical],
		);
		if (!closingEdge) continue;
		cycles.push({
			path: path.filter(
				(entry): entry is NestProviderEntry => entry !== undefined,
			),
			pathText: path.map((entry) => entry?.className ?? "").join(" → "),
			closingEdge,
			closingConsumer,
			hasForwardRef: pathIndices.slice(0, -1).some((from, position) => {
				const edge = (adjacency[from] ?? []).find(
					(candidate) => candidate.target === pathIndices[position + 1],
				);
				return edge?.injection.forwardRef === true;
			}),
		});
	}
	return cycles;
}

/** First simple path canonical → … → canonical following sorted edges. */
function cyclePath(
	canonical: number,
	members: Set<number>,
	adjacency: Edge[][],
): number[] | undefined {
	const onPath = new Set<number>([canonical]);
	const dfs = (current: number): number[] | undefined => {
		for (const edge of adjacency[current] ?? []) {
			if (!members.has(edge.target)) continue;
			if (edge.target === canonical) return [current, canonical];
			if (onPath.has(edge.target)) continue;
			onPath.add(edge.target);
			const rest = dfs(edge.target);
			onPath.delete(edge.target);
			if (rest) return [current, ...rest];
		}
		return undefined;
	};
	return dfs(canonical);
}

/** The consumer's first injection whose name matches the canonical class name. */
function closingEdgeInjection(
	consumer: NestProviderEntry,
	canonical: NestProviderEntry | undefined,
): NestInjectionRef | undefined {
	if (!canonical) return undefined;
	return consumer.injections.find(
		(injection) => injection.name === canonical.className,
	);
}

/**
 * True when `providerName` is resolvable for `consumer`: it is not a known
 * provider class (nothing to check), the consumer has no owning module, any
 * `@Global` module exports it, any owning module provides it or imports a
 * module that exports it. Every unknown shape fails open (constitution §2):
 * unresolved metadata, import names without a model entry. The rule reports
 * only when this returns false — unresolvable from every owning module.
 */
export function isInjectionResolvable(
	model: NestAppModel,
	consumer: Pick<DiConsumer, "className">,
	providerName: string,
): boolean {
	const providerNames = new Set(model.providers.map((p) => p.className));
	if (!providerNames.has(providerName)) return true;
	const owners = model.modules.filter(
		(entry) =>
			entry.providers.includes(consumer.className) ||
			entry.controllers.includes(consumer.className),
	);
	if (owners.length === 0) return true;
	for (const entry of model.modules) {
		if (
			entry.global &&
			!entry.hasUnresolved &&
			entry.exports.includes(providerName)
		) {
			return true;
		}
	}
	return owners.some((owner) => reachableFrom(model, owner, providerName));
}

function reachableFrom(
	model: NestAppModel,
	start: NestModuleEntry,
	providerName: string,
): boolean {
	// Only the owning module's own providers satisfy an injection; imported
	// modules contribute their exports, transitively (Nest module semantics).
	if (start.hasUnresolved) return true;
	if (start.providers.includes(providerName)) return true;
	const visited = new Set<NestModuleEntry>([start]);
	const queue: NestModuleEntry[] = [start];
	while (queue.length > 0) {
		const entry = queue.shift();
		if (!entry) continue;
		for (const importedName of entry.imports) {
			const targets = model.modules.filter(
				(candidate) => candidate.className === importedName,
			);
			if (targets.length === 0) return true;
			for (const target of targets) {
				if (target.hasUnresolved) return true;
				if (target.exports.includes(providerName)) return true;
				if (!visited.has(target)) {
					visited.add(target);
					queue.push(target);
				}
			}
		}
	}
	return false;
}

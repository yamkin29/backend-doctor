import { describe, expect, it } from "vitest";
import type {
	NestAppModel,
	NestControllerEntry,
	NestInjectionRef,
	NestModuleEntry,
	NestProviderEntry,
} from "../../../src/framework/nest/model.js";
import {
	consumersInFile,
	findProviderCycles,
	isInjectionResolvable,
} from "../../../src/rules/nest/di-graph.js";

let fileSeq = 0;

/** Providers must carry distinct filePaths — model sort key. */
function provider(
	className: string,
	opts?: {
		filePath?: string;
		scope?: NestProviderEntry["scope"];
		injections?: NestInjectionRef[];
	},
): NestProviderEntry {
	fileSeq += 1;
	return {
		filePath: opts?.filePath ?? `/app/${fileSeq}-${className}.ts`,
		className,
		line: 3,
		column: 1,
		scope: opts?.scope ?? null,
		injections: opts?.injections ?? [],
		publicMethods: [],
	};
}

function injection(name: string, forwardRef = false): NestInjectionRef {
	return { name, forwardRef, decoratorNames: [], line: 5, column: 3 };
}

function module(
	className: string,
	lists: Partial<
		Pick<NestModuleEntry, "imports" | "providers" | "controllers" | "exports">
	>,
	opts?: { global?: boolean; hasUnresolved?: boolean; filePath?: string },
): NestModuleEntry {
	return {
		filePath: opts?.filePath ?? `/app/${className}.ts`,
		className,
		line: 1,
		column: 1,
		imports: lists.imports ?? [],
		providers: lists.providers ?? [],
		controllers: lists.controllers ?? [],
		exports: lists.exports ?? [],
		global: opts?.global ?? false,
		hasUnresolved: opts?.hasUnresolved ?? false,
	};
}

function model(
	entries: Partial<Pick<NestAppModel, "modules" | "providers" | "controllers">>,
): NestAppModel {
	const sort = (
		a: { filePath: string; className: string },
		b: { filePath: string; className: string },
	) =>
		a.filePath === b.filePath
			? a.className < b.className
				? -1
				: 1
			: a.filePath < b.filePath
				? -1
				: 1;
	return {
		modules: [...(entries.modules ?? [])].sort(sort),
		controllers: [...(entries.controllers ?? [])].sort(sort),
		providers: [...(entries.providers ?? [])].sort(sort),
		dtos: [],
		unresolved: [],
	};
}

describe("findProviderCycles (AC-8 machinery)", () => {
	it("finds a two-node cycle with a canonical path and closing edge", () => {
		const a = provider("AService", {
			filePath: "/app/a.service.ts",
			injections: [injection("BService")],
		});
		const b = provider("BService", {
			filePath: "/app/b.service.ts",
			injections: [injection("AService")],
		});
		const cycles = findProviderCycles(model({ providers: [a, b] }));
		expect(cycles).toHaveLength(1);
		expect(cycles[0]?.path.map((p) => p.className)).toEqual([
			"AService",
			"BService",
			"AService",
		]);
		expect(cycles[0]?.pathText).toBe("AService → BService → AService");
		expect(cycles[0]?.closingConsumer).toBe(b);
		expect(cycles[0]?.closingEdge).toEqual(injection("AService"));
		expect(cycles[0]?.hasForwardRef).toBe(false);
	});

	it("marks hasForwardRef when any path edge uses forwardRef", () => {
		const cycles = findProviderCycles(
			model({
				providers: [
					provider("AService", {
						filePath: "/app/a.service.ts",
						injections: [injection("BService", true)],
					}),
					provider("BService", {
						filePath: "/app/b.service.ts",
						injections: [injection("AService")],
					}),
				],
			}),
		);
		expect(cycles[0]?.hasForwardRef).toBe(true);
	});

	it("walks the lexicographically smallest edges through a three-node cycle", () => {
		const cycles = findProviderCycles(
			model({
				providers: [
					provider("AService", {
						filePath: "/app/a.service.ts",
						injections: [injection("CService"), injection("BService")],
					}),
					provider("BService", {
						filePath: "/app/b.service.ts",
						injections: [injection("AService")],
					}),
					provider("CService", {
						filePath: "/app/c.service.ts",
						injections: [injection("AService")],
					}),
				],
			}),
		);
		expect(cycles).toHaveLength(1);
		expect(cycles[0]?.pathText).toBe("AService → BService → AService");
		expect(cycles[0]?.closingConsumer.className).toBe("BService");
	});

	it("reports a self-injection as a one-member cycle", () => {
		const loops = provider("LoopService", {
			filePath: "/app/loop.service.ts",
			injections: [injection("LoopService")],
		});
		const cycles = findProviderCycles(model({ providers: [loops] }));
		expect(cycles).toHaveLength(1);
		expect(cycles[0]?.pathText).toBe("LoopService → LoopService");
		expect(cycles[0]?.closingConsumer).toBe(loops);
	});

	it("returns nothing for an acyclic graph", () => {
		const cycles = findProviderCycles(
			model({
				providers: [
					provider("AService", {
						filePath: "/app/a.service.ts",
						injections: [injection("BService")],
					}),
					provider("BService", {
						filePath: "/app/b.service.ts",
						injections: [injection("CService")],
					}),
					provider("CService", { filePath: "/app/c.service.ts" }),
				],
			}),
		);
		expect(cycles).toEqual([]);
	});

	it("yields one cycle per component, ordered by canonical member", () => {
		const z = provider("ZService", {
			filePath: "/app/z.service.ts",
			injections: [injection("YService")],
		});
		const y = provider("YService", {
			filePath: "/app/y.service.ts",
			injections: [injection("ZService")],
		});
		const c = provider("CService", {
			filePath: "/app/c.service.ts",
			injections: [injection("DService")],
		});
		const d = provider("DService", {
			filePath: "/app/d.service.ts",
			injections: [injection("CService")],
		});
		const cycles = findProviderCycles(model({ providers: [z, y, c, d] }));
		expect(cycles.map((cycle) => cycle.pathText)).toEqual([
			"CService → DService → CService",
			"YService → ZService → YService",
		]);
	});
});

describe("isInjectionResolvable (AC-7 machinery)", () => {
	const consumer = { className: "TasksController" };

	function ownersModel(
		modules: NestModuleEntry[],
		providerNames: string[],
	): NestAppModel {
		return model({
			modules,
			providers: providerNames.map((className) =>
				provider(className, { filePath: `/app/${className}.ts` }),
			),
		});
	}

	it("accepts a provider listed by the owning module itself", () => {
		const m = model({
			modules: [
				module("AppModule", { providers: ["TasksController", "TaskService"] }),
			],
			providers: [provider("TaskService")],
		});
		expect(isInjectionResolvable(m, consumer, "TaskService")).toBe(true);
	});

	it("accepts a provider exported by a transitively imported module", () => {
		const m = ownersModel(
			[
				module("AppModule", {
					controllers: ["TasksController"],
					imports: ["SharedModule"],
				}),
				module("SharedModule", { imports: ["CoreModule"] }),
				module("CoreModule", {
					providers: ["TaskService"],
					exports: ["TaskService"],
				}),
			],
			["TaskService"],
		);
		expect(isInjectionResolvable(m, consumer, "TaskService")).toBe(true);
	});

	it("does not treat a non-exported provider of an imported module as resolvable", () => {
		const m = ownersModel(
			[
				module("AppModule", {
					controllers: ["TasksController"],
					imports: ["FeatureModule"],
				}),
				module("FeatureModule", { providers: ["TaskService"] }),
			],
			["TaskService"],
		);
		expect(isInjectionResolvable(m, consumer, "TaskService")).toBe(false);
	});

	it("does not accept a re-export the owner does not import", () => {
		const m = ownersModel(
			[
				module("AppModule", {
					controllers: ["TasksController"],
					exports: ["TaskService"],
				}),
			],
			["TaskService"],
		);
		expect(isInjectionResolvable(m, consumer, "TaskService")).toBe(false);
	});

	it("accepts a provider exported by any @Global module", () => {
		const m = ownersModel(
			[
				module("AppModule", { controllers: ["TasksController"] }),
				module(
					"GlobalModule",
					{ providers: ["TaskService"], exports: ["TaskService"] },
					{ global: true },
				),
			],
			["TaskService"],
		);
		expect(isInjectionResolvable(m, consumer, "TaskService")).toBe(true);
	});

	it("fails open on unknown import names, unresolved metadata and unknown providers", () => {
		const unknownImport = ownersModel(
			[
				module("AppModule", {
					controllers: ["TasksController"],
					imports: ["ConfigModule"],
				}),
			],
			["TaskService"],
		);
		expect(isInjectionResolvable(unknownImport, consumer, "TaskService")).toBe(
			true,
		);

		const unresolvedOwner = ownersModel(
			[
				module(
					"AppModule",
					{ controllers: ["TasksController"], providers: [] },
					{ hasUnresolved: true },
				),
			],
			["TaskService"],
		);
		expect(
			isInjectionResolvable(unresolvedOwner, consumer, "TaskService"),
		).toBe(true);

		const unresolvedMidPath = ownersModel(
			[
				module("AppModule", {
					controllers: ["TasksController"],
					imports: ["FeatureModule"],
				}),
				module("FeatureModule", { exports: [] }, { hasUnresolved: true }),
			],
			["TaskService"],
		);
		expect(
			isInjectionResolvable(unresolvedMidPath, consumer, "TaskService"),
		).toBe(true);

		const unknownProvider = ownersModel(
			[module("AppModule", { controllers: ["TasksController"] })],
			[],
		);
		expect(isInjectionResolvable(unknownProvider, consumer, "Widget")).toBe(
			true,
		);
	});

	it("is silent without an owning module and flags only when every owner fails", () => {
		const orphan = ownersModel([], ["TaskService"]);
		expect(isInjectionResolvable(orphan, consumer, "TaskService")).toBe(true);

		const twoOwnersOneResolves = ownersModel(
			[
				module("FirstModule", { providers: ["TasksController"] }),
				module("SecondModule", {
					providers: ["TasksController", "TaskService"],
				}),
			],
			["TaskService"],
		);
		expect(
			isInjectionResolvable(twoOwnersOneResolves, consumer, "TaskService"),
		).toBe(true);

		const twoOwnersBothFail = ownersModel(
			[
				module("FirstModule", { providers: ["TasksController"] }),
				module("SecondModule", { providers: ["TasksController"] }),
			],
			["TaskService"],
		);
		expect(
			isInjectionResolvable(twoOwnersBothFail, consumer, "TaskService"),
		).toBe(false);
	});
});

describe("consumersInFile (rule plumbing)", () => {
	it("merges providers and controllers of one file; controllers have no scope", () => {
		const controller: NestControllerEntry = {
			filePath: "/app/tasks.controller.ts",
			className: "TasksController",
			line: 2,
			column: 1,
			route: "tasks",
			handlers: [],
			injections: [injection("TaskService")],
		};
		const inFile = provider("TaskService", {
			filePath: "/app/tasks.controller.ts",
			scope: "request",
			injections: [injection("ConfigService")],
		});
		const elsewhere = provider("OtherService", {
			filePath: "/app/other.service.ts",
		});

		const consumers = consumersInFile(
			model({
				providers: [inFile, elsewhere],
				controllers: [controller],
			}),
			"/app/tasks.controller.ts",
		);

		expect(consumers.map((c) => c.className)).toEqual([
			"TaskService",
			"TasksController",
		]);
		expect(consumers[0]?.scope).toBe("request");
		expect(consumers[1]?.scope).toBeUndefined();
		expect(consumers[1]?.injections).toEqual([injection("TaskService")]);
	});
});

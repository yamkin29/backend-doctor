// Observable-inertness probe (spec 020 AC-6): prints whether the fake
// client class carries the hook's wrap marker. Runs from the fixtures dir
// so the fixture-local @prisma/client resolves.
const { PrismaClient } = require("@prisma/client");
console.log(
	PrismaClient.__backendDoctorProbeDbWrapped === true ? "wrapped" : "native",
);

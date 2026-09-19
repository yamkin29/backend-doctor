// A deliberate violation set for engine tests (spec 003): exactly one eval
// and one new Function, at known positions.
const value = eval("1");
const dynamic = new Function("return 1");

export { dynamic, value };

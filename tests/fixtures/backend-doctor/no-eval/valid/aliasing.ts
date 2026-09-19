// Aliased eval is out of scope for this rule (precision over recall);
// see docs/rules/backend-doctor/no-eval.md.
const aliased = eval;

aliased("5 + 5");

// "evaluator" contains "eval" as a substring but is an ordinary function.
declare function evaluator(source: string): unknown;

evaluator("4 + 4");

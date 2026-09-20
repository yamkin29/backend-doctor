# backend-doctor/missing-global-validation-pipe

Reports Nest bootstraps that never register a global `ValidationPipe`.

- **Category:** Configuration
- **Default severity:** `warn`

## Problem

Without a global `ValidationPipe`, every `@Body()` parameter arrives as a
plain object: `class-validator` decorators on DTOs are never executed, so
missing fields, wrong types and excess properties all reach your services.
The DTO layer silently becomes documentation. Registering the pipe once at
the bootstrap is the single switch that turns the decorators on.

## Bad

```ts
// ❌ nothing validates request bodies
async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule);
	await app.listen(3000);
}
```

## Good

```ts
// ✅ the pipe validates (and strips) everything globally
import { ValidationPipe } from "@nestjs/common";

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule);
	app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
	await app.listen(3000);
}

// ✅ equivalent: provide the pipe under the APP_PIPE token
@Module({
	providers: [{ provide: APP_PIPE, useClass: ValidationPipe }],
})
export class AppModule {}
```

## Scope notes (precision over recall, constitution §2)

- Fires in files that call `NestFactory.create` / `createApplicationContext`
  / `createMicroservice`, at that call, once per file.
- A pipe counts as registered when the same file calls
  `useGlobalPipes(new ValidationPipe(…))` or any scanned module's providers
  list captures a `ValidationPipe` class reference (the `APP_PIPE` shape).
- Fails open: when any module's providers metadata is unreadable (spreads,
  factory-produced arrays, non-static metadata) the rule stays silent —
  absence of knowledge is never a finding.
- Pipe *options* (`whitelist`, `forbidNonWhitelisted`, `transform`) are not
  judged here; only presence.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/missing-global-validation-pipe": "error",
		// or silence it deliberately:
		// "backend-doctor/missing-global-validation-pipe": "off",
	},
});
```

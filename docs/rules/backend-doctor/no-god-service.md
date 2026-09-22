# backend-doctor/no-god-service

Reports providers that carry too many responsibilities — the service that
became the app.

- **Category:** Maintainability
- **Default severity:** `warn`

## Problem

A god service starts as a reasonable `UserService` and ends up injecting
half the codebase. Every feature change touches it, every test has to
construct it, and its name stops meaning anything. The reliable early
signal is breadth: too many injected collaborators (each one a domain it
mediates) or too many public methods (each one a responsibility).

## Bad

```ts
// ❌ six collaborators, a dozen public methods, one incoherent class
@Injectable()
export class UserService {
	constructor(
		private readonly db: DbService,
		private readonly mailer: MailerService,
		private readonly payments: PaymentsService,
		private readonly storage: StorageService,
		private readonly search: SearchService,
		private readonly audit: AuditService,
	) {}

	register(): void {}
	login(): void {}
	resetPassword(): void {}
	updateAvatar(): void {}
	exportData(): void {}
	deleteAccount(): void {}
	searchUsers(): void {}
	reindex(): void {}
	charge(): void {}
	refund(): void {}
	notify(): void {}
	audit(): void {}
}
```

## Good

```ts
// ✅ split along domain responsibilities
@Injectable()
export class UserAccountsService {
	constructor(
		private readonly db: DbService,
		private readonly mailer: MailerService,
	) {}
}

@Injectable()
export class UserBillingService {
	constructor(private readonly payments: PaymentsService) {}
}
```

## Scope notes (precision over recall, constitution §2)

- Two thresholds, one diagnostic: ≥ 6 constructor dependencies or ≥ 12
  public instance methods (both actual counts appear in the message). The
  line sits deliberately above the folk "5 collaborators" advice so ordinary
  services stay silent.
- Public methods exclude the constructor, static/private/protected methods
  and the Nest lifecycle hooks (`onModuleInit`, `onModuleDestroy`,
  `onApplicationBootstrap`, `beforeApplicationShutdown`,
  `onApplicationShutdown`).
- Only `@Injectable` providers are measured; controllers are not.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/no-god-service": "error",
		// or silence it deliberately:
		// "backend-doctor/no-god-service": "off",
	},
});
```

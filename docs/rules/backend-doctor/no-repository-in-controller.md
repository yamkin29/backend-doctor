# backend-doctor/no-repository-in-controller

Reports controllers that inject a repository directly, skipping the service
layer.

- **Category:** Architecture
- **Default severity:** `warn`

## Problem

Repositories are storage concerns. A controller that talks to one wires HTTP
handling straight to the database: no service owns the transaction, caching
or authorization rules around that access, and every other consumer has to
reimplement them. In Nest the controller should orchestrate services;
services own persistence.

## Bad

```ts
// ❌ HTTP handling coupled to storage
@Controller("users")
export class UsersController {
	constructor(
		@InjectRepository(UserEntity) private readonly users: UsersRepository,
	) {}

	@Get()
	list(): Promise<UserEntity[]> {
		return this.users.find();
	}
}
```

## Good

```ts
// ✅ the service owns the repository; the controller owns transport
@Controller("users")
export class UsersController {
	constructor(private readonly users: UsersService) {}

	@Get()
	list(): Promise<User[]> {
		return this.users.list();
	}

	// ✅ correct usage — a service may inject repositories
}

@Injectable()
export class UsersService {
	constructor(
		@InjectRepository(UserEntity) private readonly users: UsersRepository,
	) {}
}
```

## Scope notes (precision over recall, constitution §2)

- Recognizes three forms: a constructor parameter carrying
  `@InjectRepository(...)`, a parameter type name ending in `Repository`,
  and the exact names `PrismaService` / `PrismaClient` (name matching, as
  written — spec 009 convention; a database gateway named `DbService` is a
  documented recall hole).
- Fires per injection edge, at the parameter position; only controller
  constructors are inspected — providers injecting repositories are the
  intended pattern and never flagged.
- Storage-layer import graphs (`Controller → Service → Repository` enforced
  by file paths) belong to F013 (graph rules).

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/no-repository-in-controller": "error",
		// or silence it deliberately:
		// "backend-doctor/no-repository-in-controller": "off",
	},
});
```

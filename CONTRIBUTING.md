# Contributing Guidelines

Thank you for contributing to the **AI Voice Agent Platform**. This document outlines our engineering standards, coding conventions, testing expectations, and workflow processes.

---

## 1. Branch Naming Conventions

Use lowercase branch names prefixed with the change category:

| Category | Format | Example |
|---|---|---|
| **Feature** | `feature/<short-description>` | `feature/exotel-telephony-adapter` |
| **Bugfix** | `fix/<short-description>` | `fix/sentence-chunker-decimal-split` |
| **Chore / Infra** | `chore/<short-description>` | `chore/update-postgres-connection-pool` |
| **Documentation** | `docs/<short-description>` | `docs/add-telephony-setup-guide` |
| **Refactor** | `refactor/<short-description>` | `refactor/clean-tenant-dependencies` |

---

## 2. Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
<type>(<scope>): <short description in present tense>

[optional body explaining 'why' and context]

[optional footer(s), e.g. Closes #123]
```

### Supported Types:
- `feat`: A new user-facing or platform feature.
- `fix`: A bug fix.
- `docs`: Documentation changes only.
- `style`: Formatting, missing semicolons, etc.; no code change.
- `refactor`: Refactoring code without altering external behavior.
- `test`: Adding missing tests or correcting existing tests.
- `chore`: Build process, tooling, or dependency updates.

**Examples:**
- `feat(adapters): add Exotel telephony provider interface`
- `fix(audio): guard against splitting on Indian phone numbers in text chunker`
- `test(health): add deep readiness test for redis and postgres`

---

## 3. Coding Conventions & Standards

### Python (Backend)
- **Formatting & Linting**: Use **Ruff** (`ruff check .`, `ruff format .`). Line length is set to **100**.
- **Type Annotations**: All function signatures must include explicit type hints (`typing` / built-in generics).
- **Asynchronous Code**: Use `async`/`await` for all database, network, and provider I/O. Use `asyncio.to_thread` for CPU-heavy or blocking synchronous library calls.
- **Error Handling**: Raise domain exceptions inheriting from `AppException` (`app.core.exceptions`). Never silently catch exceptions (`except Exception: pass`).
- **SQLAlchemy 2.0 Style**: Use mapped columns (`Mapped[str] = mapped_column(...)`) and `select(...)` statements.

### TypeScript & React (Frontend)
- **Strict Mode**: TypeScript strict mode is enabled. Avoid `any`; use explicit interfaces and types.
- **Component Pattern**: Use functional components with typed props.
- **File Organization**: Group by feature under `src/features/<feature-name>/`.
- **CSS**: Use Tailwind CSS utility classes and `cn()` from `@/lib/utils` for dynamic class merging.

---

## 4. Testing Expectations

- **Test Coverage**: All new business logic, adapters, endpoints, and utilities must be accompanied by automated unit/integration tests in `backend/tests/`.
- **Pytest**: Run tests locally using `pytest -v tests/`.
- **No Mocking Overkill**: Test domain logic and models with real instances where possible; mock external network APIs (telephony carriers, cloud LLMs) using the adapter pattern.
- **Frontend Validation**: Run `tsc -b` and `npm run build` to verify type safety and bundle creation.

---

## 5. Pull Request Guidelines

1. **Keep PRs Focused**: Avoid giant pull requests mixing multiple unrelated features or refactors.
2. **Local Verification**: Ensure all tests, lint checks, and builds pass before requesting review.
3. **PR Description**: Include a clear summary of changes, rationale, and testing evidence.
4. **Code Review**: At least one approving review is required before merging into `develop` or `main`.


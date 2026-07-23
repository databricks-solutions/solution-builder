# Security Policy

## Reporting a Vulnerability

Please email **bugbounty@databricks.com** to report any security vulnerabilities in Databricks Solution Builder. We will acknowledge receipt of your report and strive to send you regular updates about our progress. If you're curious about the status of your disclosure, please feel free to email us again.

Do **not** open a public GitHub issue for a security vulnerability.

## Supported versions

Only the latest commit on `main` is actively maintained. Security fixes will be applied to `main` and tagged in a new release.

## What's in scope

- The Solution Builder app code (FastAPI backend + React frontend) in `app/`.
- The Solution Generator Skill content under `.claude/skills/databricks-solution-builder/`.
- The Asset Bundle deploy configuration in `app/databricks.yml`.

## What's not in scope

- Issues in dependencies — please report those upstream (Anthropic, Databricks SDK, FastAPI, etc.).
- Issues that require running the app with non-default, intentionally-insecure environment variables.
- Findings in customer-generated project content under `app/projects/` (those are user-owned and ephemeral).

## Dependency audit

GitHub Dependabot is enabled on this repo and opens PRs weekly for `pip`, `npm`, and `github-actions` updates. Critical CVEs are triaged on a best-effort basis.

# Releasing Sidecar

Sidecar publishes npm packages from GitHub Actions using npm trusted publishing.
The workflow uses npm Trusted Publishing instead of a long-lived npm token.
GitHub proves the workflow identity with OIDC, and npm allows publishing only
when each package trusts that exact workflow identity.

## Current Release Shape

- GitHub repository: `feyninc/sidecar`
- Workflow file: `.github/workflows/release.yml`
- GitHub Environment: `npm-publish`
- Allowed release refs: tags matching `v*`
- npm authentication: Trusted Publishing / OIDC
- npm dist-tag for normal releases: `latest`

The workflow builds and publishes package versions that already exist in the
package manifests. It does not calculate or bump versions.

## One-Time npm Setup

Each published package must have the same trusted publisher configured on
npmjs.com:

- `sidecar-ai`
- `create-sidecar-app`
- `@sidecar-ai/anthropic`
- `@sidecar-ai/auth`
- `@sidecar-ai/cli`
- `@sidecar-ai/client`
- `@sidecar-ai/compiler`
- `@sidecar-ai/core`
- `@sidecar-ai/native`
- `@sidecar-ai/openai`
- `@sidecar-ai/react`
- `@sidecar-ai/server`

For each package, go to Settings -> Trusted publishing and add:

- Provider: GitHub Actions
- Organization or user: `feyninc`
- Repository: `sidecar`
- Workflow filename: `release.yml`
- Environment name: `npm-publish`

Do not add npm tokens or release credentials to this repository. Use npm Trusted
Publishing for package publication.

## GitHub Release Protection

The publish job uses the `npm-publish` GitHub Environment. Configure that
environment in repository settings according to the project maintainer policy:

- Required reviewers: approved maintainers or a maintainer-owned release team
- Prevent self-review: follow the current maintainer policy
- Deployment branches and tags: selected tags matching `v*`

GitHub does not expose a workflow-level "any organization member" publisher
switch. Use an explicit maintainer-owned team if the reviewer list grows.

## Version Updates

Publishing requires changing versions in the repository first. npm publishes the
versions found in `package.json`.

Update every package that should be released:

```txt
packages/core/package.json
packages/auth/package.json
packages/client/package.json
packages/native/package.json
packages/react/package.json
packages/server/package.json
packages/compiler/package.json
packages/cli/package.json
packages/openai/package.json
packages/anthropic/package.json
packages/sidecar-ai/package.json
packages/create-sidecar-app/package.json
```

Also update internal Sidecar dependency pins. These are dependencies from one
Sidecar package to another Sidecar package. For example, if
`@sidecar-ai/compiler` is bumped to `0.1.0-alpha.2` and `@sidecar-ai/cli` should
use it, update `packages/cli/package.json`:

```json
{
  "dependencies": {
    "@sidecar-ai/compiler": "0.1.0-alpha.2"
  }
}
```

Common pins to check:

- `@sidecar-ai/cli` depends on `@sidecar-ai/compiler`, `@sidecar-ai/core`,
  `@sidecar-ai/server`, and `@sidecar-ai/auth`
- `@sidecar-ai/compiler` depends on `@sidecar-ai/core`
- `@sidecar-ai/server` depends on `@sidecar-ai/core` and `@sidecar-ai/auth`
- `@sidecar-ai/native` depends on `@sidecar-ai/client`
- `@sidecar-ai/react` depends on `@sidecar-ai/client` and `@sidecar-ai/core`
- `@sidecar-ai/openai` depends on `@sidecar-ai/core` and `@sidecar-ai/native`
- `@sidecar-ai/anthropic` depends on `@sidecar-ai/native`
- `sidecar-ai` depends on the core runtime packages users get from the base
  install

Also update:

- `sidecarVersion` in `packages/create-sidecar-app/src/index.ts`
- example package versions and dependencies when examples should track the
  released version

## Local Checks

Run these before creating a GitHub Release:

```sh
npm run typecheck
npm test
npm run build
npm pack --workspaces --dry-run
```

To exercise the publish script locally without uploading:

```sh
npm run release:publish -- --tag dry-run --dry-run
```

The script publishes packages in dependency order. In a real publish, it skips
exact package versions that already exist on npm. In dry-run mode, it still runs
`npm publish --dry-run` for every package so the command shape and package
contents are exercised.

## Cutting a Release

1. Update package versions, internal Sidecar dependency pins, scaffolder version,
   and examples as needed.
2. Run the local checks.
3. Commit and push the version changes to `main`.
4. Create and publish a GitHub Release with a matching `v*` tag, for example
   `v0.1.0-alpha.2`.
5. GitHub Actions starts the `Release` workflow.
6. The workflow waits for approval on the `npm-publish` environment.
7. A different approved reviewer approves the deployment.
8. The workflow runs typecheck, tests, build, package verification, and npm
   publishing.

## GitHub Dry Run

Use workflow dispatch when you want to verify the GitHub runner path without
publishing. Replace the ref with a temporary `v*` dry-run tag:

```sh
gh workflow run release.yml \
  --repo feyninc/sidecar \
  --ref <temporary-v-tag> \
  -f dist-tag=dry-run \
  -f dry-run=true
```

The ref must be a `v*` tag because the `npm-publish` environment only allows
release-like tags. The dry-run workflow still requires environment approval.

Dry-run proves:

- workflow dispatch works
- the `npm-publish` environment gate works
- build, tests, and package verification work in GitHub Actions
- `npm publish --dry-run` works for every package

Dry-run does not fully prove npm OIDC upload acceptance because it does not
upload a new package version. The only full end-to-end publish proof is a real
release with new package versions.

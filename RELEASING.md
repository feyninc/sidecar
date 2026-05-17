# Releasing Sidecar

Sidecar publishes npm packages from GitHub Actions using npm trusted publishing.
This avoids long-lived npm publish tokens and lets npm attach provenance to the
published packages.

## One-Time npm Setup

Configure each published package on npmjs.com:

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
- Organization or user: `chonkie-inc`
- Repository: `sidecar`
- Workflow filename: `release.yml`
- Environment name: leave blank

npm requires this package-level allowlist before GitHub Actions can publish with
OIDC. The workflow will fail at the publish step until every package being
released has this trusted publisher configured.

## Cutting a Release

1. Update package versions and internal package dependency versions.
2. Run the local checks:

   ```sh
   npm run typecheck
   npm test
   npm run build
   npm pack --workspaces --dry-run
   ```

3. Commit and push the version changes.
4. Create and publish a GitHub Release for the matching tag, for example
   `v0.1.0-alpha.2`.
5. The `Release` workflow builds, tests, verifies package contents, and publishes
   any package versions that are not already present on npm.

The workflow publishes with the npm `latest` dist-tag by default. Use the manual
`workflow_dispatch` path when you need a different dist-tag or a dry-run publish.

## Manual Dry Run

After `npm run build`, you can test the publish script without uploading:

```sh
npm run release:publish -- --dry-run
```

The script publishes packages in dependency order and skips exact versions that
already exist on npm.

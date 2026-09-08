# Release a version

Releases run through changesets and GitHub Actions. You add a changeset in your pull request. The `Release` workflow turns merged changesets into a version pull request, then into an npm publish.

## Add a changeset to a pull request

1. Run `bun run changeset` in the repository root.
2. Pick `vecstore-sdk`, pick the bump type, and write one sentence about the change for the changelog.
3. Commit the generated file in `.changeset/`.

The `Verify Changesets` workflow fails a pull request that changes `packages/*/src` or a package manifest without a changeset. To skip the check for a change that needs no release note, add the `skip-changeset` label to the pull request.

## Ship the release

1. Merge pull requests into `main`. On each merge that touches `.changeset/`, the `Release` workflow opens or updates a pull request named "chore(release): version packages". That pull request bumps versions, writes `CHANGELOG.md`, and deletes the consumed changesets.
2. Review the changelog in that pull request and merge it.
3. The `Release` workflow runs again, builds `vecstore-sdk`, publishes it to npm with provenance, and creates a GitHub release with a git tag.

## Publish a snapshot

To publish a preview build without a version bump, run the `Release` workflow from the **Actions** tab and check **Publish a snapshot release**. The workflow publishes a version tagged `snapshot` with the short commit SHA in its version string. Install it with the `snapshot` dist-tag:

```bash
bun add vecstore-sdk@snapshot
```

## One-time setup

The workflow needs three things that live outside the repository.

1. In the repository **Settings**, under **Actions**, enable **Allow GitHub Actions to create and approve pull requests**. Without it, the version pull request step fails with a permissions error.
2. Publish the first version of `vecstore-sdk` to npm by hand, because npm attaches a trusted publisher only to a package that exists.
3. On npmjs.com, open the package settings and add a trusted publisher for the repository `PunGrumpy/vecstore-sdk` with the workflow file `release.yml`. From then on, the workflow publishes with an OpenID Connect token and needs no npm token secret.

The workflow sets up Node.js 24 next to Bun because trusted publishing needs npm 11.5.1 or later, and `changeset publish` calls npm. The release job also checks that the repository owner is `PunGrumpy`, so a fork that runs the workflow does not try to publish.

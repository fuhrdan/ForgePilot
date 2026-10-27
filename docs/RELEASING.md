# Release process

ForgePilot releases are tag-driven.

## Preconditions

From a clean checkout:

```bash
npm test
npm run check
```

The package version, installer version, README release reference, required repository metadata, and release files must agree.

## Build the Windows release package locally

On Windows PowerShell:

```powershell
.\scripts\package-release.ps1
```

This creates:

```text
dist/
  ForgePilot-vX.Y.Z-windows.zip
  ForgePilot-vX.Y.Z-windows.zip.sha256
```

The ZIP contains a top-level `ForgePilot-vX.Y.Z` directory. The one-click installer is at the root of that directory after extraction.

## Publish through GitHub Actions

1. Update `package.json`, `CHANGELOG.md`, and `docs/releases/vX.Y.Z.md`.
2. Commit and push the release commit.
3. Create and push the matching tag:

```bash
git tag -a vX.Y.Z -m "ForgePilot vX.Y.Z"
git push origin vX.Y.Z
```

`.github/workflows/release.yml` will:

- check out the tagged commit;
- install Node.js 22;
- run release-readiness checks;
- run the full test suite;
- package the one-click Windows ZIP;
- verify its SHA-256;
- create the GitHub Release;
- attach the ZIP and checksum.

The workflow refuses to publish if the Git tag and `package.json` version disagree.

## Manual safety check

After GitHub publishes the release, download the release ZIP on a clean Windows machine and verify:

1. `INSTALL_FORGEPILOT.cmd` completes;
2. the desktop shortcut launches ForgePilot;
3. `forgepilot --version` matches the tag;
4. `forgepilot health` succeeds or clearly reports a limited-resource state;
5. a simple one-prompt build reaches PASS or returns a bounded explicit failure.

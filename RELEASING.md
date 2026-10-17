# Releasing

1. Set the version in `package.json` (`npm version 0.9.1 --no-git-tag-version`) and commit.
2. Check the installer locally (optional; CI does the same):

   ```sh
   npm run dist            # release/<version>/CallMissed-Studio-Setup-<version>-x64.exe
   npm run test:packaged   # opens the packaged app, detects text, exports a PDF
   ```

3. Tag and push: `git tag v0.9.1 && git push origin v0.9.1`.
   The **Release** workflow (`.github/workflows/release.yml`) runs typecheck and unit tests, builds the
   installer, smoke-tests the packaged app and attaches the installer to the `v0.9.1` GitHub release
   (creating it with generated notes if it does not exist yet).
4. Edit the release notes on GitHub if needed.

## Notes

- The installer is **not code-signed** yet, so Windows SmartScreen warns on first run. Signing
  (SignPath Foundation or Azure Artifact Signing) is required before 1.0.0.
- There is no auto-update yet: users download new versions from the Releases page. Installing over
  an older version keeps their projects, models and API key.
- After adding or upgrading dependencies, models or fonts, regenerate the licence list:
  `node tools/licenses/generate.mjs && npx prettier --write THIRD_PARTY_LICENSES.md`.

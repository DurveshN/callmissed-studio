# Contributing

Thanks for helping. Bug reports and pull requests are welcome on
[GitHub](https://github.com/DurveshN/callmissed-studio).

- **Bugs:** say what you did, what you expected and what happened, with your Windows version and,
  if you can, a file that shows the problem (never share private documents).
- **Pull requests:** keep them focused. Before opening one, run:

  ```sh
  npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e
  ```

  CI runs the same checks on Windows.

- Read [CONTEXT.md](CONTEXT.md) first: it explains the architecture, the pinned toolchain and the
  decisions behind them. Update it when you change something it describes.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat(pdf): …`, `fix(ai): …`).
- New dependencies, fonts or models must have a licence compatible with MIT distribution; then
  regenerate `THIRD_PARTY_LICENSES.md` (see [RELEASING.md](RELEASING.md)).

By contributing you agree that your work is released under the [MIT licence](LICENSE).

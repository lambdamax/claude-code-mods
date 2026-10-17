# Contributing

Issues and pull requests are welcome.

## Layout

One folder per mod under `plugins/`, each a complete plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json`, a hooks module, tests, README, LICENSE). New mods also need an entry in `.claude-plugin/marketplace.json` and a line in `plugins/all-mods/.claude-plugin/plugin.json` `dependencies` so the bundle installs them.

## Before opening a PR

```
claude plugin validate .                 # marketplace
claude plugin validate plugins/<mod>     # each changed mod
claude plugin test plugins/<mod>         # its *.test.ts files
```

Every mod needs at least one `*.test.ts(x)` for the behaviour it adds. A mod that keeps values in `$.state` declares them in `types/index.d.ts`.

`.claude-plugin/types/` and `tsconfig.json`'s `extends` target are written by the Claude Code engine the first time a mod loads (`claude --plugin-dir plugins/<mod>`); they are git-ignored. To type-check, load the mod once, then `tsc -p plugins/<mod>`.

## Guidelines

- Keep a mod self-contained: no reads outside its own folder, no network calls, no secrets. A mod that guards (denies tool calls or prompts) hooks with `.catch` so a failure can't silently pass or block.
- Match the surrounding style: comments explain why, not what.
- Bump `version` in the mod's `plugin.json` and the marketplace entry together, and add a line to `CHANGELOG.md`.
- Never commit raw screen recordings (`.mov`/`.mp4` are git-ignored); convert demos to a short GIF under ~3 MB and optimized screenshots, and put them in `docs/media/`.

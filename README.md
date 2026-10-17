# claude-code-mods

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Claude Code plugin marketplace](https://img.shields.io/badge/Claude%20Code-plugin%20marketplace-D97757?logo=anthropic&logoColor=white)](#install)
[![Claude Code mods](https://img.shields.io/badge/Claude%20Code-mods-8A7FBF)](#claude-code-mods)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](plugins)

A collection of [Claude Code](https://claude.com/claude-code) mods: small plugins that change Claude's own interface. Each mod installs on its own from this repository, which is a plugin marketplace.

| Mod | What it adds | Command | Platform |
| --- | --- | --- | --- |
| [`usage-pane`](plugins/usage-pane) | A live pane beside the chat: tokens, API-equivalent spend, context fill, recent prompts, tool calls and subagents | `/usage-pane` | any |
| [`context-bar`](plugins/context-bar) | A stacked context-window bar above the prompt, one color per `/context` category | `/context-bar` | any |
| [`speak`](plugins/speak) | Reads Claude's final reply aloud, picking a voice by language | `/speak` | macOS |
| [`all-mods`](plugins/all-mods) | Bundle: installs the three mods above in one step | none | macOS (via `speak`) |

## Install

**Everything at once** (installs all three mods):

```
/plugin install all-mods --marketplace mattsebastianh/claude-code-mods
```

**Or pick what you want**, in a Claude Code terminal session:

```
/plugin install usage-pane --marketplace mattsebastianh/claude-code-mods
/plugin install context-bar --marketplace mattsebastianh/claude-code-mods
/plugin install speak --marketplace mattsebastianh/claude-code-mods
```

Answer `y` to "Add marketplace?", then pick a scope (user scope keeps the mod in every session). From a shell:

```
claude plugin install all-mods --marketplace mattsebastianh/claude-code-mods
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `mattsebastianh/claude-code-mods`, then **Add plugin**.

Each mod is a hooks-only plugin: once installed it is active in that session with no reload.

### Try it without installing

```
git clone https://github.com/mattsebastianh/claude-code-mods
claude --plugin-dir ./claude-code-mods/plugins/usage-pane
```

Repeat `--plugin-dir` to load several.

## Demos

**`usage-pane`** tracking two background subagents as they launch, wait (hollow dot, clock still ticking) and finish (green):

![usage-pane tracking background subagents live](docs/media/usage-pane-demo.gif)

### The three mods

| `usage-pane` | `context-bar` and `speak` |
| --- | --- |
| <img src="docs/media/usage-pane.png" alt="usage-pane: usage, prompts, tool calls and subagents" width="300"> | **`context-bar`**: one color per `/context` category, above the prompt<br><img src="docs/media/context-bar.png" alt="context-bar: stacked context-window bar and legend" width="620"><br><br>**`speak`**: toggle with `/speak`; the status line shows what applies right now<br><img src="docs/media/speak-command.png" alt="/speak command output" width="300"> <img src="docs/media/speak-status.png" alt="speak status line" width="300"> |

## Compatibility

Developed and tested against Claude Code `2.1.302`. Mods use the plugin-authoring hooks API, which is still evolving; if a mod misbehaves on a newer build, please [open an issue](../../issues) with the version.

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace listing every mod
plugins/<mod>/                    one self-contained plugin per folder
  .claude-plugin/plugin.json      manifest
  hooks/hooks.json                points at the hooks module
  hooks/register.ts(x)            the mod
  README.md  LICENSE
docs/                             screenshots and the release plan
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)

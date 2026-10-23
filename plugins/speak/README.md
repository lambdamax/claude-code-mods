# speak

[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-8A7FBF)](../../README.md#claude-code-mods)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple&logoColor=white)](#install)

Reads Claude's final reply aloud with macOS `say`. Code blocks, tables, links and markdown markup are stripped first so it reads like prose. The voice is chosen from the reply's language (Premium, then Enhanced voices preferred); when the language is unclear or already matches your system voice, the system voice is kept.

<img src="../../docs/media/speak-command.png" alt="/speak command output" width="300"> <img src="../../docs/media/speak-status.png" alt="speak status line" width="300">

**macOS only**: it uses `say` and `osascript`.

## Install

```
/plugin install speak --marketplace lambdamax/claude-code-mods
```

## Use

| Command | Effect |
| --- | --- |
| `/speak` | toggle spoken replies |
| `/speak on` / `/speak off` | set explicitly |
| `/speak pause` / `/speak resume` | pause, then pick up a couple of words before the cut |
| `/speak stop` | silence the current reply |
| `/speak last` | replay the latest reply, even while speaking is off |

The status line shows what applies right now. The on/off choice persists across sessions.

Only the main agent's final answer is spoken, never subagent turns.

## Develop

```
claude plugin validate .
claude plugin test .
```

[MIT](LICENSE)

# context-bar

[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-8A7FBF)](../../README.md#claude-code-mods)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A stacked context-window bar above the prompt, one color per category of the `/context` breakdown (system prompt, system tools, MCP instructions, custom agents, skills, messages), with a legend and the total against your window size.

![context bar](../../docs/media/context-bar.png)

## Install

```
/plugin install context-bar --marketplace lambdamax/claude-code-mods
```

## Use

`/context-bar` toggles the bar. It refreshes after every prompt and every finished turn, and draws nothing until the first breakdown exists.

## Develop

```
claude plugin validate .
claude plugin test .
```

[MIT](LICENSE)

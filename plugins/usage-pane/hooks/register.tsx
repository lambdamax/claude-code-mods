import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { AgentRow, CallRow, ContextFill, PromptTokens, ToolTally } from '../types'

// The usage pane sits beside the chat: docked in fullscreen, above the prompt
// otherwise. It starts closed in every new session; the session clock on it
// ticks once a second while it is open.
const PANE = 'usage-pane'
const TITLE = 'Usage'
const REFRESH_MS = 1000
// The dock width asked for; a width the person drags the dock to wins.
const PANE_COLUMNS = 38

// The rows each section shows: the usage cards, then the latest prompts, tool calls and
// subagents, one row each.
const USAGE_ROWS = 5
const PROMPT_ROWS = 6
const CALL_ROWS = 6
const AGENT_ROWS = 6
// How long a finished tool call stays listed; a running one stays until it ends.
const CALL_KEEP_MS = 2 * 60 * 1000
// A section's frame lines, the top one carrying its title, and a blank row inside each.
const SECTION_CHROME = 4
// Every section is as tall as the tallest needs, however much or little it holds; a
// shorter one's spare rows fall below its content.
const SECTION_HEIGHT = Math.max(USAGE_ROWS, PROMPT_ROWS, CALL_ROWS, AGENT_ROWS) + SECTION_CHROME
// The usage cards' labels, padded past the longest (CONTEXT, SESSION) so the values
// line up after them, two spaces clear.
const LABEL_WIDTH = 8
// The context bar's length, at the right end of its card, and the least space kept
// between it and the percent; the bar is shorter where the card is.
const BAR_WIDTH = 11
const BAR_GAP = 3
// How many of each are kept; more than are shown, so nothing jumps as rows go.
const KEPT = 20

// The panel's accent (the theme's Claude orange), the purple of the tags set into the
// frames' top right, and the context bar's track.
const ACCENT = 'claude'
const TAG = 'rgb(200,180,240)'
const TRACK = 'rgb(70,70,66)'

const promptTokens = atom({ plugin: 'usage-pane', key: 'promptTokens' } as const, null as PromptTokens | null)
const costUsd = atom({ plugin: 'usage-pane', key: 'costUsd' } as const, 0)
const context = atom({ plugin: 'usage-pane', key: 'context' } as const, null as ContextFill | null)
const tools = atom({ plugin: 'usage-pane', key: 'tools' } as const, { total: 0, byName: {} } as ToolTally)
const prompts = atom({ plugin: 'usage-pane', key: 'prompts' } as const, [] as string[])
const promptTotal = atom({ plugin: 'usage-pane', key: 'promptTotal' } as const, 0)
const calls = atom({ plugin: 'usage-pane', key: 'calls' } as const, [] as CallRow[])
const agents = atom({ plugin: 'usage-pane', key: 'agents' } as const, [] as AgentRow[])
const startedAt = atom({ plugin: 'usage-pane', key: 'startedAt' } as const, 0)
const now = atom({ plugin: 'usage-pane', key: 'now' } as const, 0)
const isShown = atom({ plugin: 'usage-pane', key: 'isShown' } as const, false)
const isWorking = atom({ plugin: 'usage-pane', key: 'isWorking' } as const, false)

export const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

export const formatUsd = (usd: number): string =>
  usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`

export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v: number) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// A model id as people say it: claude-opus-5-5 is Opus 5.5, a [1m] context suffix 1M.
export const formatModel = (id: string): string => {
  const isLong = /\[1m\]$/i.test(id)
  const parts = id.replace(/\[1m\]$/i, '').replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-')
  const family = parts.filter(p => !/^\d+$/.test(p)).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
  const version = parts.filter(p => /^\d+$/.test(p)).join('.')
  return [family, version].filter(Boolean).join(' ') + (isLong ? ' · 1M' : '')
}

// Filled cells of a bar `width` wide for `percent`, held to 0..width.
export const filledCells = (percent: number, width: number): number =>
  Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

// The longest title, and the longest tag beside it, that fit `room` cells with a space
// between: a shorter title keeps a tag, and only when none fits is the tag dropped.
// Narrow panes get the short forms.
export const heading = (room: number, titles: string[], tags: string[]) => {
  for (const title of titles) {
    for (const tag of tags) if (title.length + 1 + tag.length <= room) return { title, tag }
  }
  return { title: titles.find(title => title.length <= room) ?? titles.at(-1) ?? '', tag: '' }
}

// The sections' titles, longest form first.
const USAGE_TITLES = ['Usage']
const PROMPT_TITLES = ['Prompts']
const CALL_TITLES = ['Tool calls', 'Tools']
const AGENT_TITLES = ['Subagents', 'Agents']

// A section's top frame line, `width` cells, with its title set into the border:
// `╭─ Prompts 12 ─────── latest ─╮`. The longest title and tag that leave a dash
// between them; the tag gives way before the title is shortened.
export const frameTop = (width: number, titles: string[], count: string, tags: string[]) => {
  const countPart = count === '' ? '' : ` ${count}`
  // `╭─ ` and ` ─╮` take 6 cells, and the dash run between title and tag ` ─ ` 3 at least.
  const { title, tag } = heading(width - 8 - countPart.length, titles, tags)
  const used = 3 + title.length + countPart.length + 1 + (tag === '' ? 2 : 1 + tag.length + 3)
  return { title, count: countPart, fill: '─'.repeat(Math.max(1, width - used)), tag }
}

// What a frameTop line reads, end to end.
export const frameTopText = (top: ReturnType<typeof frameTop>) =>
  `╭─ ${top.title}${top.count} ${top.fill}${top.tag === '' ? '─╮' : ` ${top.tag} ─╮`}`

// A prompt as one line, the way the pane lists it and finds its row.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

// Cuts a line to `width` cells, an ellipsis where it was cut.
export const clip = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`

// The argument that says what a call is about: a file by its name, a command's first line.
const DETAIL_KEYS = ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'url', 'query', 'skill', 'description', 'prompt']

export const callDetail = (args: Record<string, unknown>): string => {
  for (const key of DETAIL_KEYS) {
    const value = args[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    const line = value.trim().split('\n')[0] ?? ''
    return key.endsWith('path') ? (line.split('/').pop() ?? line) : line
  }
  return ''
}

// Opens the pane and remembers it is wanted, so a reload keeps the clock going.
async function openPane($: EngineInterface) {
  await update($, isShown, () => true)
  await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
}

async function isPaneOpen($: EngineInterface) {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

// Moves the clock the pane reads, which redraws it, while the pane is wanted.
async function tickClock($: EngineInterface) {
  if (await read($, isShown)) {
    await syncAgents($)
    const at = await $.clock.now()
    await update($, now, () => at)
  }
}

// A row's status for where the engine says an agent's loop stands between its turns:
// held on its own background work or on a message is waiting, ended is done or failed.
// A running loop is left to the turn events, which see a turn start and end first.
export const statusFromEngine = (status: AgentStatus): AgentRow['status'] | undefined =>
  status === 'waiting' || status === 'idle' || status === 'pending' ? 'waiting'
  : status === 'completed' ? 'done'
  : status === 'failed' || status === 'killed' ? 'failed'
  : undefined

// Brings the listed subagents' rows in line with the engine's own record of them.
async function syncAgents($: EngineInterface) {
  const rows = await read($, agents)
  if (rows.length === 0) return
  const listed = await $.agent.list().catch(() => undefined)
  if (listed === undefined) return
  const statusOf = new Map(listed.map(info => [info.id, statusFromEngine(info.status)]))
  if (!rows.some(row => { const status = statusOf.get(row.id); return status !== undefined && status !== row.status })) return
  const at = await $.clock.now()
  await update($, agents, list =>
    list.map(row => {
      const status = statusOf.get(row.id)
      if (status === undefined || status === row.status) return row
      return { ...row, status, endedAt: status === 'waiting' ? undefined : (row.endedAt ?? at) }
    }),
  ).catch(() => undefined)
}

let tick: Timer | undefined

// Marks a subagent running or done; done stops its clock, running again starts it on.
// The engine's record then tells done from waiting (see syncAgents).
async function setAgentStatus($: EngineInterface, id: string, status: AgentRow['status']) {
  const at = await $.clock.now()
  await update($, agents, list =>
    list.map(one => (one.id === id ? { ...one, status, endedAt: status === 'running' || status === 'waiting' ? undefined : at } : one)),
  ).catch(() => undefined)
}

// Each prompt's row in the transcript, by its text as the pane shows it: the id
// `$.ui.scroll` takes to bring that message into view. Learned as the rows are drawn;
// the same text sent twice points at the latest.
const rowOfPrompt = new Map<string, string>()

// Scrolls the transcript to a row (a prompt's message, a tool call's row by its
// tool_use_id), or says why it can't.
async function showRow($: EngineInterface, requestId: string, what: string) {
  const moved = await $.ui.scroll({ to: { requestId }, block: 'start' }).catch(() => ({ deny: 'failed' }))
  // Refused outside fullscreen, once the row has left the rows the transcript keeps
  // drawn, and for a subagent's call, whose row is in that agent's transcript.
  if (moved.deny) $.ui.toast(`Couldn't scroll to that ${what}.`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-pane',
      description: 'Toggle the usage pane beside the chat',
    })

    // A new session (or a /clear) starts with the pane closed and every tally at zero;
    // a reload of this module mid-session keeps both.
    const usage = await $.session.usage()
    if ((await read($, startedAt)) !== usage.startedAt) {
      await update($, startedAt, () => usage.startedAt)
      await update($, tools, () => ({ total: 0, byName: {} }))
      await update($, promptTokens, () => null)
      await update($, prompts, () => [])
      await update($, promptTotal, () => 0)
      await update($, calls, () => [])
      await update($, agents, () => [])
      await update($, isShown, () => false)
      if (await isPaneOpen($)) await $.ui.close({ id: PANE })
    }
    await update($, costUsd, () => usage.cost?.usd ?? 0)
    await update($, context, () => usage.context)

    tick?.cancel()
    tick = $.clock.every(REFRESH_MS, () => void tickClock($).catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'usage-pane' }, async $ => {
    if (await isPaneOpen($)) {
      await update($, isShown, () => false)
      await $.ui.close({ id: PANE })
      return { text: 'Usage pane hidden.' }
    }
    await openPane($)
    return { text: 'Usage pane shown.' }
  })

  // Closed from its own mark or key: stay closed until asked again.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isShown, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The person's own prompts, newest first; slash commands and hidden prompts left out.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta) {
      const text = oneLine(e.text)
      if (text !== '') {
        await update($, prompts, list => [text, ...list].slice(0, KEPT)).catch(() => undefined)
        await update($, promptTotal, n => n + 1).catch(() => undefined)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Learns where each of the person's prompts sits in the transcript; draws nothing.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.props.origin.kind !== 'task-notification' && e.props.from === undefined) {
      rowOfPrompt.set(oneLine(e.props.text), e.requestId)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, promptTokens, () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }))
      await update($, isWorking, () => true)
    } else {
      // A teammate woken by a message runs again.
      await setAgentStatus($, e.agentId, 'running')
    }

    return next(e)
  })

  // Each subagent the session starts, newest first, once it has started.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    const id = ran.agentId
    if (id !== undefined) {
      const startedAt = await $.clock.now()
      const row: AgentRow = {
        id,
        toolUseId: e.tool_use_id,
        type: e.subagentType,
        description: oneLine(e.description),
        model: ran.model ?? '',
        tokens: 0,
        status: 'running',
        startedAt,
      }
      await update($, agents, list => [row, ...list.filter(one => one.id !== id)].slice(0, KEPT)).catch(() => undefined)
    }
    return ran
  })

  // Each model response of the prompt (subagents' included) adds its tokens as
  // it lands, so the figure climbs live instead of waiting for the turn's end.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const u = response.usage
    if (u) {
      const agentId = e.agentId
      if (agentId !== undefined) {
        const spent = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        await update($, agents, list =>
          list.map(one => (one.id === agentId ? { ...one, tokens: one.tokens + spent } : one)),
        ).catch(() => undefined)
      }
      await update($, promptTokens, t => ({
        input: (t?.input ?? 0) + u.input_tokens,
        output: (t?.output ?? 0) + u.output_tokens,
        cacheRead: (t?.cacheRead ?? 0) + u.cache_read_input_tokens,
        cacheWrite: (t?.cacheWrite ?? 0) + u.cache_creation_input_tokens,
      })).catch(() => undefined)
    }

    return response
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // Done for now; the engine's record, read after the turn ends, may say it waits.
      await setAgentStatus($, e.agentId, 'done')
      const ran = await next(e)
      await syncAgents($).catch(() => undefined)
      return ran
    }
    await update($, isWorking, () => false)
    const usage = await $.session.usage()
    await update($, costUsd, () => usage.cost?.usd ?? 0)
    await update($, context, () => usage.context)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.cost) {
      const spent = e.cost.usd
      await update($, costUsd, () => spent)
    }
    await update($, context, () => e.context)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A tally that fails to write must never hold up the tool call itself.
    const startedAt = await $.clock.now().catch(() => 0)
    const row: CallRow = { id: e.tool_use_id, tool: e.tool, detail: callDetail(e), status: 'running', startedAt }
    await update($, tools, t => ({
      total: t.total + 1,
      byName: { ...t.byName, [e.tool]: (t.byName[e.tool] ?? 0) + 1 },
    })).catch(() => undefined)
    await update($, calls, list => [row, ...list].slice(0, KEPT)).catch(() => undefined)

    const settle = async (status: CallRow['status']) => {
      const endedAt = await $.clock.now().catch(() => startedAt)
      await update($, calls, list => list.map(one => (one.id === row.id ? { ...one, status, endedAt } : one))).catch(() => undefined)
    }
    try {
      const ran = await next(e)
      await settle('deny' in ran || ran.isError ? 'failed' : 'done')
      return ran
    } catch (error) {
      await settle('failed')
      throw error
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const t = await read($, promptTokens)
    const ctx = await read($, context)
    const began = await read($, startedAt)
    // Read so the tick redraws the pane; the time itself is the engine's.
    await read($, now)
    const at = await $.clock.now()
    const working = await read($, isWorking)
    // Read at each draw, so a /model switch shows within the second.
    const modelId = await $.session.model().catch(() => '')
    const latestPrompts = (await read($, prompts)).slice(0, PROMPT_ROWS)
    // Running calls, and those that ended in the last two minutes.
    const latestCalls = (await read($, calls))
      .filter(call => call.status === 'running' || (call.endedAt !== undefined && at - call.endedAt < CALL_KEEP_MS))
      .slice(0, CALL_ROWS)
    // How long each listed call ran (runs, while running), padded to the widest shown.
    const callTimes = latestCalls.map(call => formatElapsed((call.endedAt ?? at) - call.startedAt))
    const callTimeWidth = Math.max(0, ...callTimes.map(one => one.length))
    const allAgents = await read($, agents)
    const latestAgents = allAgents.slice(0, AGENT_ROWS)
    const agentTokens = formatTokens(allAgents.reduce((sum, one) => sum + one.tokens, 0))
    // Each listed subagent's tokens and how long it has run (ran, once done), padded to the
    // widest of those shown so the two columns line up on the right.
    const agentFigures = latestAgents.map(agent => ({
      tokens: formatTokens(agent.tokens),
      ran: formatElapsed((agent.endedAt ?? at) - agent.startedAt),
    }))
    const tokensWidth = Math.max(0, ...agentFigures.map(one => one.tokens.length))
    const ranWidth = Math.max(0, ...agentFigures.map(one => one.ran.length))
    const tokens = t ? t.input + t.output + t.cacheRead + t.cacheWrite : null
    const percent = ctx?.percent

    // A section's side lines and padding take 4 cells, and a card's padding 2 more, so its
    // label lines up with the list rows below.
    const cardRoom = e.props.bodyColumns - 6
    // A list row's text, after the section's border and padding, the row's and the `› ` or `● `.
    const rowRoom = Math.max(1, e.props.bodyColumns - 8)
    // Cells a card has after its label and value, and the space after each.
    const roomAfter = (value: string) => cardRoom - (LABEL_WIDTH + 1) - (value.length + 1)

    // One card, one line: its label, the value beside it, and on the right the longest tag
    // that fits, or what the card puts there instead (the context bar).
    const card = (label: string, tags: string[], value: string, right?: RenderChildren) => {
      const tag = tags.find(one => one.length <= roomAfter(value)) ?? ''
      return (
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Text>
            <Text dimColor weight="semibold">{label.padEnd(LABEL_WIDTH)} </Text>
            <Text weight="bold">{value}</Text>
          </Text>
          {right ?? (tag !== '' && <Text dimColor weight="semibold">{tag}</Text>)}
        </Box>
      )
    }

    // The context bar sits at the right end of its card, well clear of the percent.
    const contextValue = percent === undefined ? '—' : `${percent}%`
    const barWidth = Math.max(1, Math.min(BAR_WIDTH, roomAfter(contextValue) + 1 - BAR_GAP))
    const filled = filledCells(percent ?? 0, barWidth)

    // Tool calls in all, beside the title; how many different tools made them, as its tag.
    const tally = await read($, tools)
    const callCount = String(tally.total)
    const unique = Object.keys(tally.byName).length
    const callTags = [`${unique} unique tools`, `${unique} unique`]
    const promptCount = String(await read($, promptTotal))
    const width = e.props.bodyColumns

    // A section of a fixed height, framed in the accent: its title, count and tag set into
    // the top line, its body between side lines drawn as tall as the section.
    const section = (titles: string[], tags: string[], body: RenderChildren, count = '') => {
      const height = SECTION_HEIGHT
      const top = frameTop(width, titles, count, tags)
      const side = Array.from({ length: height - 2 }, () => '│').join('\n')
      return (
        <Box flexDirection="column" height={height}>
          <Text wrap="truncate-end">
            <Text color={ACCENT}>╭─ </Text>
            <Text color={ACCENT} weight="bold">{top.title}</Text>
            {top.count !== '' && <Text weight="bold">{top.count}</Text>}
            <Text color={ACCENT}> {top.fill}{top.tag === '' ? '─╮' : ''}</Text>
            {top.tag !== '' && <Text color={TAG}> {top.tag}</Text>}
            {top.tag !== '' && <Text color={ACCENT}> ─╮</Text>}
          </Text>
          <Box flexDirection="row" height={height - 2}>
            <Text color={ACCENT}>{side}</Text>
            <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} overflow="hidden">
              {body}
            </Box>
            <Text color={ACCENT}>{side}</Text>
          </Box>
          <Text color={ACCENT}>{`╰${'─'.repeat(Math.max(0, width - 2))}╯`}</Text>
        </Box>
      )
    }

    // Working and waiting share the accent, waiting hollow; finished green, failed red.
    const agentDot: Record<AgentRow['status'], { glyph: string; color: string }> = {
      running: { glyph: '●', color: ACCENT },
      waiting: { glyph: '○', color: ACCENT },
      done: { glyph: '●', color: 'success' },
      failed: { glyph: '●', color: 'error' },
    }
    const dot = (status: CallRow['status']) => (status === 'running' ? ACCENT : status === 'done' ? 'success' : 'error')

    return (
      <Box flexDirection="column">
        {section(
          USAGE_TITLES,
          [working ? '● working' : 'idle'],
          <Box flexDirection="column">
            {card('MODEL', [], modelId === '' ? '—' : formatModel(modelId))}
            {card('TOKENS', ['LAST PROMPT', 'LAST'], tokens === null ? '—' : formatTokens(tokens))}
            {card('SPEND', ['API'], formatUsd(await read($, costUsd)))}
            {card(
              'CONTEXT',
              [],
              contextValue,
              <Text>
                <Text color={ACCENT}>{'━'.repeat(filled)}</Text>
                <Text color={TRACK}>{'━'.repeat(barWidth - filled)}</Text>
              </Text>,
            )}
            {card('SESSION', [], began > 0 ? formatElapsed(at - began) : '—')}
          </Box>,
        )}
        {section(
          PROMPT_TITLES,
          ['latest'],
          <Box flexDirection="column" paddingX={1}>
            {latestPrompts.length === 0 && <Text dimColor>No prompts yet.</Text>}
            {latestPrompts.map(text => {
              const row = rowOfPrompt.get(text)
              // Rows are plain lines until their message has been drawn in the transcript.
              return row === undefined ? (
                <Text wrap="truncate-end">
                  <Text color={ACCENT}>› </Text>
                  {text}
                </Text>
              ) : (
                <Button key={`prompt:${row}`} plain onPress={() => void showRow($, row, 'prompt')}>
                  <Text color={ACCENT}>› </Text>
                  {clip(text, rowRoom)}
                </Button>
              )
            })}
          </Box>,
          promptCount,
        )}
        {section(
          CALL_TITLES,
          callTags,
          <Box flexDirection="column" paddingX={1}>
            {latestCalls.length === 0 && (
              <Text dimColor>{tally.total === 0 ? 'No tool calls yet.' : 'No tool calls in the last 2 minutes.'}</Text>
            )}
            {latestCalls.map((call, i) => {
              const ran = (callTimes[i] ?? '').padStart(callTimeWidth)
              // The tool and what it was about, cut to leave the time its room on the right.
              const room = rowRoom - ran.length - 1
              const tool = clip(call.tool, room)
              const detailRoom = room - tool.length - 1
              const detail = call.detail === '' || detailRoom < 2 ? '' : clip(call.detail, detailRoom)
              return (
                <Box flexDirection="row" justifyContent="space-between">
                  <Button key={`call:${call.id}`} plain onPress={() => void showRow($, call.id, 'tool call')}>
                    <Text color={dot(call.status)}>● </Text>
                    {tool}
                    {detail !== '' && <Text dimColor> {detail}</Text>}
                  </Button>
                  <Text dimColor>{ran}</Text>
                </Box>
              )
            })}
          </Box>,
          callCount,
        )}
        {section(
          AGENT_TITLES,
          [`${agentTokens} tokens`, agentTokens],
          <Box flexDirection="column" paddingX={1}>
            {latestAgents.length === 0 && <Text dimColor>No subagents yet.</Text>}
            {latestAgents.map((agent, i) => {
              const figures = agentFigures[i] ?? { tokens: '', ran: '' }
              const right = `${figures.tokens.padStart(tokensWidth)}  ${figures.ran.padStart(ranWidth)}`
              // The type and its model, cut to leave the right side its room: the model's version
              // goes first, then the model, and the type is cut last.
              const room = rowRoom - right.length - 1
              const type = clip(agent.type, room)
              const modelRoom = room - type.length - 1
              const modelName = agent.model === '' ? '' : formatModel(agent.model)
              const model = [modelName, modelName.split(' ')[0] ?? ''].find(one => one !== '' && one.length <= modelRoom) ?? ''
              return (
                <Box flexDirection="row" justifyContent="space-between">
                  <Button key={`agent:${agent.id}`} plain onPress={() => void showRow($, agent.toolUseId, 'subagent')}>
                    <Text color={agentDot[agent.status].color}>{agentDot[agent.status].glyph} </Text>
                    {type}
                    {model !== '' && <Text color={TAG}> {model}</Text>}
                  </Button>
                  <Text dimColor>{right}</Text>
                </Box>
              )
            })}
          </Box>,
          String(allAgents.length),
        )}
      </Box>
    )
  })
}

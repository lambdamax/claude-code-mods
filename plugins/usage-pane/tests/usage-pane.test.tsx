import { describe, expect, test } from 'claude-code/testing'

import { callDetail, clip, filledCells, formatElapsed, formatModel, formatTokens, formatUsd, frameTop, frameTopText, heading } from '../hooks/register'

describe('formatters', () => {
  test('tokens, dollars, elapsed time and the context bar', async () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(19_500)).toBe('19.5k')
    expect(formatTokens(250_000)).toBe('250k')
    expect(formatTokens(1_234_567)).toBe('1.23M')
    expect(formatUsd(0.54)).toBe('$0.54')
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatElapsed(743_000)).toBe('12:23')
    expect(formatElapsed(3_723_000)).toBe('1:02:03')
    expect(filledCells(55, 10)).toBe(6)
    expect(filledCells(140, 4)).toBe(4)
    expect(filledCells(-5, 4)).toBe(0)
    expect(formatModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(formatModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(formatModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 · 1M')
    expect(formatModel('opus')).toBe('Opus')
    expect(callDetail({ file_path: '/Users/me/app/login.ts' })).toBe('login.ts')
    expect(callDetail({ command: 'npm test\nnpm run lint' })).toBe('npm test')
    expect(callDetail({})).toBe('')
    expect(clip('Refactor the login', 10)).toBe('Refactor …')
    expect(clip('short', 10)).toBe('short')
    expect(heading(16, ['TOKENS'], ['LAST PROMPT', 'LAST'])).toEqual({ title: 'TOKENS', tag: 'LAST' })
    expect(heading(8, ['TOKENS'], ['LAST PROMPT', 'LAST'])).toEqual({ title: 'TOKENS', tag: '' })
    // Titles sit in the top frame line, which is always exactly as wide as the pane.
    const line = (width: number, titles: string[], count: string, tags: string[]) =>
      frameTopText(frameTop(width, titles, count, tags))
    expect(line(40, ['Usage'], '', ['idle'])).toBe(`╭─ Usage ${'─'.repeat(23)} idle ─╮`)
    expect(line(40, ['Tool calls', 'Tools'], '48', ['7 unique tools', '7 unique'])).toBe(`╭─ Tool calls 48 ${'─'.repeat(5)} 7 unique tools ─╮`)
    // Narrower, the tag shortens first, then the title, to keep a tag.
    expect(line(30, ['Tool calls', 'Tools'], '48', ['7 unique tools', '7 unique'])).toBe(`╭─ Tool calls 48 ─ 7 unique ─╮`)
    expect(line(26, ['Tool calls', 'Tools'], '48', ['7 unique tools', '7 unique'])).toBe(`╭─ Tools 48 ── 7 unique ─╮`)
    // No room for a tag even beside the short title: the full title stands alone.
    expect(line(24, ['Tool calls', 'Tools'], '48', ['7 unique tools', '7 unique'])).toBe(`╭─ Tool calls 48 ${'─'.repeat(5)}─╮`)
    // With no tag that fits, the dashes run to the corner.
    expect(line(16, ['Prompts'], '3', ['latest'])).toBe(`╭─ Prompts 3 ──╮`)
    for (const width of [16, 24, 30, 40, 60]) {
      expect(line(width, ['Tool calls', 'Tools'], '48', ['7 unique tools', '7 unique']).length).toBe(width)
    }
  })
})

const PANE_PROPS = {
  title: 'Usage',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('the pane draws the usage cards, the latest prompts and the latest tool calls', async ($, on) => {
  on('session.usage', () => ({ value: {
    startedAt: 1_000,
    rateLimits: [],
    cost: { usd: 0.54 },
    context: { tokens: 110_000, window: 200_000, percent: 55 },
  } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: 1_000 + 743_000 }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: 'no', isError: true } : { result: 'ok' }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'Refactor   the\nlogin', origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'Read', tool_use_id: 't1', file_path: '/app/src/login.ts' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't2', command: 'npm test' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'usage-pane',
      surface,
      component: 'Pane',
      requestId: 'usage-pane',
      props: PANE_PROPS,
    } as never)
    // Each card is one line, its value beside its label, the values lined up.
    for (const row of ['MODEL    Opus 5.5', 'TOKENS   —', 'SPEND    $0.54', 'SESSION  12:23']) {
      expect((await ui.find({ type: 'Text', text: row }))?.text).toBe(row)
    }
    for (const tag of ['LAST PROMPT', 'API']) expect((await ui.find({ type: 'Text', text: tag }))?.text).toBe(tag)
    // The context bar is its own 11 cells at the card's right end, 55% of it filled.
    expect((await ui.find({ type: 'Text', text: /^CONTEXT/ }))?.text).toBe('CONTEXT  55%')
    const bar = (await ui.findAll({ type: 'Text', text: /^━+$/ })).map(found => found.text)
    expect(bar).toEqual(['━'.repeat(11), '━'.repeat(6), '━'.repeat(5)])
    expect((await ui.find({ type: 'Text', text: /Refactor the login$/ }))?.text).toBe('› Refactor the login')
    // Each tool call is a button that scrolls the transcript to the call's own row.
    expect((await ui.find({ type: 'Button', key: 'call:t1' }))?.text).toBe('● Read login.ts')
    expect((await ui.find({ type: 'Button', key: 'call:t2' }))?.text).toBe('● Bash npm test')
    expect(await ui.press({ key: 'call:t1' })).toMatchObject({ element: 'call:t1' })

    // The three sections keep fixed heights: usage, prompts, tool calls.
    const heights: unknown[] = []
    const walk = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return
      const el = node as { props?: Record<string, unknown>; children?: unknown }
      if (el.props?.flexDirection === 'column' && el.props.height !== undefined) heights.push(el.props.height)
      for (const child of [el.children, el.props?.children].flat(Infinity)) walk(child)
    }
    walk(await ui.drawn())
    // Every section as tall as the tallest: 6 list rows, a blank row under the title and
    // one above the bottom line, and the two frame lines; the usage cards' blank below.
    expect(heights).toEqual([10, 10, 10, 10])
    // Each title is set into its section's top line: one prompt so far, and two calls
    // by two different tools.
    const tops = (await ui.findAll({ type: 'Text', text: /^╭─ .*╮$/ })).map(found => found.text)
    expect(tops).toEqual([
      `╭─ Usage ${'─'.repeat(23)} idle ─╮`,
      `╭─ Prompts 1 ${'─'.repeat(17)} latest ─╮`,
      `╭─ Tool calls 2 ${'─'.repeat(6)} 2 unique tools ─╮`,
      `╭─ Subagents 0 ${'─'.repeat(13)} 0 tokens ─╮`,
    ])
    expect((await ui.findAll({ type: 'Text', text: /^╰─+╯$/ })).map(found => found.text.length)).toEqual([40, 40, 40, 40])
    // The tools metric card is gone; its count sits beside the tool calls title.
    expect(await ui.find({ type: 'Text', text: 'TOOLS' })).toBeUndefined()
    await ui.unmount()

    // At the default 24 columns the headings take their short forms.
    const narrow = await $.ui.mount({
      plugin: 'usage-pane',
      surface,
      component: 'Pane',
      requestId: 'usage-pane',
      props: { ...PANE_PROPS, bodyColumns: 24 },
    } as never)
    expect((await narrow.findAll({ type: 'Text', text: /^╭─ .*╮$/ })).map(found => found.text)).toEqual([
      `╭─ Usage ${'─'.repeat(7)} idle ─╮`,
      `╭─ Prompts 1 ─ latest ─╮`,
      `╭─ Tools 2 ─ 2 unique ─╮`,
      `╭─ Subagents 0 ${'─'.repeat(4)} 0 ─╮`,
    ])
    // Tags give way as the card narrows: LAST PROMPT shortens to LAST; API still fits.
    expect((await narrow.find({ type: 'Text', text: 'LAST' }))?.text).toBe('LAST')
    expect((await narrow.find({ type: 'Text', text: 'API' }))?.text).toBe('API')
    expect(await narrow.find({ type: 'Text', text: 'LAST PROMPT' })).toBeUndefined()
    await narrow.unmount()
  }
})

test('a new session starts with the pane closed', async ($, on) => {
  let startedAt = 1_000
  const open = new Set<string>()
  on('session.usage', () => ({ value: { startedAt, rateLimits: [], context: { window: 200_000 } } }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: 'Usage', isShown: true, isFocused: false, isPlaced: true })),
  }) as never)
  const start = () => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await start()
  expect(open.size).toBe(0)
  await $.command.run({ command: 'usage-pane', args: '' } as never)
  expect(open.has('usage-pane')).toBe(true)
  // A reload of the module mid-session leaves it open.
  await start()
  expect(open.has('usage-pane')).toBe(true)
  // A new session closes it.
  startedAt = 2_000
  await start()
  expect(open.size).toBe(0)
})

test('the command opens and closes the pane', async ($, on) => {
  const open = new Set<string>()
  const widths: (number | undefined)[] = []
  on('ui.open', (_, e) => {
    open.add(e.id)
    widths.push(e.columns)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: 'Usage', isShown: true, isFocused: false, isPlaced: true })),
  }) as never)
  const run = async () => (await $.command.run({ command: 'usage-pane', args: '' } as never)).text

  expect(await run()).toBe('Usage pane shown.')
  expect(open.has('usage-pane')).toBe(true)
  expect(widths).toEqual([38])
  expect(await run()).toBe('Usage pane hidden.')
  expect(open.has('usage-pane')).toBe(false)
})

test('a prompt drawn in the transcript becomes a button in the pane', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 1_000, rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('clock.now', () => ({ value: 2_000 }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'Refactor the login', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: 'Not drawn yet', origin: { kind: 'composer' } } as never)

  // The transcript draws the first prompt's row, which tells the pane where it is.
  const message = await $.ui.mount({
    plugin: 'usage-pane',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'msg-1',
    props: { text: 'Refactor the login', origin: { kind: 'composer' }, isExpanded: false },
  } as never)
  await message.unmount()

  const ui = await $.ui.mount({
    plugin: 'usage-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'usage-pane',
    props: PANE_PROPS,
  } as never)
  expect(await ui.find({ type: 'Button', key: 'prompt:msg-1' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Not drawn yet$/ }))?.text).toBe('› Not drawn yet')
  // The kit has no transcript to scroll, so this proves the row is a pressable button;
  // the scroll itself is the engine's.
  expect(await ui.press({ key: 'prompt:msg-1' })).toMatchObject({ element: 'prompt:msg-1' })
  await ui.unmount()
})

test('the subagents block lists each subagent until it finishes', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 1_000, rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  let nowMs = 2_000
  on('clock.now', () => ({ value: nowMs }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 'call-9',
    prompt: 'Find where login is handled',
    description: 'Find auth code',
    subagentType: 'Explore',
    background: false,
    fork: false,
  } as never)

  const pane = () =>
    $.ui.mount({ plugin: 'usage-pane', surface: 'terminal', component: 'Pane', requestId: 'usage-pane', props: PANE_PROPS } as never)
  let ui = await pane()
  expect((await ui.findAll({ type: 'Text', text: /^╭─ Subagents/ })).map(found => found.text)[0]).toBe(
    `╭─ Subagents 1 ${'─'.repeat(13)} 0 tokens ─╮`,
  )
  // Its type and the model it runs on.
  expect((await ui.find({ type: 'Button', key: 'agent:a1' }))?.text).toBe('● Explore Haiku 5.5')
  expect(await ui.press({ key: 'agent:a1' })).toMatchObject({ element: 'agent:a1' })
  await ui.unmount()

  // While it runs, its time climbs: tokens, then how long it has run.
  nowMs = 44_000
  ui = await pane()
  expect((await ui.find({ type: 'Text', text: /00:42$/ }))?.text).toBe('0  00:42')
  await ui.unmount()

  // Its turn ends a little later: the row stays, now done, its time stopped there.
  nowMs = 65_000
  await $.turn.complete({ reason: 'answer', answer: 'Found it', text: 'Found it', turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  nowMs = 200_000
  ui = await pane()
  const dot = (await ui.drawn()) as unknown
  expect(JSON.stringify(dot)).toContain('success')
  expect((await ui.find({ type: 'Text', text: /01:03$/ }))?.text).toBe('0  01:03')
  await ui.unmount()
})

test('a tool call shows how long it ran and leaves the list two minutes after it ends', async ($, on) => {
  let nowMs = 10_000
  on('session.usage', () => ({ value: { startedAt: 1_000, rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: nowMs }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  // The call takes 7 seconds by the clock.
  on('tool.call', () => {
    nowMs += 7_000
    return { result: 'ok' } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', tool_use_id: 't1', file_path: '/app/src/login.ts' } as never)

  const pane = () =>
    $.ui.mount({ plugin: 'usage-pane', surface: 'terminal', component: 'Pane', requestId: 'usage-pane', props: PANE_PROPS } as never)

  // A minute later it is still listed, with the 7 seconds it ran.
  nowMs += 60_000
  let ui = await pane()
  expect((await ui.find({ type: 'Button', key: 'call:t1' }))?.text).toBe('● Read login.ts')
  expect((await ui.find({ type: 'Text', text: /^00:07$/ }))?.text).toBe('00:07')
  await ui.unmount()

  // Two minutes after it ended it is gone; the title still counts it.
  nowMs += 60_000
  ui = await pane()
  expect(await ui.find({ type: 'Button', key: 'call:t1' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^No tool calls in the last/ }))?.text).toBe('No tool calls in the last 2 minutes.')
  expect((await ui.findAll({ type: 'Text', text: /^╭─ Tool calls 1 / })).length).toBe(1)
  await ui.unmount()
})

test('a subagent waiting on background work shows a hollow dot and keeps its clock', async ($, on) => {
  let nowMs = 2_000
  let engineStatus = 'running'
  on('session.usage', () => ({ value: { startedAt: 1_000, rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: nowMs }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Wait', type: 'Explore', status: engineStatus }] }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ tool_use_id: 'call-9', prompt: 'Wait', description: 'Wait', subagentType: 'Explore', background: true, fork: false } as never)
  const endTurn = () =>
    $.turn.complete({ reason: 'answer', answer: '', text: '', turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  const row = async () => {
    const ui = await $.ui.mount({ plugin: 'usage-pane', surface: 'terminal', component: 'Pane', requestId: 'usage-pane', props: PANE_PROPS } as never)
    const text = (await ui.find({ type: 'Button', key: 'agent:a1' }))?.text
    const time = (await ui.find({ type: 'Text', text: /^[\d.kM]+ +\d\d:\d\d$/ }))?.text
    const drawn = JSON.stringify(await ui.drawn())
    await ui.unmount()
    return { text, time, drawn }
  }

  // Its turn ends with background work still running: hollow, and the clock keeps going.
  nowMs = 10_000
  engineStatus = 'waiting'
  await endTurn()
  nowMs = 70_000
  const waiting = await row()
  expect(waiting.text).toBe('○ Explore Haiku 5.5')
  expect(waiting.time).toBe('0  01:08')

  // Its work done, its last turn ends: green, the clock stopped there.
  nowMs = 95_000
  engineStatus = 'completed'
  await endTurn()
  nowMs = 300_000
  const done = await row()
  expect(done.text).toBe('● Explore Haiku 5.5')
  expect(done.drawn).toContain('success')
  expect(done.time).toBe('0  01:33')
})

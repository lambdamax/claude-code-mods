import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Segment, Snapshot } from '../types'

const isOn = atom({ plugin: 'context-bar', key: 'isOn' } as const, true)
const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)

const PALETTE = [
  'rgb(136,136,136)',
  'rgb(177,185,249)',
  'rgb(22,163,74)',
  'rgb(215,119,87)',
  'rgb(255,193,7)',
  'rgb(130,125,189)',
  'rgb(80,200,220)',
  'rgb(230,100,160)',
]

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

// Cells per segment: proportional to tokens, at least one for any non-empty segment,
// summing to exactly `width` so the bar fills one line and never wraps.
const cellsFor = (segments: Segment[], width: number, max: number) => {
  const sum = segments.reduce((a, s) => a + Math.max(0, s.tokens), 0) || max || 1
  const raw = segments.map(s => (s.tokens > 0 ? (s.tokens / sum) * width : 0))
  const cells = raw.map((r, i) => ((segments[i]?.tokens ?? 0) > 0 ? Math.max(1, Math.floor(r)) : 0))
  let diff = width - cells.reduce((a, b) => a + b, 0)

  // Short: hand spare cells to the largest remainders.
  const byRemainder = raw.map((r, i) => i).filter(i => (raw[i] ?? 0) > 0)
  byRemainder.sort((a, b) => ((raw[b] ?? 0) % 1) - ((raw[a] ?? 0) % 1))
  for (let k = 0; diff > 0 && byRemainder.length > 0; k++) {
    const i = byRemainder[k % byRemainder.length] ?? 0
    cells[i] = (cells[i] ?? 0) + 1
    diff--
  }

  // Over (the one-cell minimums): take from the widest segments, and once every
  // segment is down to one cell, drop the smallest ones from the bar.
  while (diff < 0) {
    let widest = -1
    cells.forEach((c, i) => {
      if (c > 1 && (widest < 0 || c > (cells[widest] ?? 0))) widest = i
    })
    if (widest < 0) {
      let smallest = -1
      cells.forEach((c, i) => {
        const t = segments[i]?.tokens ?? 0
        if (c > 0 && (smallest < 0 || t < (segments[smallest]?.tokens ?? 0))) smallest = i
      })
      if (smallest < 0) break
      widest = smallest
    }
    cells[widest] = (cells[widest] ?? 0) - 1
    diff++
  }
  return cells
}

async function refresh($: Engine) {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  if (!b) return
  const segments: Segment[] = b.categories
    .filter(c => c.kind !== 'deferred')
    .map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind as Segment['kind'] }))
  const snap: Snapshot = { segments, total: b.totalTokens, max: b.rawMaxTokens, percent: b.percentage }
  await update($, snapshot, () => snap)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-bar', description: 'Toggle the context-window bar above the prompt' })
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async $ => {
    const now = !(await read($, isOn))
    await update($, isOn, () => now)
    if (now) await refresh($)
    return { text: `Context bar ${now ? 'on' : 'off'}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    void refresh($)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (!(await read($, isOn)) || snap === null || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // The band's own width, which excludes the engine's `[-]` at the right end.
    const width = Math.max(10, e.props.bodyColumns)
    // The usage figure sits at the bar's right end; the bar takes the rest of the line.
    const usage = ` ${compact(snap.total)}/${compact(snap.max)} (${snap.percent}%)`
    const cells = cellsFor(snap.segments, Math.max(1, width - usage.length), snap.max)
    let used = 0

    const colors = snap.segments.map(s => {
      if (s.kind !== 'used') return undefined
      return PALETTE[used++ % PALETTE.length]
    })

    const legend = snap.segments
      .map((s, i) => ({ s, color: colors[i] }))
      .filter(x => x.s.kind === 'used' && x.s.tokens > 0)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" width={width}>
          <Text wrap="truncate-end">
            {snap.segments.map((s, i) => {
              const n = cells[i] ?? 0
              return n === 0 ? null : s.kind === 'used' ? (
                <Text color={colors[i]}>{'█'.repeat(n)}</Text>
              ) : (
                <Text dimColor>{(s.kind === 'buffer' ? '▒' : '░').repeat(n)}</Text>
              )
            })}
          </Text>
          <Box flexShrink={0}>
            <Text dimColor>{usage}</Text>
          </Box>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={width}>
          {legend.map(x => (
            <Box key={x.s.name} flexShrink={0}>
              <Text color={x.color}>
                ■ <Text dimColor>{x.s.name} {compact(x.s.tokens)}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

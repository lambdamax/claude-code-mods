import { test, expect } from 'claude-code/testing'

test('draws no bar until a breakdown exists, without throwing', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'context-bar',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
    await ui.unmount()
  }
})

const SNAP = {
  segments: [
    { name: 'System prompt', tokens: 6200, kind: 'used' as const },
    { name: 'System tools', tokens: 18400, kind: 'used' as const },
    { name: 'MCP tools', tokens: 3100, kind: 'used' as const },
    { name: 'Memory files', tokens: 900, kind: 'used' as const },
    { name: 'Skills', tokens: 4300, kind: 'used' as const },
    { name: 'Messages', tokens: 52000, kind: 'used' as const },
    { name: 'Free space', tokens: 70100, kind: 'free' as const },
    { name: 'Autocompact buffer', tokens: 45000, kind: 'buffer' as const },
  ],
  total: 84900,
  max: 200000,
  percent: 42,
}

test('the bar and its usage figure fill one line exactly; the legend wraps below', async ($, on) => {
  // Stand in for the engine's context breakdown, then toggle the bar off and on to refresh it.
  on('session.usage', () => ({ value: {
    startedAt: 0,
    rateLimits: [],
    context: {
      window: SNAP.max,
      breakdown: {
        categories: SNAP.segments.map(s => ({ ...s, color: '', isDeferred: false })),
        totalTokens: SNAP.total,
        maxTokens: SNAP.max,
        rawMaxTokens: SNAP.max,
        percentage: SNAP.percent,
        gridRows: [],
      },
    },
  } }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  for (let i = 0; i < 2; i++) await $.command.run({ command: 'context-bar', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [120, 60, 23]) {
      const ui = await $.ui.mount({
        plugin: 'context-bar',
        surface,
        component: 'AbovePrompt',
        props: {
          hasSurvey: false,
          isWorking: false,
          maxRows: 10,
          bodyColumns,
          scroll: { offset: 0, bodyRows: 10 },
          view: {},
        },
      })
      const bar = await ui.find({ type: 'Text', text: /^[█░▒]+$/ })
      const usage = ' 84.9k/200.0k (42%)'
      expect(bar?.text?.length).toBe(bodyColumns - usage.length)
      expect(await ui.find({ type: 'Text', text: usage })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Messages 52\.0k/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

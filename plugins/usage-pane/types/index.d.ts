export type PromptTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type ContextFill = { tokens?: number; window: number; percent?: number }

export type ToolTally = { total: number; byName: Record<string, number> }

// One tool call in the pane's list: what ran, what it was about, how it went, and when it
// started and (once settled) ended, by the engine's clock.
export type CallRow = {
  id: string
  tool: string
  detail: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
}

// One subagent in the pane's list: its id, the Agent call that started it, its type, task
// and the model it runs on, the tokens its own model calls used, whether it is in a turn,
// waiting between turns, done or failed, and when it started and (once ended) ended, by the
// engine's clock.
export type AgentRow = {
  id: string
  toolUseId: string
  type: string
  description: string
  model: string
  tokens: number
  status: 'running' | 'waiting' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-pane': {
      promptTokens: PromptTokens | null
      costUsd: number
      context: ContextFill | null
      tools: ToolTally
      prompts: string[]
      promptTotal: number
      calls: CallRow[]
      agents: AgentRow[]
      startedAt: number
      now: number
      isShown: boolean
      isWorking: boolean
    }
  }
}

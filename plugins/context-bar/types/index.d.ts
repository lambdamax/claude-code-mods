export type Segment = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
export type Snapshot = { segments: Segment[]; total: number; max: number; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { isOn: boolean; snapshot: Snapshot | null }
  }
}

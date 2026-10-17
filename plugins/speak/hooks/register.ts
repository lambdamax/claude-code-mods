import type { EngineInterface as Engine, Register } from 'claude-code'

const STORE_KEY = 'speak.isOn'
const LAST_KEY = 'speak.last'

export function prepareSpeech(message: string): string {
  const text = message
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(^|\s)(\*{1,3}|_{1,3}|~~)(\S(?:[^\n]*?\S)?)\2(?=\s|[.,;:!?)]|$)/g, '$1$3')
    .replace(/\s+/g, ' ')
    .trim()

  return text
}

// Asks macOS what language a text is in and where each of its words starts (NaturalLanguage,
// so text without spaces such as Chinese is split too), and what the default voice speaks.
const DETECT_JS = `ObjC.import('NaturalLanguage'); ObjC.import('AppKit');
function run(argv) {
  const text = argv[0]
  const r = $.NLLanguageRecognizer.alloc.init
  r.processString(text)
  const h = ObjC.deepUnwrap(r.languageHypothesesWithMaximum(1)) || {}
  const lang = Object.keys(h)[0] || 'und'
  const t = $.NLTokenizer.alloc.initWithUnit($.NLTokenUnitWord)
  t.string = text
  const tokens = t.tokensForRange({ location: 0, length: $(text).length })
  const starts = []
  for (let i = 0; i < tokens.count; i++) starts.push(Number(tokens.objectAtIndex(i).rangeValue.location))
  const voice = ObjC.deepUnwrap($.NSSpeechSynthesizer.attributesForVoice($.NSSpeechSynthesizer.defaultVoice)) || {}
  return JSON.stringify({ lang, confidence: h[lang] || 0, defaultLocale: voice.VoiceLocaleIdentifier || '', starts })
}`

export type Detection = { lang: string; confidence: number; defaultLocale: string }

// Where each word of a text starts, by whitespace: the stand-in when macOS can't be asked.
export function wordStarts(text: string): number[] {
  return [...text.matchAll(/\S+/g)].map(m => m.index ?? 0)
}
export type Voice = { name: string; locale: string }

// Below this the recognizer is guessing (a two-word reply), so the system voice reads it.
const MIN_CONFIDENCE = 0.6

// The region a language's voice is taken from when the voices are otherwise equal.
const MAIN_REGION: Record<string, string> = {
  en: 'US', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'BR', ja: 'JP', ko: 'KR', nl: 'NL', ru: 'RU',
  'zh-Hans': 'CN', 'zh-Hant': 'TW',
}

// Reads `say -v '?'`: one voice a line, `Name   xx_YY   # sample`, names may hold spaces.
export function parseVoices(listing: string): Voice[] {
  const voices: Voice[] = []
  for (const line of listing.split('\n')) {
    const m = /^(.+?)\s+([a-z]{2,3}_[A-Z0-9]{2,3})\s+#/.exec(line)
    if (m?.[1] && m[2]) voices.push({ name: m[1].trim(), locale: m[2] })
  }
  return voices
}

// The installed voice for the detected language, or undefined to keep the system voice:
// when unsure, when the system voice already speaks it, or when none is installed.
// Premium, then Enhanced, then the plain-named voices (Alice, Thomas) before the
// novelty ones named with their language (Grandpa (Italian (Italy))), then the main region.
export function pickVoice(voices: Voice[], d: Detection): string | undefined {
  const base = d.lang.split('-')[0] ?? ''
  if (d.confidence < MIN_CONFIDENCE || base === '' || base === 'und') return undefined
  if (d.defaultLocale.split('_')[0] === base) return undefined

  const region = MAIN_REGION[d.lang] ?? MAIN_REGION[base]
  const rank = (v: Voice) =>
    (/\(Premium\)/.test(v.name) ? 0 : /\(Enhanced\)/.test(v.name) ? 1 : v.name.includes('(') ? 3 : 2) * 2 +
    (v.locale.endsWith(`_${region}`) ? 0 : 1)
  const matching = voices.filter(v => v.locale.startsWith(`${base}_`))
  matching.sort((a, b) => rank(a) - rank(b))
  return matching[0]?.name
}

// Installed voices, read afresh for every reply: a voice removed since would make `say`
// fall back to the system voice without a word.
async function listVoices($: Engine): Promise<Voice[]> {
  let listing = ''
  try {
    for await (const piece of $.process.spawn({ argv: ['say', '-v', '?'] })) {
      if (piece.stream === 'stdout') listing += piece.text
    }
  } catch {
    // say missing: no voices to pick from
  }
  return parseVoices(listing)
}

// What reading a text needs: its voice, chosen by its language (undefined keeps the system
// voice), and where each word starts, for resuming.
async function analyze($: Engine, text: string): Promise<{ voice: string | undefined; starts: number[] }> {
  let out = ''
  // Read the voices while the language is detected, rather than after.
  const voices = listVoices($)
  try {
    const argv = ['osascript', '-l', 'JavaScript', '-e', DETECT_JS, text]
    for await (const piece of $.process.spawn({ argv })) {
      if (piece.stream === 'stdout') out += piece.text
    }
    const d = JSON.parse(out) as Detection & { starts?: number[] }
    const starts = d.starts?.length ? d.starts : wordStarts(text)
    return { voice: pickVoice(await voices, d), starts }
  } catch {
    // osascript missing or unreadable answer: the system voice reads it
    return { voice: undefined, starts: wordStarts(text) }
  }
}

type Speech = { stop: () => void; wordsStarted: () => number; isDone: () => boolean }

// `say --interactive` writes this each time it starts speaking a word. Piped, the text
// around it is garbage, but the markers still arrive in step with the voice.
const WORD_MARK = '\x1b[7m'

// Starts `say` on the text and returns a handle to stop it and to count the words begun;
// `onEnd` runs once it ends, stopped or finished.
// Text goes in on stdin, so a reply starting with "-" can never be read as a flag.
function say($: Engine, speech: string, voice: string | undefined, onEnd: () => void): Speech {
  const argv = ['say', ...(voice ? ['-v', voice] : []), '--interactive', '-f', '-']
  const child = $.process.spawn({ argv, input: speech })
  const pieces: AsyncIterator<{ stream: string; text: string }> = child[Symbol.asyncIterator]()
  let started = 0
  // The last few characters, so a marker split across two pieces is still counted.
  let tail = ''
  let done = false

  void (async () => {
    try {
      for (let piece = await pieces.next(); !piece.done; piece = await pieces.next()) {
        if (piece.value.stream !== 'stdout') continue
        const joined = tail + piece.value.text
        started += joined.split(WORD_MARK).length - 1
        tail = joined.slice(-(WORD_MARK.length - 1))
      }
    } catch {
      // say missing or killed: stay silent rather than interrupt the turn
    } finally {
      done = true
      onEnd()
    }
  })()

  return { stop: () => void pieces.return?.(), wordsStarted: () => started, isDone: () => done }
}

// Words resumed from before the one cut off, so the listener picks the thread back up.
const RESUME_BACK = 2

// A reply being read: its text, where each word starts, and its voice.
type Reading = { text: string; starts: number[]; voice: string | undefined }
// What is being spoken, and the word this `say` began at.
let current: { speech: Speech; reading: Reading; offset: number } | undefined
// Where a paused reply picks up again, in the same voice.
let paused: { reading: Reading; from: number } | undefined

function halt() {
  current?.speech.stop()
  current = undefined
  paused = undefined
}

// The status line names only the /speak commands that apply right now.
async function showStatus($: Engine) {
  const isSpeaking = current !== undefined && !current.speech.isDone()
  const isOn = (await $.store.get(STORE_KEY)) !== false
  $.ui.status(
    paused ? '🔊 paused · /speak resume, stop'
    : isSpeaking ? '🔊 speaking · /speak pause, stop'
    : isOn ? '🔊 speak on · /speak last, off'
    : undefined,
  )
}

function speakFrom($: Engine, reading: Reading, from: number) {
  halt()
  const onEnd = () => void showStatus($).catch(() => undefined)
  const rest = reading.text.slice(reading.starts[from] ?? 0)
  current = { speech: say($, rest, reading.voice, onEnd), reading, offset: from }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'speak',
      description: 'Toggle spoken replies: /speak, /speak on|off, /speak pause|resume, /speak stop, /speak last',
    })
    await showStatus($)

    return next(e)
  })

  on('command.run', { command: 'speak' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'stop') {
      halt()
      await showStatus($)
      return { text: 'Stopped speaking.' }
    }

    if (arg === 'pause') {
      if (paused) return { text: 'Already paused.' }
      if (!current || current.speech.isDone()) return { text: 'Nothing is being spoken.' }
      // The word cut off is the last one begun; back up from it.
      // say may split a few more words than the tokenizer (Chinese, Japanese): never past the last.
      const last = Math.max(0, current.reading.starts.length - 1)
      const cut = Math.min(last, current.offset + Math.max(0, current.speech.wordsStarted() - 1))
      const resumeAt = { reading: current.reading, from: Math.max(0, cut - RESUME_BACK) }
      halt()
      paused = resumeAt
      await showStatus($)
      return { text: 'Paused. /speak resume to continue.' }
    }

    if (arg === 'resume') {
      if (!paused) return { text: current && !current.speech.isDone() ? 'Already speaking.' : 'Nothing is paused.' }
      speakFrom($, paused.reading, paused.from)
      await showStatus($)
      return { text: 'Resumed speaking.' }
    }

    if (arg === 'last') {
      const last = await $.store.get(LAST_KEY)
      if (typeof last !== 'string' || last === '') {
        return { text: 'No reply to speak yet.' }
      }
      speakFrom($, { text: last, ...(await analyze($, last)) }, 0)
      await showStatus($)
      return { text: 'Speaking the latest reply.' }
    }

    const wasOn = (await $.store.get(STORE_KEY)) !== false
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !wasOn
    await $.store.set(STORE_KEY, isOn)
    if (!isOn) halt()
    await showStatus($)

    return { text: `Speaking replies is ${isOn ? 'on' : 'off'}.` }
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)

    if (e.reason !== 'answer' || e.agentId !== undefined) return ran

    const speech = prepareSpeech(e.answer)
    if (speech === '') return ran

    // Kept even while speaking is off, so `/speak last` can replay it.
    await $.store.set(LAST_KEY, speech)
    if ((await $.store.get(STORE_KEY)) === false) return ran

    speakFrom($, { text: speech, ...(await analyze($, speech)) }, 0)
    await showStatus($)

    return ran
  })
}

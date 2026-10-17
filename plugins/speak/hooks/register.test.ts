import { test, expect } from 'claude-code/testing'

import { parseVoices, pickVoice, prepareSpeech, wordStarts } from './register'

test('strips markdown, urls, tables and code, and keeps flag-like text plain', () => {
  expect(prepareSpeech('**Done.** See https://example.com/a?b=1 now.')).toBe('Done. See link now.')
  expect(prepareSpeech('| a | b |\n|---|---|\n| 1 | 2 |\nAfter')).toBe('After')
  expect(prepareSpeech('Before\n```py\nprint(1)\n```\nAfter')).toBe('Before After')
  expect(prepareSpeech('2 * 3 * 4 and my_var_name')).toBe('2 * 3 * 4 and my_var_name')
  expect(prepareSpeech('-v Zarvox')).toBe('-v Zarvox')
})

test('keeps long replies whole', () => {
  const long = 'This is a sentence. '.repeat(100)
  const out = prepareSpeech(long)
  expect(out).toBe(long.trim())
})

const LISTING = `Nathan (Enhanced)   en_US    # Hello! My name is Nathan.
Alice               it_IT    # Ciao! Mi chiamo Alice.
Grandpa (Italian (Italy)) it_IT    # Ciao! Mi chiamo Grandpa.
Carlos (Enhanced)   es_CO    # ¡Hola! Me llamo Carlos.
Eddy (Spanish (Spain)) es_ES    # ¡Hola! Me llamo Eddy.
Amélie              fr_CA    # Bonjour, je m’appelle Amélie.
Thomas              fr_FR    # Bonjour, je m’appelle Thomas.
Tingting            zh_CN    # 你好！我叫婷婷。
Meijia              zh_TW    # 你好，我叫美佳。
`
const VOICES = parseVoices(LISTING)
const sure = (lang: string) => ({ lang, confidence: 0.99, defaultLocale: 'en_US' })

test('reads the voice list, names with spaces and parentheses included', () => {
  expect(VOICES.length).toBe(9)
  expect(VOICES[2]).toEqual({ name: 'Grandpa (Italian (Italy))', locale: 'it_IT' })
})

test('picks the best installed voice for the detected language', () => {
  expect(pickVoice(VOICES, sure('it'))).toBe('Alice')
  expect(pickVoice(VOICES, sure('es'))).toBe('Carlos (Enhanced)')
  expect(pickVoice(VOICES, sure('fr'))).toBe('Thomas')
  expect(pickVoice(VOICES, sure('zh-Hant'))).toBe('Meijia')
  expect(pickVoice(VOICES, sure('zh-Hans'))).toBe('Tingting')
})

test('keeps the system voice when unsure, when it speaks the language, or with no voice for it', () => {
  expect(pickVoice(VOICES, { lang: 'pl', confidence: 0.18, defaultLocale: 'en_US' })).toBeUndefined()
  expect(pickVoice(VOICES, sure('en'))).toBeUndefined()
  expect(pickVoice(VOICES, sure('ko'))).toBeUndefined()
  expect(pickVoice(VOICES, { lang: 'it', confidence: 0.99, defaultLocale: 'it_IT' })).toBeUndefined()
})

test('without macOS to ask, words start after whitespace', () => {
  const text = 'Hola  amigo, ¿qué tal?'
  expect(wordStarts(text).map(i => text.slice(i).split(/\s/)[0])).toEqual(['Hola', 'amigo,', '¿qué', 'tal?'])
  expect(wordStarts('')).toEqual([])
})

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type GameStatus = 'lobby' | 'active' | 'between_rounds' | 'finished'

export interface Question {
  id: string
  category: string
  question: string
  answers: string[]
  answer_display: string[]
  created_at?: string
}

export interface Game {
  id: string
  code: string
  status: GameStatus
  question_id: string | null
  round_duration: number
  started_at: string | null
  ends_at: string | null
  created_at: string
  total_rounds: number
  current_round: number
  round_question_ids: string[]
}

export interface GamePlayer {
  id: string
  game_id: string
  name: string
  score: number
  created_at: string
}

export interface PlayerAnswer {
  id: string
  game_id: string
  player_id: string
  answer_raw: string
  answer_normalized: string
  is_correct: boolean
  matched_index: number | null
  created_at: string
  round_number: number
}

/**
 * Expand common football shorthand before comparison.
 * Applied to both the player input AND the stored answers so lookups are symmetric.
 */
function expandAbbr(s: string): string {
  return s
    .replace(/\bman city\b/g, 'manchester city')
    .replace(/\bman utd\b/g, 'manchester united')
    .replace(/\bman united\b/g, 'manchester united')
    .replace(/\bman u\b/g, 'manchester united')
    .replace(/\bspurs\b/g, 'tottenham')
    .replace(/\bwolves\b/g, 'wolverhampton')
    .replace(/\bwba\b/g, 'west brom')
    .replace(/\bbarca\b/g, 'barcelona')
    .replace(/\bpsgs?\b/g, 'paris saint germain')
    .replace(/\bpsg\b/g, 'paris saint germain')
    .replace(/\batleti\b/g, 'atletico madrid')
    .replace(/\batm\b/g, 'atletico madrid')
}

/** Strip diacritics (Müller → Muller), lowercase, collapse whitespace */
export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFD')                // decompose é → e + combining diacritic
    .replace(/[\u0300-\u036f]/g, '') // remove combining diacriticals
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Levenshtein edit distance — optimised single-row approach */
function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 999
  const n = b.length
  const row: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = row[j]
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1])
      prev = temp
    }
  }
  return row[n]
}

/**
 * Check an input against the answer list.
 * Accepts:
 *   1. Exact match (after normalisation)
 *   2. Word-subset match — "Rooney" matches "Wayne Rooney", "van der sar" matches "Edwin van der Sar"
 *   3. Initials — "ddg" matches "David De Gea", "rvp" matches "Robin van Persie"
 *   4. Fuzzy — 1 edit distance for inputs ≥ 5 chars (Alison → Alisson, Szcesny → Szczesny)
 */
export function checkAnswer(input: string, answers: string[]): { correct: boolean; index: number; ambiguousIndices?: number[] } {
  // Apply abbreviation expansion THEN standard normalisation to both sides
  const normalized = expandAbbr(normalizeAnswer(input))
  if (!normalized || normalized.length < 2) return { correct: false, index: -1 }

  const normTargets = answers.map(a => expandAbbr(normalizeAnswer(a)))

  // 1. Exact match — always unambiguous, return immediately
  for (let i = 0; i < normTargets.length; i++) {
    if (normalized === normTargets[i]) return { correct: true, index: i }
  }

  // 2. Word-subset match — collect ALL matches; only accept if exactly one answer matches.
  //    If multiple match, return ambiguousIndices so the UI can prompt "Which one?"
  if (normalized.length >= 3) {
    const inputWords = normalized.split(' ')
    const subsetMatches: number[] = []
    for (let i = 0; i < normTargets.length; i++) {
      const targetWords = normTargets[i].split(' ')
      const allMatch = inputWords.every(w =>
        targetWords.some(tw => tw === w || (w.length >= 4 && tw.startsWith(w)))
      )
      if (allMatch) subsetMatches.push(i)
    }
    if (subsetMatches.length === 1) return { correct: true, index: subsetMatches[0] }
    if (subsetMatches.length > 1) return { correct: false, index: -1, ambiguousIndices: subsetMatches }
  }

  // 3. Initials match — collect all, only accept if unique
  if (normalized.length >= 2 && !normalized.includes(' ')) {
    const initialsMatches: number[] = []
    for (let i = 0; i < normTargets.length; i++) {
      const targetWords = normTargets[i].split(' ')
      const initials = targetWords.map(w => w[0]).join('')
      if (normalized === initials) initialsMatches.push(i)
    }
    if (initialsMatches.length === 1) return { correct: true, index: initialsMatches[0] }
    if (initialsMatches.length > 1) return { correct: false, index: -1, ambiguousIndices: initialsMatches }
  }

  // 4. Fuzzy match — collect all, only accept if unique
  if (normalized.length >= 5) {
    const fuzzyMatches: number[] = []
    for (let i = 0; i < normTargets.length; i++) {
      const target = normTargets[i]
      const targetWords = target.split(' ')
      if (levenshtein(normalized, target) <= 1) { fuzzyMatches.push(i); continue }
      for (const tw of targetWords) {
        if (tw.length >= 5 && levenshtein(normalized, tw) <= 1) { fuzzyMatches.push(i); break }
      }
    }
    if (fuzzyMatches.length === 1) return { correct: true, index: fuzzyMatches[0] }
    if (fuzzyMatches.length > 1) return { correct: false, index: -1, ambiguousIndices: fuzzyMatches }
  }

  return { correct: false, index: -1 }
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

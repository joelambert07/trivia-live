import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type GameStatus = 'lobby' | 'active' | 'finished'

export interface Question {
  id: string
  category: string
  question: string
  answers: string[]
  answer_display: string[]
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
}

export function normalizeAnswer(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function checkAnswer(input: string, answers: string[]): { correct: boolean; index: number } {
  const normalized = normalizeAnswer(input)
  if (!normalized || normalized.length < 2) return { correct: false, index: -1 }

  for (let i = 0; i < answers.length; i++) {
    const target = normalizeAnswer(answers[i])
    if (normalized === target) return { correct: true, index: i }
    // Allow partial: if input is a significant part of the answer (e.g. "Rooney" matches "wayne rooney")
    const words = normalized.split(' ')
    const targetWords = target.split(' ')
    if (words.length >= 1 && normalized.length >= 4) {
      // Check if all input words appear in the target
      const allMatch = words.every(w => targetWords.some(tw => tw === w || tw.startsWith(w)))
      if (allMatch) return { correct: true, index: i }
    }
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

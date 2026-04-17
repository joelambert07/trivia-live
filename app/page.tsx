'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, generateCode } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createGame() {
    setLoading(true)
    setError('')

    // Generate a unique 6-char code
    let code = generateCode()
    let attempts = 0
    while (attempts < 5) {
      const { data: existing } = await supabase
        .from('games')
        .select('id')
        .eq('code', code)
        .maybeSingle()
      if (!existing) break
      code = generateCode()
      attempts++
    }

    const { data, error: err } = await supabase
      .from('games')
      .insert({ code })
      .select()
      .single()

    if (err || !data) {
      setError('Failed to create game. Try again.')
      setLoading(false)
      return
    }

    router.push(`/host/${data.id}`)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="text-center max-w-md w-full">
        <div className="text-6xl mb-4">⚽</div>
        <h1 className="text-4xl font-black tracking-tight mb-2" style={{ color: 'var(--accent)' }}>
          TRIVIA LIVE
        </h1>
        <p className="text-lg mb-2" style={{ color: 'rgba(240,240,255,0.6)' }}>
          Football Top 10s — live with your mates
        </p>
        <p className="text-sm mb-10" style={{ color: 'rgba(240,240,255,0.35)' }}>
          Inspired by HQ Trivia &amp; Tenable
        </p>

        <div
          className="rounded-2xl p-8 mb-6"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <h2 className="text-xl font-bold mb-2">Host a Game</h2>
          <p className="text-sm mb-6" style={{ color: 'rgba(240,240,255,0.5)' }}>
            Create a room, share the link, and when everyone&apos;s in — go live.
            Your mates have 3 minutes to name as many correct answers as possible.
          </p>
          <button
            onClick={createGame}
            disabled={loading}
            className="w-full py-4 rounded-xl text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
            style={{
              background: loading ? 'var(--accent-dim)' : 'var(--accent)',
              color: '#0d0d1a',
            }}
          >
            {loading ? 'Creating...' : 'Create Game'}
          </button>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        </div>

        <div
          className="rounded-2xl p-6 text-left"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <h3 className="font-bold mb-3 text-sm uppercase tracking-widest" style={{ color: 'rgba(240,240,255,0.4)' }}>
            How it works
          </h3>
          <div className="space-y-2 text-sm" style={{ color: 'rgba(240,240,255,0.6)' }}>
            <div className="flex gap-3">
              <span style={{ color: 'var(--accent)' }}>1.</span>
              <span>Create a game and share the join link with your group</span>
            </div>
            <div className="flex gap-3">
              <span style={{ color: 'var(--accent)' }}>2.</span>
              <span>Everyone joins on their phone and enters their name</span>
            </div>
            <div className="flex gap-3">
              <span style={{ color: 'var(--accent)' }}>3.</span>
              <span>Pick a question and hit Go Live — 3 minutes on the clock</span>
            </div>
            <div className="flex gap-3">
              <span style={{ color: 'var(--accent)' }}>4.</span>
              <span>Type your answers — correct ones light up instantly</span>
            </div>
            <div className="flex gap-3">
              <span style={{ color: 'var(--accent)' }}>5.</span>
              <span>Scores revealed when the clock hits zero</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

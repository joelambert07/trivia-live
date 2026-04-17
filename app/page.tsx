'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, generateCode } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createGame() {
    setLoading(true); setError('')
    let code = generateCode()
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabase.from('games').select('id').eq('code', code).maybeSingle()
      if (!existing) break
      code = generateCode()
    }
    const { data, error: err } = await supabase.from('games').insert({ code }).select().single()
    if (err || !data) { setError('Failed to create game. Try again.'); setLoading(false); return }
    router.push(`/host/${data.id}`)
  }

  return (
    <div className="min-h-screen flex flex-col stadium-bg noise">
      {/* Hero */}
      <div className="flex-1 flex flex-col px-5 py-8 max-w-xl mx-auto w-full relative z-10">
        {/* Top bar */}
        <div className="flex items-center gap-2 mb-auto pt-4">
          <div className="w-2 h-2 rounded-full animate-breathe" style={{ background: 'var(--mint)' }} />
          <span className="label-micro" style={{ color: 'var(--mint)' }}>Live Football Trivia</span>
        </div>

        {/* Hero text */}
        <div className="py-12 text-center">
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 -m-4 rounded-full blur-2xl" style={{ background: 'radial-gradient(circle, var(--mint-glow) 0%, transparent 70%)' }} />
            <div className="relative text-7xl animate-spin-slow">⚽</div>
          </div>

          <h1 className="font-display text-[64px] leading-[0.85] tracking-tight mb-3" style={{ color: 'var(--text)' }}>
            FOOTY TRIVIA<br/>
            <span style={{
              background: 'linear-gradient(135deg, var(--mint) 0%, #7dffb8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>SHOTS</span>
          </h1>

          {/* Tagline with underline accent */}
          <div className="inline-block">
            <p className="text-xl italic font-medium mb-1" style={{ color: 'var(--text)' }}>
              &ldquo;When you shoot, score!&rdquo;
            </p>
            <div className="h-0.5 mx-auto w-16" style={{ background: 'var(--mint)', boxShadow: '0 0 10px var(--mint-glow)' }} />
          </div>
        </div>

        {/* CTA */}
        <div className="mb-6">
          <button
            onClick={createGame}
            disabled={loading}
            className="btn-primary w-full py-5 text-xl"
          >
            {loading ? 'SETTING UP...' : 'CREATE MATCH'}
          </button>
          {error && <p className="text-center text-sm mt-3" style={{ color: 'var(--red)' }}>{error}</p>}
          <p className="text-center text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            Host a game and share the link with The Shots
          </p>
        </div>

        {/* Scoreboard-style how it works */}
        <div className="card p-5 mb-4">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
            <span className="label-micro">How the match works</span>
          </div>
          <div className="space-y-3">
            {[
              ['01', 'Create a match', 'Host hits kick off, gets a room code'],
              ['02', 'Squad joins', 'The Shots open the link on their phones'],
              ['03', 'Pick a top 10', 'Premier League, World Cup, Ballon d\'Or...'],
              ['04', '3 minutes. Go.', 'Type answers — goals light up instantly'],
              ['05', 'Most goals wins', 'Full table revealed at full time'],
            ].map(([num, title, desc]) => (
              <div key={num} className="flex items-start gap-4">
                <div className="font-display text-2xl shrink-0 w-8 tabular" style={{ color: 'var(--mint)' }}>{num}</div>
                <div className="flex-1 pt-0.5">
                  <p className="font-bold text-sm mb-0.5" style={{ color: 'var(--text)' }}>{title}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs mt-auto pt-6" style={{ color: 'var(--text-faint)' }}>
          Built for The Shots • HQ Trivia × Tenable × Football
        </p>
      </div>
    </div>
  )
}

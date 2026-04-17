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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="px-5 py-4 flex items-center gap-3" style={{ background: 'var(--navy)' }}>
        <span className="text-2xl">⚽</span>
        <div>
          <h1 className="text-white font-black text-lg leading-none tracking-tight">FOOTY TRIVIA SHOTS</h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>Top 10s • Live • With The Shots</p>
        </div>
      </header>

      <div className="flex-1 flex flex-col justify-center px-5 py-8 max-w-lg mx-auto w-full">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-5 text-4xl"
            style={{ background: 'var(--green-light)' }}>
            ⚽
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-2" style={{ color: 'var(--navy)' }}>
            Host a Match
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Football Top 10s — everyone guesses live on their phone
          </p>
        </div>

        {/* Create card */}
        <div className="rounded-2xl p-6 mb-4" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-lg)' }}>
          <button
            onClick={createGame}
            disabled={loading}
            className="w-full py-4 rounded-xl text-lg font-black transition-all active:scale-[0.98] disabled:opacity-60"
            style={{ background: loading ? 'var(--green)' : 'var(--navy)', color: '#fff' }}
          >
            {loading ? 'Setting up...' : 'Create Game'}
          </button>
          {error && <p className="text-center text-sm mt-3" style={{ color: 'var(--red)' }}>{error}</p>}
        </div>

        {/* How it works */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-faint)' }}>How it works</p>
          <div className="space-y-3">
            {[
              ['⚽', 'Create a game, share the link with The Shots'],
              ['📱', 'Everyone joins on their phone — enter your name'],
              ['🚀', 'Pick a question and go live — 3 minutes on the clock'],
              ['🎯', 'Type answers — goals light up, shots are counted'],
              ['🏆', 'Most goals wins when the whistle blows'],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-start gap-3">
                <span className="text-lg shrink-0 mt-0.5">{icon}</span>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

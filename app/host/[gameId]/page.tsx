'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Game, type GamePlayer, type Question, type PlayerAnswer } from '@/lib/supabase'

export default function HostPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = use(params)
  const router = useRouter()

  const [game, setGame] = useState<Game | null>(null)
  const [players, setPlayers] = useState<GamePlayer[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null)
  const [allAnswers, setAllAnswers] = useState<PlayerAnswer[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [roundEnded, setRoundEnded] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: gameData }, { data: qData }] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).single(),
        supabase.from('questions').select('*').order('created_at'),
      ])
      if (!gameData) { router.push('/'); return }
      setGame(gameData as Game)
      setQuestions((qData as Question[]) || [])
      if (gameData.question_id) {
        const q = (qData as Question[])?.find(q => q.id === gameData.question_id)
        if (q) setSelectedQuestion(q)
      }
      setLoading(false)
    }
    load()
  }, [gameId, router])

  const loadPlayers = useCallback(async () => {
    const { data } = await supabase.from('game_players').select('*').eq('game_id', gameId).order('created_at')
    setPlayers((data as GamePlayer[]) || [])
  }, [gameId])

  const loadAnswers = useCallback(async () => {
    const { data } = await supabase.from('player_answers').select('*').eq('game_id', gameId).eq('is_correct', true)
    setAllAnswers((data as PlayerAnswer[]) || [])
  }, [gameId])

  useEffect(() => { loadPlayers() }, [loadPlayers])

  useEffect(() => {
    if (!game) return
    const ch = supabase
      .channel(`host-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        payload => setGame(payload.new as Game))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => loadPlayers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_answers', filter: `game_id=eq.${gameId}` },
        () => { loadPlayers(); loadAnswers() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [game, gameId, loadPlayers, loadAnswers])

  useEffect(() => {
    if (game?.status === 'active') loadAnswers()
  }, [game?.status, loadAnswers])

  useEffect(() => {
    if (!game?.ends_at || game.status !== 'active') return
    const tick = () => {
      const left = Math.max(0, Math.ceil((new Date(game.ends_at!).getTime() - Date.now()) / 1000))
      setTimeLeft(left)
      if (left <= 0 && !roundEnded) { setRoundEnded(true); endRound() }
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.ends_at, game?.status])

  async function pickQuestion(q: Question) {
    setSelectedQuestion(q)
    await supabase.from('games').update({ question_id: q.id }).eq('id', gameId)
  }

  async function goLive() {
    if (!selectedQuestion) return
    const duration = 180
    await supabase.from('games').update({
      status: 'active',
      question_id: selectedQuestion.id,
      started_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + duration * 1000).toISOString(),
      round_duration: duration,
    }).eq('id', gameId)
  }

  async function endRound() {
    if (game?.status === 'finished') return
    await supabase.from('games').update({ status: 'finished' }).eq('id', gameId)
  }

  function copyLink() {
    if (!game) return
    navigator.clipboard.writeText(`${window.location.origin}/play/${game.code}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Build per-player goal count from allAnswers
  const playerGoals = allAnswers.reduce<Record<string, Set<number>>>((acc, a) => {
    if (a.matched_index !== null) {
      if (!acc[a.player_id]) acc[a.player_id] = new Set()
      acc[a.player_id].add(a.matched_index)
    }
    return acc
  }, {})

  const sortedPlayers = [...players].sort((a, b) =>
    (playerGoals[b.id]?.size || 0) - (playerGoals[a.id]?.size || 0)
  )

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-lg font-bold" style={{ color: 'var(--text-muted)' }}>Loading...</div>
    </div>
  )
  if (!game) return null

  const timerPct = game.ends_at ? timeLeft / game.round_duration : 1
  const timerColor = timerPct > 0.5 ? 'var(--green)' : timerPct > 0.25 ? 'var(--gold)' : 'var(--red)'
  const r = 40
  const circ = 2 * Math.PI * r

  // ── LOBBY ───────────────────────────────────────────────────
  if (game.status === 'lobby') return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <header className="px-5 py-4 flex items-center gap-3" style={{ background: 'var(--navy)' }}>
        <span className="text-xl">⚽</span>
        <h1 className="text-white font-black tracking-tight">FOOTY TRIVIA SHOTS</h1>
        <span className="ml-auto text-xs px-2.5 py-1 rounded-full font-bold"
          style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}>
          HOST
        </span>
      </header>

      <div className="flex-1 p-5 pb-8 max-w-lg mx-auto w-full space-y-4">
        {/* Room code */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-faint)' }}>Room Code</p>
          <div className="text-5xl font-black tracking-[0.18em] mb-4" style={{ color: 'var(--navy)', fontVariantNumeric: 'tabular-nums' }}>
            {game.code}
          </div>
          <button onClick={copyLink}
            className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
            style={{
              background: copied ? 'var(--green)' : 'var(--navy)',
              color: '#fff',
            }}>
            {copied ? '✓ Link copied!' : `Share: /play/${game.code}`}
          </button>
        </div>

        {/* Players */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>Squad</p>
            <span className="text-sm font-bold px-2.5 py-0.5 rounded-full"
              style={{ background: players.length > 0 ? 'var(--green-light)' : '#f3f4f6', color: players.length > 0 ? 'var(--green)' : 'var(--text-faint)' }}>
              {players.length} joined
            </span>
          </div>
          {players.length === 0 ? (
            <div className="py-6 text-center">
              <div className="text-3xl mb-2">📱</div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Waiting for the squad to join...</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {players.map(p => (
                <span key={p.id}
                  className="px-3 py-1.5 rounded-full text-sm font-semibold animate-slide-up"
                  style={{ background: 'var(--green-light)', color: 'var(--green)' }}>
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Question picker */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-faint)' }}>Pick a Question</p>
          <div className="space-y-2">
            {questions.map(q => {
              const selected = selectedQuestion?.id === q.id
              return (
                <button key={q.id} onClick={() => pickQuestion(q)}
                  className="w-full text-left p-4 rounded-xl transition-all active:scale-[0.99]"
                  style={{
                    background: selected ? 'var(--green-light)' : 'var(--surface-2)',
                    border: `1.5px solid ${selected ? 'var(--green)' : 'var(--border)'}`,
                  }}>
                  <span className="text-xs font-bold uppercase tracking-wider block mb-0.5"
                    style={{ color: selected ? 'var(--green)' : 'var(--text-faint)' }}>
                    {q.category}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: selected ? 'var(--navy)' : 'var(--text)' }}>
                    {q.question}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Go live */}
        <button onClick={goLive}
          disabled={!selectedQuestion || players.length === 0}
          className="w-full py-5 rounded-2xl text-xl font-black transition-all active:scale-[0.98] disabled:opacity-40"
          style={{ background: 'var(--green)', color: '#fff', boxShadow: selectedQuestion && players.length > 0 ? '0 4px 20px rgba(22,163,74,0.35)' : 'none' }}>
          KICK OFF
        </button>
        {!selectedQuestion && (
          <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>Pick a question first</p>
        )}
        {selectedQuestion && players.length === 0 && (
          <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>Waiting for at least 1 player</p>
        )}
      </div>
    </div>
  )

  // ── ACTIVE ──────────────────────────────────────────────────
  if (game.status === 'active') {
    const foundIndices = new Set(allAnswers.map(a => a.matched_index))
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
        <header className="px-5 py-3 flex items-center gap-3" style={{ background: 'var(--navy)' }}>
          <span className="text-xl">⚽</span>
          <h1 className="text-white font-black tracking-tight flex-1">FOOTY TRIVIA SHOTS</h1>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full animate-pulse"
            style={{ background: 'rgba(220,38,38,0.25)', color: '#fca5a5' }}>
            LIVE
          </span>
        </header>

        <div className="flex-1 p-5 pb-8 max-w-lg mx-auto w-full space-y-4">
          {/* Timer + question */}
          <div className="rounded-2xl p-5 flex gap-4 items-center" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}>
            <div className="relative shrink-0 w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
                <circle cx="50" cy="50" r={r} fill="none"
                  stroke={timerColor} strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={circ * (1 - timerPct)}
                  style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-black tabular-nums" style={{ color: timerColor }}>
                  {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>{selectedQuestion?.category}</p>
              <p className="font-semibold text-sm leading-snug">{selectedQuestion?.question}</p>
            </div>
          </div>

          {/* Answers grid */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>Answers</p>
              <span className="text-sm font-bold" style={{ color: 'var(--green)' }}>{foundIndices.size}/{selectedQuestion?.answers.length} found</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {selectedQuestion?.answer_display.map((display, i) => {
                const found = foundIndices.has(i)
                return (
                  <div key={i} className="px-3 py-2.5 rounded-lg text-xs font-medium"
                    style={{
                      background: found ? 'var(--green-light)' : 'var(--surface-2)',
                      border: `1px solid ${found ? 'var(--green)' : 'var(--border)'}`,
                      color: found ? 'var(--green)' : 'var(--text-faint)',
                    }}>
                    <span className="font-bold">{i + 1}. </span>
                    {found ? display.split('(')[0].trim() : '???'}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live leaderboard */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-faint)' }}>Live Table</p>
            <div className="space-y-2">
              {sortedPlayers.map((p, i) => {
                const goals = playerGoals[p.id]?.size || 0
                return (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <span className="text-base w-7 text-center">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}</span>
                    <span className="flex-1 font-semibold text-sm">{p.name}</span>
                    <div className="text-right">
                      <span className="font-black text-lg tabular-nums" style={{ color: 'var(--green)' }}>{goals}</span>
                      <span className="text-xs ml-0.5" style={{ color: 'var(--text-faint)' }}>goals</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <button onClick={endRound}
            className="w-full py-3.5 rounded-xl font-bold transition-all active:scale-[0.98]"
            style={{ background: 'var(--surface)', border: '1.5px solid var(--red)', color: 'var(--red)', boxShadow: 'var(--shadow)' }}>
            Blow the Whistle
          </button>
        </div>
      </div>
    )
  }

  // ── FINISHED ────────────────────────────────────────────────
  const medals = ['🥇', '🥈', '🥉']
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <header className="px-5 py-4" style={{ background: 'var(--navy)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚽</span>
          <h1 className="text-white font-black tracking-tight">FOOTY TRIVIA SHOTS</h1>
        </div>
      </header>

      <div className="flex-1 p-5 pb-8 max-w-lg mx-auto w-full space-y-4">
        <div className="text-center py-6">
          <div className="text-5xl mb-3">🏆</div>
          <h2 className="text-2xl font-black" style={{ color: 'var(--navy)' }}>Full Time</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{selectedQuestion?.question}</p>
        </div>

        {/* Final table */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-lg)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-faint)' }}>Final Table</p>
          <div className="space-y-2">
            {sortedPlayers.map((p, i) => {
              const goals = playerGoals[p.id]?.size || 0
              const pct = selectedQuestion ? (goals / selectedQuestion.answers.length) * 100 : 0
              return (
                <div key={p.id} className="rounded-xl p-4 animate-slide-up"
                  style={{
                    background: i === 0 ? '#fefce8' : 'var(--surface-2)',
                    border: `1.5px solid ${i === 0 ? '#fde68a' : 'var(--border)'}`,
                    animationDelay: `${i * 80}ms`
                  }}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xl w-8">{medals[i] || `${i + 1}`}</span>
                    <span className="flex-1 font-bold">{p.name}</span>
                    <span className="font-black text-xl tabular-nums" style={{ color: i === 0 ? 'var(--gold)' : 'var(--green)' }}>
                      {goals}<span className="text-sm font-medium ml-0.5" style={{ color: 'var(--text-faint)' }}>/{selectedQuestion?.answers.length}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: i === 0 ? 'var(--gold)' : 'var(--green)' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Answer reveal */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-faint)' }}>The Answers</p>
          <div className="space-y-1.5">
            {selectedQuestion?.answer_display.map((display, i) => {
              const found = allAnswers.some(a => a.matched_index === i)
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
                  style={{
                    background: found ? 'var(--green-light)' : '#fff5f5',
                    border: `1px solid ${found ? '#86efac' : '#fecaca'}`,
                    color: found ? 'var(--green)' : 'var(--red)',
                  }}>
                  <span className="font-bold w-5 text-xs text-center" style={{ opacity: 0.7 }}>{i + 1}</span>
                  <span className="flex-1">{display}</span>
                  {!found && <span className="text-xs font-bold opacity-60">MISSED</span>}
                </div>
              )
            })}
          </div>
        </div>

        <button onClick={() => router.push('/')}
          className="w-full py-4 rounded-xl font-black text-lg transition-all active:scale-[0.98]"
          style={{ background: 'var(--navy)', color: '#fff' }}>
          New Game
        </button>
      </div>
    </div>
  )
}

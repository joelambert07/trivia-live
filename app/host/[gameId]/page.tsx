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

  // Load game and questions
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

  // Load players
  const loadPlayers = useCallback(async () => {
    const { data } = await supabase
      .from('game_players')
      .select('*')
      .eq('game_id', gameId)
      .order('score', { ascending: false })
    setPlayers((data as GamePlayer[]) || [])
  }, [gameId])

  // Load answers
  const loadAnswers = useCallback(async () => {
    const { data } = await supabase
      .from('player_answers')
      .select('*')
      .eq('game_id', gameId)
      .eq('is_correct', true)
    setAllAnswers((data as PlayerAnswer[]) || [])
  }, [gameId])

  useEffect(() => { loadPlayers() }, [loadPlayers])

  // Real-time subscriptions
  useEffect(() => {
    if (!game) return

    const gameSub = supabase
      .channel(`host-game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        payload => setGame(payload.new as Game))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => loadPlayers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_answers', filter: `game_id=eq.${gameId}` },
        () => { loadPlayers(); loadAnswers() })
      .subscribe()

    return () => { supabase.removeChannel(gameSub) }
  }, [game, gameId, loadPlayers, loadAnswers])

  // Load answers when active
  useEffect(() => {
    if (game?.status === 'active') loadAnswers()
  }, [game?.status, loadAnswers])

  // Countdown timer
  useEffect(() => {
    if (!game?.ends_at || game.status !== 'active') return
    const tick = () => {
      const left = Math.max(0, Math.ceil((new Date(game.ends_at!).getTime() - Date.now()) / 1000))
      setTimeLeft(left)
      if (left <= 0) endRound()
    }
    tick()
    const t = setInterval(tick, 1000)
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
    const ends_at = new Date(Date.now() + duration * 1000).toISOString()
    await supabase.from('games').update({
      status: 'active',
      question_id: selectedQuestion.id,
      started_at: new Date().toISOString(),
      ends_at,
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

  // Tally correct answers per player
  const playerScoreMap = allAnswers.reduce<Record<string, Set<number>>>((acc, a) => {
    if (a.is_correct && a.matched_index !== null) {
      if (!acc[a.player_id]) acc[a.player_id] = new Set()
      acc[a.player_id].add(a.matched_index)
    }
    return acc
  }, {})

  const sortedPlayers = [...players].sort((a, b) => {
    const aScore = playerScoreMap[a.id]?.size || 0
    const bScore = playerScoreMap[b.id]?.size || 0
    return bScore - aScore
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl" style={{ color: 'var(--accent)' }}>Loading...</div>
      </div>
    )
  }

  if (!game) return null

  const timerPct = game.ends_at
    ? timeLeft / game.round_duration
    : 1
  const timerColor = timerPct > 0.5 ? 'var(--accent)' : timerPct > 0.25 ? '#ffd700' : '#ff4444'
  const circumference = 2 * Math.PI * 45

  // ── LOBBY ────────────────────────────────────────────────────────────────
  if (game.status === 'lobby') {
    return (
      <div className="min-h-screen p-4 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-4">
          <span className="text-2xl">⚽</span>
          <h1 className="text-xl font-black" style={{ color: 'var(--accent)' }}>TRIVIA LIVE</h1>
          <span className="ml-auto text-sm px-3 py-1 rounded-full font-bold" style={{ background: 'rgba(0,232,122,0.15)', color: 'var(--accent)' }}>HOST</span>
        </div>

        {/* Room Code */}
        <div className="rounded-2xl p-6 mb-4 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <p className="text-sm mb-2 uppercase tracking-widest" style={{ color: 'rgba(240,240,255,0.4)' }}>Room Code</p>
          <div className="text-5xl font-black tracking-[0.2em] mb-4" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
            {game.code}
          </div>
          <button
            onClick={copyLink}
            className="px-6 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: copied ? 'var(--accent)' : 'var(--border)', color: copied ? '#0d0d1a' : 'var(--foreground)' }}
          >
            {copied ? 'Copied!' : `Copy Link — play/${game.code}`}
          </button>
        </div>

        {/* Players */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm uppercase tracking-widest mb-3 font-bold" style={{ color: 'rgba(240,240,255,0.4)' }}>
            Players ({players.length})
          </h3>
          {players.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'rgba(240,240,255,0.3)' }}>
              Waiting for players to join...
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {players.map(p => (
                <span key={p.id} className="px-3 py-1 rounded-full text-sm font-medium animate-slide-up"
                  style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--accent)', border: '1px solid rgba(0,232,122,0.2)' }}>
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Question Picker */}
        <div className="rounded-2xl p-4 mb-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm uppercase tracking-widest mb-3 font-bold" style={{ color: 'rgba(240,240,255,0.4)' }}>
            Pick a Question
          </h3>
          <div className="space-y-2">
            {questions.map(q => (
              <button
                key={q.id}
                onClick={() => pickQuestion(q)}
                className="w-full text-left p-3 rounded-xl transition-all"
                style={{
                  background: selectedQuestion?.id === q.id ? 'rgba(0,232,122,0.15)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${selectedQuestion?.id === q.id ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                  color: selectedQuestion?.id === q.id ? 'var(--accent)' : 'rgba(240,240,255,0.7)',
                }}
              >
                <span className="text-xs font-bold uppercase tracking-wider block mb-0.5" style={{ opacity: 0.6 }}>{q.category}</span>
                {q.question}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={goLive}
          disabled={!selectedQuestion || players.length === 0}
          className="w-full py-5 rounded-2xl text-xl font-black transition-all active:scale-95 disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0d0d1a' }}
        >
          GO LIVE
        </button>
        {!selectedQuestion && <p className="text-center text-xs mt-2" style={{ color: 'rgba(240,240,255,0.4)' }}>Pick a question first</p>}
        {selectedQuestion && players.length === 0 && <p className="text-center text-xs mt-2" style={{ color: 'rgba(240,240,255,0.4)' }}>Waiting for at least 1 player</p>}
      </div>
    )
  }

  // ── ACTIVE ───────────────────────────────────────────────────────────────
  if (game.status === 'active') {
    const answeredIndices = new Set(
      allAnswers.filter(a => a.is_correct).map(a => a.matched_index)
    )

    return (
      <div className="min-h-screen p-4 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-4">
          <span className="text-2xl">⚽</span>
          <h1 className="text-xl font-black" style={{ color: 'var(--accent)' }}>TRIVIA LIVE</h1>
          <span className="ml-auto text-sm px-3 py-1 rounded-full font-bold animate-pulse" style={{ background: 'rgba(255,50,50,0.2)', color: '#ff6b6b' }}>
            LIVE
          </span>
        </div>

        {/* Timer */}
        <div className="flex justify-center mb-6">
          <div className="relative w-32 h-32">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border)" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="45" fill="none"
                stroke={timerColor} strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - timerPct)}
                style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black" style={{ color: timerColor, fontVariantNumeric: 'tabular-nums' }}>
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
              </span>
            </div>
          </div>
        </div>

        {/* Question */}
        <div className="rounded-2xl p-4 mb-4 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(240,240,255,0.4)' }}>{selectedQuestion?.category}</span>
          <p className="text-lg font-bold mt-1">{selectedQuestion?.question}</p>
        </div>

        {/* Answers found */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm uppercase tracking-widest mb-3 font-bold" style={{ color: 'rgba(240,240,255,0.4)' }}>
            Answers Found ({answeredIndices.size}/{selectedQuestion?.answers.length})
          </h3>
          <div className="grid grid-cols-1 gap-1.5">
            {selectedQuestion?.answer_display.map((display, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                style={{
                  background: answeredIndices.has(i) ? 'rgba(0,232,122,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${answeredIndices.has(i) ? 'rgba(0,232,122,0.3)' : 'var(--border)'}`,
                  color: answeredIndices.has(i) ? 'var(--accent)' : 'rgba(240,240,255,0.25)',
                }}>
                <span className="font-bold w-5 text-center">{i + 1}</span>
                <span>{answeredIndices.has(i) ? display : '???'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Live leaderboard */}
        <div className="rounded-2xl p-4 mb-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm uppercase tracking-widest mb-3 font-bold" style={{ color: 'rgba(240,240,255,0.4)' }}>Live Scores</h3>
          <div className="space-y-2">
            {sortedPlayers.map((p, i) => {
              const score = playerScoreMap[p.id]?.size || 0
              return (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <span className="text-sm w-6 text-center font-bold" style={{ color: 'rgba(240,240,255,0.3)' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                  </span>
                  <span className="flex-1 font-medium">{p.name}</span>
                  <span className="font-black text-lg" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                    {score}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <button
          onClick={endRound}
          className="w-full py-4 rounded-2xl font-bold text-lg transition-all active:scale-95"
          style={{ background: 'rgba(255,50,50,0.2)', border: '1px solid rgba(255,50,50,0.4)', color: '#ff6b6b' }}
        >
          End Round Early
        </button>
      </div>
    )
  }

  // ── FINISHED ─────────────────────────────────────────────────────────────
  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="min-h-screen p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8 pt-4">
        <span className="text-2xl">⚽</span>
        <h1 className="text-xl font-black" style={{ color: 'var(--accent)' }}>TRIVIA LIVE</h1>
      </div>

      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🏆</div>
        <h2 className="text-3xl font-black">Final Scores</h2>
        <p className="text-sm mt-1" style={{ color: 'rgba(240,240,255,0.4)' }}>{selectedQuestion?.question}</p>
      </div>

      {/* Full answer reveal */}
      <div className="rounded-2xl p-4 mb-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm uppercase tracking-widest mb-3 font-bold" style={{ color: 'rgba(240,240,255,0.4)' }}>The Answers</h3>
        <div className="grid grid-cols-1 gap-1.5">
          {selectedQuestion?.answer_display.map((display, i) => {
            const found = allAnswers.some(a => a.is_correct && a.matched_index === i)
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                style={{
                  background: found ? 'rgba(0,232,122,0.1)' : 'rgba(255,50,50,0.05)',
                  border: `1px solid ${found ? 'rgba(0,232,122,0.3)' : 'rgba(255,50,50,0.2)'}`,
                  color: found ? 'var(--accent)' : 'rgba(240,240,255,0.5)',
                }}>
                <span className="font-bold w-5 text-center">{i + 1}</span>
                <span>{display}</span>
                {!found && <span className="ml-auto text-xs" style={{ color: 'rgba(255,100,100,0.6)' }}>Missed</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Final leaderboard */}
      <div className="rounded-2xl p-4 mb-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm uppercase tracking-widest mb-4 font-bold" style={{ color: 'rgba(240,240,255,0.4)' }}>Leaderboard</h3>
        <div className="space-y-2">
          {sortedPlayers.map((p, i) => {
            const score = playerScoreMap[p.id]?.size || 0
            const pct = selectedQuestion ? (score / selectedQuestion.answers.length) * 100 : 0
            return (
              <div key={p.id} className="rounded-xl p-3 animate-slide-up"
                style={{
                  background: i === 0 ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${i === 0 ? 'rgba(255,215,0,0.2)' : 'var(--border)'}`,
                  animationDelay: `${i * 100}ms`
                }}>
                <div className="flex items-center gap-3">
                  <span className="text-xl w-8 text-center">{medals[i] || `${i + 1}`}</span>
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className="font-bold">{p.name}</span>
                      <span className="font-black" style={{ color: i === 0 ? 'var(--gold)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                        {score}/{selectedQuestion?.answers.length}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: i === 0 ? 'var(--gold)' : 'var(--accent)' }} />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <button
        onClick={() => router.push('/')}
        className="w-full py-4 rounded-2xl font-bold transition-all active:scale-95"
        style={{ background: 'var(--accent)', color: '#0d0d1a' }}
      >
        New Game
      </button>
    </div>
  )
}

'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Game, type GamePlayer, type Question, type PlayerAnswer } from '@/lib/supabase'

function Header({ status }: { status?: 'host' | 'live' | 'fulltime' }) {
  return (
    <header className="px-5 pt-5 pb-4 flex items-center gap-3 relative z-10">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
          style={{ background: 'var(--mint)', color: 'var(--text-dark)' }}>⚽</div>
        <div className="leading-none">
          <h1 className="font-display text-xl tracking-wide">FOOTY TRIVIA <span style={{ color: 'var(--mint)' }}>SHOTS</span></h1>
          <p className="text-[10px] italic mt-0.5" style={{ color: 'var(--text-faint)' }}>When you shoot, score!</p>
        </div>
      </div>
      {status === 'host' && (
        <span className="ml-auto text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full"
          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
          HOST
        </span>
      )}
      {status === 'live' && (
        <div className="ml-auto flex items-center gap-2 px-3 py-1 rounded-full animate-pulse-glow"
          style={{ background: 'rgba(255,45,85,0.15)', border: '1px solid rgba(255,45,85,0.4)' }}>
          <div className="live-dot" />
          <span className="text-[11px] font-black tracking-wider" style={{ color: 'var(--red)' }}>LIVE</span>
        </div>
      )}
      {status === 'fulltime' && (
        <span className="ml-auto text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full"
          style={{ background: 'var(--gold)', color: 'var(--text-dark)' }}>
          FULL TIME
        </span>
      )}
    </header>
  )
}

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
    <div className="flex items-center justify-center min-h-screen stadium-bg noise">
      <div className="font-display text-2xl" style={{ color: 'var(--mint)' }}>LOADING</div>
    </div>
  )
  if (!game) return null

  const timerPct = game.ends_at ? timeLeft / game.round_duration : 1
  const timerColor = timerPct > 0.5 ? 'var(--mint)' : timerPct > 0.25 ? 'var(--gold)' : 'var(--red)'

  // ── LOBBY ───────────────────────────────────────────────────
  if (game.status === 'lobby') return (
    <div className="min-h-screen stadium-bg noise flex flex-col relative">
      <Header status="host" />
      <div className="flex-1 px-5 pb-10 max-w-xl mx-auto w-full space-y-4 relative z-10">
        {/* Room code - scoreboard style */}
        <div className="card p-6 text-center">
          <p className="label-micro mb-3">Room Code</p>
          <div className="font-display score-big text-[72px] tracking-[0.15em] mb-5" style={{
            background: 'linear-gradient(180deg, #fff 0%, #aaa 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            textShadow: '0 0 40px rgba(0,255,135,0.2)',
          }}>
            {game.code}
          </div>
          <button onClick={copyLink}
            className={copied ? 'btn-primary w-full py-3.5 text-sm' : 'btn-ghost w-full py-3.5 text-sm font-bold'}>
            {copied ? '✓ LINK COPIED' : `SHARE /play/${game.code}`}
          </button>
        </div>

        {/* Squad */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
            <span className="label-micro flex-1">The Squad</span>
            <span className="font-display text-lg tabular" style={{ color: 'var(--mint)' }}>{players.length}</span>
          </div>
          {players.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-3xl mb-2 opacity-30">📱</div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for the squad to join...</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {players.map(p => (
                <span key={p.id}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold animate-slide-up"
                  style={{
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text)',
                  }}>
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Question picker */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
            <span className="label-micro">Choose the Question</span>
          </div>
          <div className="space-y-2">
            {questions.map(q => {
              const selected = selectedQuestion?.id === q.id
              return (
                <button key={q.id} onClick={() => pickQuestion(q)}
                  className="w-full text-left p-4 rounded-xl transition-all active:scale-[0.99] relative overflow-hidden"
                  style={{
                    background: selected ? 'linear-gradient(135deg, rgba(0,255,135,0.12) 0%, rgba(0,255,135,0.04) 100%)' : 'var(--surface-2)',
                    border: `1px solid ${selected ? 'var(--mint)' : 'var(--border)'}`,
                  }}>
                  {selected && <div className="absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl" style={{ background: 'var(--mint-glow)' }} />}
                  <div className="relative flex items-start gap-3">
                    <div className="font-display text-base tabular w-8" style={{ color: selected ? 'var(--mint)' : 'var(--text-faint)' }}>
                      {String(questions.indexOf(q) + 1).padStart(2, '0')}
                    </div>
                    <div className="flex-1">
                      <p className="label-micro mb-1" style={{ color: selected ? 'var(--mint)' : undefined }}>{q.category}</p>
                      <p className="text-sm font-semibold leading-snug">{q.question}</p>
                    </div>
                    {selected && <div className="text-lg" style={{ color: 'var(--mint)' }}>✓</div>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Kick off */}
        <button onClick={goLive}
          disabled={!selectedQuestion || players.length === 0}
          className="btn-primary w-full py-5 font-display text-2xl tracking-wider">
          KICK OFF ⚽
        </button>
        {!selectedQuestion && <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>Pick a question first</p>}
        {selectedQuestion && players.length === 0 && <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>Need at least 1 player in the squad</p>}
      </div>
    </div>
  )

  // ── ACTIVE ──────────────────────────────────────────────────
  if (game.status === 'active') {
    const foundIndices = new Set(allAnswers.map(a => a.matched_index))
    return (
      <div className="min-h-screen stadium-bg noise flex flex-col relative">
        <Header status="live" />
        <div className="flex-1 px-5 pb-10 max-w-xl mx-auto w-full space-y-4 relative z-10">
          {/* Scoreboard timer + question */}
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <div className="text-center shrink-0">
                <p className="label-micro mb-1">Time</p>
                <div className="font-display score-big text-5xl tabular" style={{ color: timerColor, textShadow: `0 0 20px ${timerColor}` }}>
                  {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                </div>
              </div>
              <div className="w-px self-stretch" style={{ background: 'var(--border)' }} />
              <div className="flex-1 min-w-0">
                <p className="label-micro mb-1">{selectedQuestion?.category}</p>
                <p className="font-bold text-sm leading-snug">{selectedQuestion?.question}</p>
              </div>
            </div>
            {/* Progress */}
            <div className="mt-4 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <div className="h-full transition-all duration-1000 ease-linear"
                style={{ width: `${timerPct * 100}%`, background: timerColor, boxShadow: `0 0 10px ${timerColor}` }} />
            </div>
          </div>

          {/* Answers grid */}
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
              <span className="label-micro flex-1">Goals Scored</span>
              <span className="font-display text-lg tabular" style={{ color: 'var(--mint)' }}>
                {foundIndices.size}<span style={{ color: 'var(--text-faint)' }}>/{selectedQuestion?.answers.length}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {selectedQuestion?.answer_display.map((display, i) => {
                const found = foundIndices.has(i)
                return (
                  <div key={i} className={`px-3 py-2.5 rounded-lg text-xs ${found ? 'animate-pop-in' : ''}`}
                    style={{
                      background: found ? 'linear-gradient(135deg, rgba(0,255,135,0.14) 0%, rgba(0,255,135,0.04) 100%)' : 'var(--surface-2)',
                      border: `1px solid ${found ? 'rgba(0,255,135,0.4)' : 'var(--border)'}`,
                      color: found ? 'var(--mint)' : 'var(--text-faint)',
                    }}>
                    <span className="font-display tabular text-sm mr-1">{i + 1}.</span>
                    <span className="font-semibold">{found ? display.split('(')[0].trim() : '???'}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live table */}
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
              <span className="label-micro">Live Table</span>
            </div>
            <div className="space-y-1.5">
              {sortedPlayers.map((p, i) => {
                const goals = playerGoals[p.id]?.size || 0
                return (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                    style={{ background: i === 0 && goals > 0 ? 'linear-gradient(90deg, rgba(255,214,10,0.1) 0%, var(--surface-2) 100%)' : 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <span className="font-display tabular text-sm w-6 text-center"
                      style={{ color: i === 0 && goals > 0 ? 'var(--gold)' : 'var(--text-muted)' }}>
                      {i + 1}
                    </span>
                    <span className="flex-1 font-semibold text-sm">{p.name}</span>
                    <span className="font-display tabular text-2xl" style={{ color: i === 0 && goals > 0 ? 'var(--gold)' : 'var(--mint)' }}>
                      {goals}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <button onClick={endRound}
            className="btn-ghost w-full py-3.5 text-sm font-bold"
            style={{ color: 'var(--red)', borderColor: 'rgba(255,45,85,0.3)' }}>
            BLOW THE WHISTLE
          </button>
        </div>
      </div>
    )
  }

  // ── FINISHED ────────────────────────────────────────────────
  const medals = ['🥇', '🥈', '🥉']
  return (
    <div className="min-h-screen stadium-bg noise flex flex-col relative">
      <Header status="fulltime" />
      <div className="flex-1 px-5 pb-10 max-w-xl mx-auto w-full space-y-4 relative z-10">
        <div className="text-center py-6">
          <div className="text-5xl mb-3">🏆</div>
          <h2 className="font-display text-5xl tracking-tight" style={{ color: 'var(--text)' }}>FULL TIME</h2>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>{selectedQuestion?.question}</p>
        </div>

        {/* Final table */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-1 h-5 rounded-full" style={{ background: 'var(--gold)' }} />
            <span className="label-micro">Final Table</span>
          </div>
          <div className="space-y-2">
            {sortedPlayers.map((p, i) => {
              const goals = playerGoals[p.id]?.size || 0
              const pct = selectedQuestion ? (goals / selectedQuestion.answers.length) * 100 : 0
              return (
                <div key={p.id} className="rounded-xl p-4 animate-slide-up relative overflow-hidden"
                  style={{
                    background: i === 0 ? 'linear-gradient(135deg, rgba(255,214,10,0.12) 0%, rgba(255,214,10,0.03) 100%)' : 'var(--surface-2)',
                    border: `1px solid ${i === 0 ? 'rgba(255,214,10,0.4)' : 'var(--border)'}`,
                    animationDelay: `${i * 80}ms`
                  }}>
                  {i === 0 && <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full blur-3xl" style={{ background: 'rgba(255,214,10,0.3)' }} />}
                  <div className="relative flex items-center gap-3 mb-2">
                    <span className="text-2xl w-8">{medals[i] || ''}</span>
                    {!medals[i] && <span className="font-display text-xl tabular w-8" style={{ color: 'var(--text-faint)' }}>{i + 1}</span>}
                    <span className="flex-1 font-bold">{p.name}</span>
                    <div className="text-right">
                      <span className="font-display score-big text-4xl tabular" style={{ color: i === 0 ? 'var(--gold)' : 'var(--mint)' }}>
                        {goals}
                      </span>
                      <span className="font-display text-lg ml-1 tabular" style={{ color: 'var(--text-faint)' }}>
                        /{selectedQuestion?.answers.length}
                      </span>
                    </div>
                  </div>
                  <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: i === 0 ? 'var(--gold)' : 'var(--mint)' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Answer reveal */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
            <span className="label-micro">The Answers</span>
          </div>
          <div className="space-y-1.5">
            {selectedQuestion?.answer_display.map((display, i) => {
              const found = allAnswers.some(a => a.matched_index === i)
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
                  style={{
                    background: found ? 'rgba(0,255,135,0.06)' : 'rgba(255,45,85,0.04)',
                    border: `1px solid ${found ? 'rgba(0,255,135,0.2)' : 'rgba(255,45,85,0.15)'}`,
                  }}>
                  <span className="font-display tabular text-sm w-6" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                  <span className="flex-1 font-medium" style={{ color: found ? 'var(--mint)' : 'var(--text-muted)' }}>{display}</span>
                  {!found && <span className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--red)' }}>MISSED</span>}
                </div>
              )
            })}
          </div>
        </div>

        <button onClick={() => router.push('/')}
          className="btn-primary w-full py-4 font-display text-xl tracking-wider">
          NEW MATCH ⚽
        </button>
      </div>
    </div>
  )
}

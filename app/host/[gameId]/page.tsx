'use client'

import { use, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, type Game, type GamePlayer, type Question, type PlayerAnswer } from '@/lib/supabase'

// ─── helpers ───────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '–'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

interface PlayerStat {
  goals: Set<number>
  lastGoalMs: number // timestamp of last correct answer (for speed tiebreaker)
  shots: number
}

function buildStats(
  answers: PlayerAnswer[],
  shots: PlayerAnswer[],
  players: GamePlayer[],
): Record<string, PlayerStat> {
  const stats: Record<string, PlayerStat> = {}
  for (const p of players) stats[p.id] = { goals: new Set(), lastGoalMs: Infinity, shots: 0 }
  for (const a of answers) {
    if (a.matched_index !== null && stats[a.player_id]) {
      stats[a.player_id].goals.add(a.matched_index)
      const t = new Date(a.created_at).getTime()
      if (t > (stats[a.player_id].lastGoalMs === Infinity ? -Infinity : stats[a.player_id].lastGoalMs)) {
        stats[a.player_id].lastGoalMs = t
      }
    }
  }
  for (const s of shots) {
    if (stats[s.player_id]) stats[s.player_id].shots++
  }
  return stats
}

function sortPlayers(players: GamePlayer[], stats: Record<string, PlayerStat>): GamePlayer[] {
  return [...players].sort((a, b) => {
    const sa = stats[a.id], sb = stats[b.id]
    if (!sa || !sb) return 0
    if (sb.goals.size !== sa.goals.size) return sb.goals.size - sa.goals.size // goals desc
    if (sa.lastGoalMs !== sb.lastGoalMs) return sa.lastGoalMs - sb.lastGoalMs // faster wins
    return sa.shots - sb.shots // fewer shots wins
  })
}

/** Sum goals across all rounds per player */
function buildOverallStats(
  allAnswers: PlayerAnswer[],
  allShots: PlayerAnswer[],
  players: GamePlayer[],
  totalRounds: number,
): Record<string, { goals: number; lastGoalMs: number; shots: number }> {
  const stats: Record<string, { goals: number; lastGoalMs: number; shots: number }> = {}
  for (const p of players) stats[p.id] = { goals: 0, lastGoalMs: Infinity, shots: 0 }
  for (let r = 1; r <= totalRounds; r++) {
    const rAnswers = allAnswers.filter(a => a.round_number === r)
    const rShots = allShots.filter(a => a.round_number === r)
    const goalSets: Record<string, Set<number>> = {}
    for (const p of players) goalSets[p.id] = new Set()
    for (const a of rAnswers) {
      if (a.matched_index !== null && goalSets[a.player_id]) {
        goalSets[a.player_id].add(a.matched_index)
        const t = new Date(a.created_at).getTime()
        if (t > (stats[a.player_id].lastGoalMs === Infinity ? -Infinity : stats[a.player_id].lastGoalMs)) {
          stats[a.player_id].lastGoalMs = t
        }
      }
    }
    for (const [pid, gs] of Object.entries(goalSets)) {
      if (stats[pid]) stats[pid].goals += gs.size
    }
    for (const s of rShots) {
      if (stats[s.player_id]) stats[s.player_id].shots++
    }
  }
  return stats
}

// ─── header ────────────────────────────────────────────────────────────────

function Header({ status, round, totalRounds }: { status?: 'host' | 'live' | 'fulltime'; round?: number; totalRounds?: number }) {
  return (
    <header className="px-5 pt-5 pb-4 flex items-center gap-3 relative z-10">
      <Link href="/" className="flex items-center gap-2.5 no-underline" style={{ textDecoration: 'none' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
          style={{ background: 'var(--mint)', color: 'var(--text-dark)' }}>⚽</div>
        <div className="leading-none">
          <h1 className="font-display text-xl tracking-wide">FOOTY TRIVIA <span style={{ color: 'var(--mint)' }}>SHOTS</span></h1>
          <p className="text-[10px] italic mt-0.5" style={{ color: 'var(--text-faint)' }}>When you shoot, score!</p>
        </div>
      </Link>
      <div className="ml-auto flex items-center gap-2">
        {(totalRounds ?? 1) > 1 && round != null && (
          <span className="text-[10px] font-bold tracking-wider px-2 py-1 rounded-full"
            style={{ background: 'var(--surface-2)', color: 'var(--mint)', border: '1px solid rgba(0,255,135,0.3)' }}>
            R{round}/{totalRounds}
          </span>
        )}
        {status === 'host' && (
          <span className="text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full"
            style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>HOST</span>
        )}
        {status === 'live' && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full animate-pulse-glow"
            style={{ background: 'rgba(255,45,85,0.15)', border: '1px solid rgba(255,45,85,0.4)' }}>
            <div className="live-dot" />
            <span className="text-[11px] font-black tracking-wider" style={{ color: 'var(--red)' }}>LIVE</span>
          </div>
        )}
        {status === 'fulltime' && (
          <span className="text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full"
            style={{ background: 'var(--gold)', color: 'var(--text-dark)' }}>FULL TIME</span>
        )}
      </div>
    </header>
  )
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function HostPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = use(params)
  const router = useRouter()

  const [game, setGame] = useState<Game | null>(null)
  const [players, setPlayers] = useState<GamePlayer[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [allAnswers, setAllAnswers] = useState<PlayerAnswer[]>([])   // all correct
  const [allShots, setAllShots] = useState<PlayerAnswer[]>([])       // all attempts
  const [timeLeft, setTimeLeft] = useState(0)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [expandedCats, setExpandedCats] = useState<Record<number, Set<string>>>({}) // roundIndex → open category names
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const roundEndedRef = useRef(false) // use ref not state to avoid stale-closure issues in timer
  const gameRef = useRef<Game | null>(null) // always-fresh game snapshot for the timer

  // ── initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [{ data: gameData }, { data: qData }] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).single(),
        supabase.from('questions').select('*').order('category').order('question'),
      ])
      if (!gameData) { router.push('/'); return }
      setGame(gameData as Game)
      setQuestions((qData as Question[]) || [])
      setLoading(false)
    }
    load()
  }, [gameId, router])

  const loadPlayers = useCallback(async () => {
    const { data } = await supabase.from('game_players').select('*').eq('game_id', gameId).order('created_at')
    setPlayers((data as GamePlayer[]) || [])
  }, [gameId])

  const loadAnswers = useCallback(async () => {
    const { data } = await supabase.from('player_answers').select('*').eq('game_id', gameId)
    const all = (data as PlayerAnswer[]) || []
    setAllShots(all)
    setAllAnswers(all.filter(a => a.is_correct))
  }, [gameId])

  const refetchGame = useCallback(async () => {
    const { data } = await supabase.from('games').select('*').eq('id', gameId).single()
    if (data) { setGame(data as Game); gameRef.current = data as Game }
  }, [gameId])

  // ── realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`game:${gameId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'player-joined' }, () => { loadPlayers() })
      .on('broadcast', { event: 'answer-scored' }, () => { loadPlayers(); loadAnswers() })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { refetchGame(); loadPlayers(); loadAnswers() }
      })
    channelRef.current = ch
    return () => { supabase.removeChannel(ch); channelRef.current = null }
  }, [gameId, loadPlayers, loadAnswers, refetchGame])

  // 3s polling safety net
  useEffect(() => {
    const t = setInterval(() => {
      loadPlayers()
      if (game?.status === 'active') loadAnswers()
    }, 3000)
    return () => clearInterval(t)
  }, [loadPlayers, loadAnswers, game?.status])

  useEffect(() => {
    if (game?.status === 'active' || game?.status === 'between_rounds' || game?.status === 'finished') {
      loadAnswers()
    }
  }, [game?.status, loadAnswers])

  // Keep gameRef in sync on every render so timer callbacks always have fresh state
  useEffect(() => { gameRef.current = game }, [game])

  // ── timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!game?.ends_at || game.status !== 'active') return
    roundEndedRef.current = false
    const endsAt = new Date(game.ends_at).getTime()
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setTimeLeft(left)
      if (left <= 0 && !roundEndedRef.current) {
        roundEndedRef.current = true
        // Use gameRef for fresh state — avoids stale closure
        const g = gameRef.current
        if (!g || g.status !== 'active') return
        const isLast = (g.current_round || 1) >= (g.total_rounds || 1)
        const newStatus = isLast ? 'finished' : 'between_rounds'
        supabase.from('games').update({ status: newStatus }).eq('id', gameId).select().single()
          .then(({ data }) => {
            if (data) { setGame(data as Game); gameRef.current = data as Game }
            channelRef.current?.send({ type: 'broadcast', event: 'game-changed', payload: {} })
          })
      }
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.ends_at, game?.status, gameId])

  // ── actions ───────────────────────────────────────────────────────────────
  async function broadcastGameChanged() {
    await channelRef.current?.send({ type: 'broadcast', event: 'game-changed', payload: {} })
  }

  async function pickQuestion(roundIndex: number, q: Question) {
    if (!game) return
    const ids = [...(game.round_question_ids || [])]
    ids[roundIndex] = q.id
    const { data } = await supabase.from('games').update({ round_question_ids: ids }).eq('id', gameId).select().single()
    if (data) setGame(data as Game)
  }

  async function goLive() {
    if (!game) return
    const startingRound = game.current_round || 1
    const questionId = game.round_question_ids[startingRound - 1]
    if (!questionId) return
    const duration = 180
    const { data } = await supabase.from('games').update({
      status: 'active',
      current_round: startingRound,
      question_id: questionId,
      started_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + duration * 1000).toISOString(),
      round_duration: duration,
    }).eq('id', gameId).select().single()
    if (data) setGame(data as Game)
    await broadcastGameChanged()
  }

  async function endRound() {
    if (!game || game.status !== 'active') return  // only end if actively running
    roundEndedRef.current = true // prevent timer double-fire
    const isLastRound = (game.current_round || 1) >= (game.total_rounds || 1)
    const newStatus = isLastRound ? 'finished' : 'between_rounds'
    const { data } = await supabase.from('games').update({ status: newStatus }).eq('id', gameId).select().single()
    if (data) { setGame(data as Game); gameRef.current = data as Game }
    await broadcastGameChanged()
  }

  async function nextRound() {
    if (!game) return
    const newRound = (game.current_round || 1) + 1
    const questionId = game.round_question_ids[newRound - 1]
    if (!questionId) return
    const duration = 180
    const { data } = await supabase.from('games').update({
      status: 'active',
      current_round: newRound,
      question_id: questionId,
      started_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + duration * 1000).toISOString(),
      round_duration: duration,
    }).eq('id', gameId).select().single()
    if (data) { setGame(data as Game); gameRef.current = data as Game; roundEndedRef.current = false }
    await broadcastGameChanged()
  }

  async function kickPlayer(playerId: string) {
    await supabase.from('game_players').delete().eq('id', playerId)
    setPlayers(prev => prev.filter(p => p.id !== playerId))
    channelRef.current?.send({ type: 'broadcast', event: 'player-kicked', payload: { playerId } })
  }

  async function createRematch() {
    if (!game) return
    const { data: newGame } = await supabase
      .from('games')
      .insert({ code: Math.random().toString(36).slice(2, 8).toUpperCase(), total_rounds: game.total_rounds })
      .select().single()
    if (newGame) router.push(`/host/${newGame.id}`)
  }

  function copyLink() {
    if (!game) return
    navigator.clipboard.writeText(`${window.location.origin}/play/${game.code}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function shareWhatsApp() {
    if (!game) return
    const link = `${window.location.origin}/play/${game.code}`
    const text = encodeURIComponent(`⚽ Footy Trivia Shots!\nJoin my game (code: ${game.code})\n${link}`)
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  // ── derived data ──────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen stadium-bg noise">
      <div className="font-display text-2xl" style={{ color: 'var(--mint)' }}>LOADING</div>
    </div>
  )
  if (!game) return null

  const totalRounds = game.total_rounds || 1
  const currentRound = game.current_round || 1
  const roundQIds: string[] = game.round_question_ids || []
  const allRoundsHaveQuestions = roundQIds.filter(Boolean).length >= totalRounds

  // Current round question
  const currentQ = questions.find(q => q.id === roundQIds[currentRound - 1]) ?? null

  // Filter answers to current round
  const roundAnswers = allAnswers.filter(a => a.round_number === currentRound)
  const roundShots = allShots.filter(a => a.round_number === currentRound)
  const roundStats = buildStats(roundAnswers, roundShots, players)
  const roundSorted = sortPlayers(players, roundStats)

  // Count how many players found each answer index in current round
  const answerCounts: Record<number, number> = {}
  for (const [, stat] of Object.entries(roundStats)) {
    for (const idx of stat.goals) {
      answerCounts[idx] = (answerCounts[idx] || 0) + 1
    }
  }

  // Overall stats across all rounds (for final view)
  const overallStats = buildOverallStats(allAnswers, allShots, players, totalRounds)
  const overallSorted = [...players].sort((a, b) => {
    const sa = overallStats[a.id], sb = overallStats[b.id]
    if (!sa || !sb) return 0
    if (sb.goals !== sa.goals) return sb.goals - sa.goals
    if (sa.lastGoalMs !== sb.lastGoalMs) return sa.lastGoalMs - sb.lastGoalMs
    return sa.shots - sb.shots
  })

  const timerPct = game.ends_at ? timeLeft / game.round_duration : 1
  const timerColor = timerPct > 0.5 ? 'var(--mint)' : timerPct > 0.25 ? 'var(--gold)' : 'var(--red)'
  const medals = ['🥇', '🥈', '🥉']

  // ── LOBBY ─────────────────────────────────────────────────────────────────
  if (game.status === 'lobby') return (
    <div className="min-h-screen stadium-bg noise flex flex-col relative">
      <Header status="host" />
      <div className="flex-1 px-5 pb-10 max-w-xl mx-auto w-full space-y-4 relative z-10">
        {/* Room code */}
        <div className="card p-6 text-center">
          <p className="label-micro mb-3">Room Code</p>
          <div className="font-display score-big text-[72px] tracking-[0.15em] mb-5" style={{
            background: 'linear-gradient(180deg, #fff 0%, #aaa 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>{game.code}</div>
          <div className="flex gap-2">
            <button onClick={copyLink}
              className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${copied ? 'btn-primary' : 'btn-ghost'}`}>
              {copied ? '✓ COPIED' : `COPY LINK`}
            </button>
            <button onClick={shareWhatsApp}
              className="flex-1 py-3 text-sm font-bold rounded-xl transition-all"
              style={{ background: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.4)', color: '#25D366' }}>
              WHATSAPP 📲
            </button>
          </div>
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
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for the squad to join…</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {players.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg animate-slide-up"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <span className="flex-1 font-semibold text-sm">{p.name}</span>
                  <button onClick={() => kickPlayer(p.id)}
                    title="Remove player"
                    className="text-xs px-2 py-1 rounded-lg opacity-40 hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(255,45,85,0.15)', color: 'var(--red)' }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Question pickers — one per round */}
        {Array.from({ length: totalRounds }, (_, ri) => {
          const pickedId = roundQIds[ri]
          const pickedQ = questions.find(q => q.id === pickedId)
          return (
            <div key={ri} className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-5 rounded-full" style={{ background: pickedId ? 'var(--mint)' : 'var(--border)' }} />
                <span className="label-micro flex-1">
                  {totalRounds > 1 ? `Round ${ri + 1} Question` : 'Choose the Question'}
                </span>
                {pickedQ && <span className="text-[10px] font-bold" style={{ color: 'var(--mint)' }}>✓ PICKED</span>}
              </div>
              {pickedQ && (
                <div className="mb-3 px-3 py-2.5 rounded-lg text-xs"
                  style={{ background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.25)' }}>
                  <p className="label-micro mb-0.5" style={{ color: 'var(--mint)' }}>{pickedQ.category}</p>
                  <p className="font-semibold text-sm leading-snug" style={{ color: 'var(--text)' }}>{pickedQ.question}</p>
                </div>
              )}
              <div className="space-y-1">
                {(() => {
                  const available = questions.filter(q => !roundQIds.some((id, idx) => id === q.id && idx !== ri))
                  const byCategory = available.reduce<Record<string, Question[]>>((acc, q) => {
                    ;(acc[q.category] = acc[q.category] || []).push(q)
                    return acc
                  }, {})
                  const openCats = expandedCats[ri] ?? new Set<string>()
                  return Object.entries(byCategory).map(([cat, qs]) => {
                    const isOpen = openCats.has(cat)
                    const hasSel = qs.some(q => q.id === pickedId)
                    return (
                      <div key={cat}>
                        <button
                          onClick={() => {
                            const next = new Set(openCats)
                            isOpen ? next.delete(cat) : next.add(cat)
                            setExpandedCats(prev => ({ ...prev, [ri]: next }))
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
                          style={{ background: hasSel ? 'rgba(0,255,135,0.06)' : 'var(--surface-2)', border: `1px solid ${hasSel ? 'rgba(0,255,135,0.2)' : 'var(--border)'}` }}>
                          <span className="label-micro flex-1 text-left"
                            style={{ color: hasSel ? 'var(--mint)' : 'var(--text-muted)' }}>
                            {cat}
                            {hasSel && ' ✓'}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{qs.length}</span>
                          <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{isOpen ? '▲' : '▼'}</span>
                        </button>
                        {isOpen && (
                          <div className="mt-1 ml-2 space-y-1 mb-2">
                            {qs.map(q => {
                              const sel = pickedId === q.id
                              return (
                                <button key={q.id} onClick={() => pickQuestion(ri, q)}
                                  className="w-full text-left px-3 py-2.5 rounded-xl transition-all active:scale-[0.99]"
                                  style={{
                                    background: sel ? 'rgba(0,255,135,0.12)' : 'var(--surface)',
                                    border: `1px solid ${sel ? 'var(--mint)' : 'var(--border)'}`,
                                  }}>
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-semibold leading-snug flex-1">{q.question}</p>
                                    {sel && <span className="text-[10px] font-bold shrink-0" style={{ color: 'var(--mint)' }}>✓</span>}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          )
        })}

        {/* Kick off */}
        <button onClick={goLive}
          disabled={!allRoundsHaveQuestions || players.length === 0}
          className="btn-primary w-full py-5 font-display text-2xl tracking-wider">
          KICK OFF {totalRounds > 1 ? 'ROUND 1 ' : ''}⚽
        </button>
        {!allRoundsHaveQuestions && (
          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            Pick {totalRounds > 1 ? 'a question for each round' : 'a question'} first
          </p>
        )}
        {allRoundsHaveQuestions && players.length === 0 && (
          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>Need at least 1 player</p>
        )}
      </div>
    </div>
  )

  // ── ACTIVE ────────────────────────────────────────────────────────────────
  if (game.status === 'active') {
    const foundIndices = new Set(roundAnswers.map(a => a.matched_index))
    return (
      <div className="min-h-screen stadium-bg noise flex flex-col relative">
        <Header status="live" round={currentRound} totalRounds={totalRounds} />
        <div className="flex-1 px-5 pb-10 max-w-xl mx-auto w-full space-y-4 relative z-10">
          {/* Timer + question */}
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
                <p className="label-micro mb-1">{currentQ?.category}</p>
                <p className="font-bold text-sm leading-snug">{currentQ?.question}</p>
              </div>
            </div>
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
                {foundIndices.size}<span style={{ color: 'var(--text-faint)' }}>/{currentQ?.answers.length}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {currentQ?.answer_display.map((display, i) => {
                const found = foundIndices.has(i)
                const count = answerCounts[i] || 0
                return (
                  <div key={i} className={`px-3 py-2.5 rounded-lg text-xs flex items-center gap-1.5 ${found ? 'animate-pop-in' : ''}`}
                    style={{
                      background: found ? 'rgba(0,255,135,0.12)' : 'var(--surface-2)',
                      border: `1px solid ${found ? 'rgba(0,255,135,0.4)' : 'var(--border)'}`,
                    }}>
                    <span className="font-display tabular text-sm shrink-0" style={{ color: found ? 'var(--mint)' : 'var(--text-faint)' }}>{i + 1}.</span>
                    <span className="font-semibold flex-1 truncate" style={{ color: found ? 'var(--mint)' : 'var(--text-faint)' }}>
                      {found ? display.split('(')[0].trim() : '???'}
                    </span>
                    {found && (
                      <span className="font-display tabular text-[11px] px-1 py-0.5 rounded shrink-0"
                        style={{ background: 'rgba(0,255,135,0.25)', color: 'var(--mint)' }}>{count}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live table */}
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
              <span className="label-micro flex-1">Live Table</span>
              {totalRounds > 1 && <span className="label-micro" style={{ color: 'var(--text-faint)' }}>Round {currentRound}</span>}
            </div>
            <div className="space-y-1.5">
              {roundSorted.map((p, i) => {
                const stat = roundStats[p.id]
                const goals = stat?.goals.size || 0
                const shots = stat?.shots || 0
                const isTop = i === 0 && goals > 0
                return (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                    style={{ background: isTop ? 'rgba(255,214,10,0.08)' : 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <span className="font-display tabular text-sm w-6 text-center"
                      style={{ color: isTop ? 'var(--gold)' : 'var(--text-muted)' }}>{i + 1}</span>
                    <span className="flex-1 font-semibold text-sm">{p.name}</span>
                    <span className="text-[10px] tabular mr-1" style={{ color: 'var(--text-faint)' }}>{shots}🎯</span>
                    <span className="font-display tabular text-2xl" style={{ color: isTop ? 'var(--gold)' : 'var(--mint)' }}>{goals}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <button onClick={endRound} className="btn-ghost w-full py-3.5 text-sm font-bold"
            style={{ color: 'var(--red)', borderColor: 'rgba(255,45,85,0.3)' }}>
            BLOW THE WHISTLE 🔴
          </button>
        </div>
      </div>
    )
  }

  // ── BETWEEN ROUNDS ────────────────────────────────────────────────────────
  if (game.status === 'between_rounds') {
    const completedRound = currentRound
    const completedQ = questions.find(q => q.id === roundQIds[completedRound - 1])
    const nextQ = questions.find(q => q.id === roundQIds[currentRound])
    return (
      <div className="min-h-screen stadium-bg noise flex flex-col relative">
        <Header status="host" round={completedRound} totalRounds={totalRounds} />
        <div className="flex-1 px-5 pb-10 max-w-xl mx-auto w-full space-y-4 relative z-10">

          {/* Round done title */}
          <div className="text-center py-4">
            <div className="text-4xl mb-2">🏁</div>
            <h2 className="font-display text-4xl tracking-tight" style={{ color: 'var(--text)' }}>
              ROUND {completedRound} DONE
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{completedQ?.question}</p>
          </div>

          {/* KICK OFF button — shown at top so it's always visible */}
          <button onClick={nextRound}
            disabled={!roundQIds[currentRound]}
            className="btn-primary w-full py-5 font-display text-2xl tracking-wider">
            KICK OFF ROUND {currentRound + 1} ⚽
          </button>
          {nextQ && (
            <p className="text-center text-xs -mt-2" style={{ color: 'var(--text-muted)' }}>
              Next: {nextQ.question}
            </p>
          )}
          {!roundQIds[currentRound] && (
            <p className="text-center text-xs -mt-2" style={{ color: 'var(--red)' }}>
              No question set for round {currentRound + 1}
            </p>
          )}

          {/* Round leaderboard */}
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
              <span className="label-micro">Round {completedRound} Table</span>
            </div>
            <div className="space-y-2">
              {roundSorted.map((p, i) => {
                const stat = roundStats[p.id]
                const goals = stat?.goals.size || 0
                const shots = stat?.shots || 0
                const timeMs = stat?.lastGoalMs !== Infinity ? stat.lastGoalMs - (game.started_at ? new Date(game.started_at).getTime() : 0) : Infinity
                return (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-3 rounded-xl"
                    style={{
                      background: i === 0 && goals > 0 ? 'rgba(255,214,10,0.1)' : 'var(--surface-2)',
                      border: `1px solid ${i === 0 && goals > 0 ? 'rgba(255,214,10,0.3)' : 'var(--border)'}`,
                    }}>
                    <span className="text-xl w-8">{medals[i] || ''}</span>
                    {!medals[i] && <span className="font-display text-lg tabular w-8 text-center" style={{ color: 'var(--text-faint)' }}>{i + 1}</span>}
                    <span className="flex-1 font-bold">{p.name}</span>
                    <div className="text-right">
                      <div className="font-display text-2xl tabular" style={{ color: i === 0 && goals > 0 ? 'var(--gold)' : 'var(--mint)' }}>{goals}</div>
                      <div className="text-[10px] tabular" style={{ color: 'var(--text-faint)' }}>
                        {fmtTime(timeMs)} · {shots}🎯
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    )
  }

  // ── FINISHED ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen stadium-bg noise flex flex-col relative">
      <Header status="fulltime" totalRounds={totalRounds} />
      <div className="flex-1 px-5 pb-10 max-w-xl mx-auto w-full space-y-4 relative z-10">
        <div className="text-center py-6">
          <div className="text-5xl mb-3">🏆</div>
          <h2 className="font-display text-5xl tracking-tight" style={{ color: 'var(--text)' }}>FULL TIME</h2>
          {totalRounds > 1 && (
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{totalRounds}-round match · overall standings</p>
          )}
        </div>

        {/* Overall leaderboard */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-1 h-5 rounded-full" style={{ background: 'var(--gold)' }} />
            <span className="label-micro">{totalRounds > 1 ? 'Overall Table' : 'Final Table'}</span>
          </div>
          <div className="space-y-2">
            {(() => {
              const maxAnswers = totalRounds * 10
              const gameStartMs = game.started_at ? new Date(game.started_at).getTime() : 0
              return overallSorted.map((p, i) => {
                const stat = overallStats[p.id]
                const goals = stat?.goals || 0
                const shots = stat?.shots || 0
                const pct = maxAnswers > 0 ? (goals / maxAnswers) * 100 : 0
                const gotPerfect = goals === maxAnswers && goals > 0
                const prevGoals = i > 0 ? (overallStats[overallSorted[i - 1].id]?.goals || 0) : -1
                const nextGoals = i < overallSorted.length - 1 ? (overallStats[overallSorted[i + 1].id]?.goals || 0) : -1
                const isTied = goals > 0 && (goals === prevGoals || goals === nextGoals)
                const showTime = (gotPerfect || isTied) && stat?.lastGoalMs !== Infinity
                const timeStr = showTime ? fmtTime(stat.lastGoalMs - gameStartMs) : ''
                return (
                  <div key={p.id} className="rounded-xl p-4 animate-slide-up relative overflow-hidden"
                    style={{
                      background: i === 0 ? 'linear-gradient(135deg, rgba(255,214,10,0.12) 0%, rgba(255,214,10,0.03) 100%)' : 'var(--surface-2)',
                      border: `1px solid ${i === 0 ? 'rgba(255,214,10,0.4)' : 'var(--border)'}`,
                      animationDelay: `${i * 80}ms`,
                    }}>
                    {i === 0 && <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full blur-3xl" style={{ background: 'rgba(255,214,10,0.3)' }} />}
                    <div className="relative flex items-center gap-3 mb-2">
                      <span className="text-2xl w-8">{medals[i] || ''}</span>
                      {!medals[i] && <span className="font-display text-xl tabular w-8" style={{ color: 'var(--text-faint)' }}>{i + 1}</span>}
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate">{p.name}</div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="text-[10px] px-1.5 py-0.5 rounded tabular"
                            style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            🎯 {shots} shot{shots === 1 ? '' : 's'}
                          </span>
                          {showTime && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded tabular"
                              style={{ background: 'rgba(0,255,135,0.1)', color: 'var(--mint)', border: '1px solid rgba(0,255,135,0.2)' }}>
                              ⏱ {timeStr}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-display score-big text-4xl tabular" style={{ color: i === 0 ? 'var(--gold)' : 'var(--mint)' }}>{goals}</span>
                        <span className="font-display text-lg ml-1 tabular" style={{ color: 'var(--text-faint)' }}>/{maxAnswers}</span>
                      </div>
                    </div>
                    <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: i === 0 ? 'var(--gold)' : 'var(--mint)' }} />
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        </div>

        {/* Answer reveals per round */}
        {Array.from({ length: totalRounds }, (_, ri) => {
          const rq = questions.find(q => q.id === roundQIds[ri])
          if (!rq) return null
          const rAnswers = allAnswers.filter(a => a.round_number === ri + 1)
          const foundSet = new Set(rAnswers.map(a => a.matched_index))
          return (
            <div key={ri} className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
                <div className="flex-1">
                  <span className="label-micro block">{totalRounds > 1 ? `Round ${ri + 1} Answers` : 'The Answers'}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{rq.question}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {rq.answer_display.map((display, i) => {
                  const found = foundSet.has(i)
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
          )
        })}

        <div className="flex gap-3">
          <button onClick={createRematch} className="btn-ghost flex-1 py-4 font-display text-lg tracking-wider">
            🔁 REMATCH
          </button>
          <button onClick={() => router.push('/')} className="btn-primary flex-1 py-4 font-display text-lg tracking-wider">
            NEW MATCH ⚽
          </button>
        </div>
      </div>
    </div>
  )
}

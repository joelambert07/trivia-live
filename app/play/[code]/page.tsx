'use client'

import { use, useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { supabase, type Game, type GamePlayer, type Question, type PlayerAnswer, checkAnswer, normalizeAnswer } from '@/lib/supabase'

type Phase = 'join' | 'waiting' | 'playing' | 'between_rounds' | 'finished'

function Header({ status, name }: { status?: string; name?: string }) {
  return (
    <header className="px-5 py-3 flex items-center justify-between border-b relative z-10"
      style={{ borderColor: 'var(--border)', background: 'rgba(10,14,19,0.7)', backdropFilter: 'blur(12px)' }}>
      <Link href="/" className="flex items-center gap-2.5" style={{ textDecoration: 'none' }}>
        <span className="text-lg animate-spin-slow">⚽</span>
        <div className="leading-none">
          <div className="font-display text-lg tracking-tight" style={{ color: 'var(--text)' }}>FOOTY TRIVIA</div>
          <div className="label-micro" style={{ color: 'var(--mint)' }}>When you shoot, score</div>
        </div>
      </Link>
      {status && (
        <div className="flex items-center gap-1.5">
          {status === 'LIVE' && <div className="live-dot" />}
          <span className="label-micro" style={{ color: status === 'LIVE' ? 'var(--red)' : 'var(--text-muted)' }}>{status}</span>
        </div>
      )}
      {!status && name && <span className="label-micro">{name}</span>}
    </header>
  )
}

function fmtTime(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '–'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)

  const [phase, setPhase] = useState<Phase>('join')
  const [name, setName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState('')
  const [game, setGame] = useState<Game | null>(null)
  const [player, setPlayer] = useState<GamePlayer | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [myAnswers, setMyAnswers] = useState<PlayerAnswer[]>([])      // current round
  const [allMyAnswers, setAllMyAnswers] = useState<PlayerAnswer[]>([]) // all rounds (for final)
  const [allPlayers, setAllPlayers] = useState<GamePlayer[]>([])
  const [allCorrectAnswers, setAllCorrectAnswers] = useState<PlayerAnswer[]>([]) // all players, current round
  const [allGameAnswers, setAllGameAnswers] = useState<PlayerAnswer[]>([]) // all players, all rounds
  const [allGameShots, setAllGameShots] = useState<PlayerAnswer[]>([])    // all players, all rounds
  const [inputValue, setInputValue] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [goalFlash, setGoalFlash] = useState(false)
  const [shakeInput, setShakeInput] = useState(false)
  const [shots, setShots] = useState(0)   // current round shots
  const [joining, setJoining] = useState(false)
  const [maxGoalsTotal, setMaxGoalsTotal] = useState<number | null>(null)
  const [ambiguousHint, setAmbiguousHint] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── join ──────────────────────────────────────────────────────────────────
  async function joinGame() {
    const trimmed = nameInput.trim()
    if (!trimmed) { setNameError('Enter your name'); return }
    setJoining(true); setNameError('')
    const { data: gameData } = await supabase.from('games').select('*').eq('code', code.toUpperCase()).single()
    if (!gameData) { setNameError('Game not found. Check the code.'); setJoining(false); return }
    if (gameData.status === 'finished') { setNameError('This game has already ended.'); setJoining(false); return }
    // Prevent accidental duplicate joins
    const { data: existing } = await supabase
      .from('game_players').select('id').eq('game_id', gameData.id).ilike('name', trimmed).maybeSingle()
    if (existing) { setNameError('That name is already taken in this game!'); setJoining(false); return }

    const { data: playerData } = await supabase.from('game_players').insert({ game_id: gameData.id, name: trimmed }).select().single()
    if (!playerData) { setNameError('Failed to join. Try again.'); setJoining(false); return }
    setGame(gameData as Game); setPlayer(playerData as GamePlayer); setName(trimmed)
    if (gameData.status === 'active') {
      setPhase('playing')
      setTimeout(() => inputRef.current?.focus(), 300)
    } else if (gameData.status === 'between_rounds') {
      setPhase('between_rounds')
    } else {
      setPhase('waiting')
    }
    setJoining(false)
  }

  // ── data loaders ──────────────────────────────────────────────────────────
  const loadQuestion = useCallback(async (questionId: string) => {
    const { data } = await supabase.from('questions').select('*').eq('id', questionId).single()
    if (data) setQuestion(data as Question)
  }, [])

  const loadAllData = useCallback(async (gameId: string) => {
    const [{ data: answers }, { data: players }, { data: shots }] = await Promise.all([
      supabase.from('player_answers').select('*').eq('game_id', gameId).eq('is_correct', true),
      supabase.from('game_players').select('*').eq('game_id', gameId),
      supabase.from('player_answers').select('*').eq('game_id', gameId),
    ])
    setAllGameAnswers((answers as PlayerAnswer[]) || [])
    setAllGameShots((shots as PlayerAnswer[]) || [])
    setAllPlayers((players as GamePlayer[]) || [])
  }, [])

  const loadRoundAnswers = useCallback(async (gameId: string, roundNum: number) => {
    const { data } = await supabase
      .from('player_answers').select('*')
      .eq('game_id', gameId).eq('is_correct', true).eq('round_number', roundNum)
    setAllCorrectAnswers((data as PlayerAnswer[]) || [])
  }, [])

  // ── game state applier ────────────────────────────────────────────────────
  const applyGame = useCallback((updated: Game, myPlayerId?: string) => {
    setGame(prev => {
      // If round changed, reset per-round state
      if (prev && updated.current_round !== prev.current_round) {
        setMyAnswers([])
        setShots(0)
      }
      return updated
    })
    if (updated.question_id) loadQuestion(updated.question_id)
    if (updated.status === 'active') {
      setPhase(prev => (prev === 'finished' ? prev : 'playing'))
      setTimeout(() => inputRef.current?.focus(), 300)
    }
    if (updated.status === 'between_rounds') {
      setPhase('between_rounds')
      loadAllData(updated.id)
    }
    if (updated.status === 'finished') {
      setPhase('finished')
      loadAllData(updated.id)
    }
  }, [loadQuestion, loadAllData])

  // ── realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const gameId = game?.id
    if (!gameId) return
    if (game?.question_id) loadQuestion(game.question_id)

    const refetchGame = async () => {
      const { data } = await supabase.from('games').select('*').eq('id', gameId).single()
      if (data) applyGame(data as Game, player?.id)
    }

    const ch = supabase
      .channel(`game:${gameId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'game-changed' }, () => { refetchGame() })
      .on('broadcast', { event: 'answer-scored' }, () => {
        if (game?.status === 'active') loadRoundAnswers(gameId, game.current_round)
      })
      .on('broadcast', { event: 'player-kicked' }, (msg: { payload: { playerId: string } }) => {
        if (msg.payload.playerId === player?.id) {
          setPhase('join')
          setNameInput('')
          setNameError('You were removed from the game by the host.')
          setGame(null); setPlayer(null)
        }
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          refetchGame()
          if (player?.id) {
            ch.send({ type: 'broadcast', event: 'player-joined', payload: { playerId: player.id } })
          }
        }
      })
    channelRef.current = ch
    return () => { supabase.removeChannel(ch); channelRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, player?.id])

  // 3s polling safety net
  useEffect(() => {
    const gameId = game?.id
    if (!gameId || phase === 'finished') return
    const t = setInterval(async () => {
      const { data } = await supabase.from('games').select('*').eq('id', gameId).single()
      if (data) applyGame(data as Game, player?.id)
    }, 3000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, phase, player?.id])

  // Load round answers when entering playing phase
  useEffect(() => {
    if (phase === 'playing' && game?.id && game.current_round) {
      loadRoundAnswers(game.id, game.current_round)
      setTimeout(() => inputRef.current?.focus(), 300)
    }
    if (phase === 'finished' && game) loadAllData(game.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, game?.current_round])

  // When the game finishes, compute the true max goals using actual question answer counts
  useEffect(() => {
    if (phase !== 'finished' || !game) return
    const qIds = (game.round_question_ids || []).filter(Boolean).slice(0, game.total_rounds || 1)
    if (qIds.length === 0) return
    supabase.from('questions').select('id, answers').in('id', qIds).then(({ data }) => {
      if (!data) return
      const countMap: Record<string, number> = {}
      for (const q of data as { id: string; answers: unknown[] }[]) countMap[q.id] = q.answers.length
      setMaxGoalsTotal(qIds.reduce((sum, id) => sum + Math.min(countMap[id] ?? 10, 10), 0))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!game?.ends_at || game.status !== 'active') return
    const tick = () => {
      const left = Math.max(0, Math.ceil((new Date(game.ends_at!).getTime() - Date.now()) / 1000))
      setTimeLeft(left)
      if (left <= 0 && game?.id) {
        setPhase(prev => (prev === 'finished' ? prev : 'finished'))
        loadAllData(game.id)
      }
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [game?.ends_at, game?.status, game?.id, loadAllData])

  // ── answer submission ─────────────────────────────────────────────────────
  async function submitAnswer() {
    if (submitting.current || !inputValue.trim() || !player || !game || !question) return
    submitting.current = true
    const raw = inputValue.trim()
    const normalized = normalizeAnswer(raw)
    setInputValue('')
    setShots(s => s + 1)

    if (myAnswers.some(a => a.answer_normalized === normalized)) {
      submitting.current = false; return
    }
    const { correct, index, ambiguousIndices } = checkAnswer(raw, question.answers)
    if (correct && myAnswers.some(a => a.matched_index === index)) {
      submitting.current = false; return
    }

    if (correct) {
      const optimistic: PlayerAnswer = {
        id: crypto.randomUUID(), game_id: game.id, player_id: player.id,
        answer_raw: raw, answer_normalized: normalized, is_correct: true,
        matched_index: index, created_at: new Date().toISOString(), round_number: game.current_round,
      }
      setMyAnswers(prev => [...prev, optimistic])
      // Self-broadcasts are off, so manually add our own answer to the all-answers counts
      setAllCorrectAnswers(prev => [...prev, optimistic])
      setAmbiguousHint('')
      setGoalFlash(true)
      setTimeout(() => setGoalFlash(false), 900)
    } else if (ambiguousIndices && ambiguousIndices.length > 1) {
      // Multiple answers matched — tell the player to be more specific
      const names = ambiguousIndices.slice(0, 3).map(i =>
        (question.answer_display[i] ?? question.answers[i]).split('(')[0].trim()
      )
      const nameList = names.length === 2 ? `${names[0]} or ${names[1]}` : names.join(', ')
      setAmbiguousHint(`Which one — ${nameList}?`)
      setShakeInput(true)
      setTimeout(() => setShakeInput(false), 400)
    } else {
      setAmbiguousHint('')
      setShakeInput(true)
      setTimeout(() => setShakeInput(false), 400)
    }

    await supabase.from('player_answers').insert({
      game_id: game.id, player_id: player.id, answer_raw: raw,
      answer_normalized: normalized, is_correct: correct,
      matched_index: correct ? index : null, round_number: game.current_round,
    })

    if (correct) {
      channelRef.current?.send({ type: 'broadcast', event: 'answer-scored', payload: { playerId: player.id } })
    }
    submitting.current = false
  }

  // ── JOIN ──────────────────────────────────────────────────────────────────
  if (phase === 'join') return (
    <div className="min-h-screen flex flex-col stadium-bg noise">
      <div className="relative z-10 flex-1 flex flex-col">
        <Header status={code.toUpperCase()} />
        <div className="flex-1 flex flex-col justify-center px-5 py-8 max-w-sm mx-auto w-full">
          <div className="text-center mb-8">
            <div className="relative inline-block mb-5">
              <div className="absolute inset-0 -m-4 rounded-full blur-2xl" style={{ background: 'radial-gradient(circle, var(--mint-glow) 0%, transparent 70%)' }} />
              <div className="relative text-6xl animate-spin-slow">⚽</div>
            </div>
            <h2 className="font-display text-4xl tracking-tight mb-2" style={{ color: 'var(--text)' }}>JOIN THE SQUAD</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Enter your name to line up for kick off</p>
          </div>
          <div className="card p-5">
            <label className="label-micro block mb-2">Your name</label>
            <input autoFocus type="text" value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinGame()}
              placeholder="e.g. Mark" maxLength={20}
              className="w-full px-4 py-3.5 rounded-xl text-lg font-bold outline-none mb-3"
              style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text)' }} />
            {nameError && <p className="text-sm mb-3 font-medium" style={{ color: 'var(--red)' }}>{nameError}</p>}
            <button onClick={joinGame} disabled={joining} className="btn-primary w-full py-4 text-base">
              {joining ? 'JOINING...' : 'JOIN MATCH'}
            </button>
          </div>
          <div className="mt-6 flex items-center justify-center gap-2">
            <span className="label-micro">Room</span>
            <span className="font-display text-xl tracking-widest tabular" style={{ color: 'var(--mint)' }}>{code.toUpperCase()}</span>
          </div>
        </div>
      </div>
    </div>
  )

  // ── WAITING ───────────────────────────────────────────────────────────────
  if (phase === 'waiting') return (
    <div className="min-h-screen flex flex-col stadium-bg noise">
      <div className="relative z-10 flex-1 flex flex-col">
        <Header status="LOBBY" />
        <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 -m-6 rounded-full blur-2xl animate-breathe" style={{ background: 'radial-gradient(circle, var(--mint-glow) 0%, transparent 70%)' }} />
            <div className="relative text-7xl animate-spin-slow">⚽</div>
          </div>
          <p className="label-micro mb-2" style={{ color: 'var(--mint)' }}>You&apos;re in the squad</p>
          <h2 className="font-display text-5xl tracking-tight mb-3" style={{ color: 'var(--text)' }}>{name.toUpperCase()}</h2>
          <p className="text-sm mb-8 max-w-xs" style={{ color: 'var(--text-muted)' }}>Waiting for the manager to kick off. Stay sharp.</p>
          <div className="flex gap-2 justify-center mb-10">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full animate-breathe" style={{ background: 'var(--mint)', animationDelay: `${i*0.25}s` }} />
            ))}
          </div>
          <div className="card px-5 py-3 flex items-center gap-3">
            <span className="label-micro">Room</span>
            <span className="font-display text-2xl tracking-widest tabular" style={{ color: 'var(--mint)' }}>{code.toUpperCase()}</span>
          </div>
        </div>
      </div>
    </div>
  )

  // ── PLAYING ───────────────────────────────────────────────────────────────
  if (phase === 'playing' && question) {
    const goals = myAnswers.length
    const total = Math.min(question.answers.length, 10) // cap at 10 even if more answers exist
    const foundIndices = new Set(myAnswers.map(a => a.matched_index))
    const timerPct = game?.ends_at ? timeLeft / (game.round_duration || 180) : 1
    const timerColor = timerPct > 0.5 ? 'var(--mint)' : timerPct > 0.25 ? 'var(--gold)' : 'var(--red)'
    const mins = Math.floor(timeLeft / 60)
    const secs = String(timeLeft % 60).padStart(2, '0')
    const totalRounds = game?.total_rounds || 1
    const currentRound = game?.current_round || 1

    // Count how many players found each answer index (from allCorrectAnswers)
    const answerCounts: Record<number, number> = {}
    for (const a of allCorrectAnswers) {
      if (a.matched_index !== null) {
        answerCounts[a.matched_index] = (answerCounts[a.matched_index] || 0) + 1
      }
    }

    return (
      <div className="stadium-bg noise flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
        {/* Goal flash overlay */}
        {goalFlash && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, var(--mint-glow) 0%, transparent 60%)' }} />
            <div className="animate-goal flex flex-col items-center relative">
              <div className="text-8xl">⚽</div>
              <div className="font-display text-7xl tracking-tight mt-2"
                style={{ color: 'var(--mint)', textShadow: '0 0 40px rgba(0,255,135,0.8)' }}>GOAL!</div>
            </div>
          </div>
        )}

        {/* ── Sticky top: question + input ── */}
        <div className="shrink-0 relative z-10"
          style={{ background: 'rgba(10,14,19,0.97)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--border)' }}>

          {/* Question */}
          <div className="px-4 pt-3 pb-1.5">
            <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text)' }}>{question.question}</p>
          </div>

          {/* Input row */}
          <div className="px-3 pb-3">
            <div className={`flex gap-2 ${shakeInput ? 'animate-shake' : ''}`}>
              <input ref={inputRef} type="text" value={inputValue}
                onChange={e => { setInputValue(e.target.value); if (ambiguousHint) setAmbiguousHint('') }}
                onKeyDown={e => e.key === 'Enter' && submitAnswer()}
                placeholder="Type a name and hit SHOOT…"
                autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
                className="flex-1 px-4 py-3.5 rounded-xl text-base font-semibold outline-none"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: `1.5px solid ${ambiguousHint ? 'rgba(255,214,10,0.5)' : 'rgba(255,255,255,0.15)'}`,
                  color: 'var(--text)',
                }} />
              <button onClick={submitAnswer}
                className="btn-primary px-5 py-3.5 text-sm font-black tracking-wider shrink-0">
                SHOOT
              </button>
            </div>
            {ambiguousHint && (
              <p className="text-xs font-semibold mt-1.5 px-1 animate-fade-in" style={{ color: 'var(--gold)' }}>
                🤔 {ambiguousHint}
              </p>
            )}
          </div>
        </div>

        {/* ── Answer list — fills remaining space, scrollable if needed ── */}
        <div className="flex-1 min-h-0 overflow-y-auto relative z-10 px-3 pt-2 pb-1">
          <div className="space-y-1.5">
            {(() => {
              const isOpenList = question.answers.length > 10
              if (isOpenList) {
                // Open list: 10 generic slots filled in order of discovery
                return Array.from({ length: 10 }, (_, i) => {
                  const answered = myAnswers[i]
                  const filled = !!answered
                  const displayName = filled
                    ? (question.answer_display[answered.matched_index!] ?? answered.answer_raw).split('(')[0].trim()
                    : null
                  return (
                    <div key={i}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl ${filled ? 'animate-pop-in' : ''}`}
                      style={{
                        background: filled
                          ? 'linear-gradient(135deg, rgba(0,255,135,0.15) 0%, rgba(0,255,135,0.04) 100%)'
                          : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${filled ? 'rgba(0,255,135,0.35)' : 'rgba(255,255,255,0.06)'}`,
                        boxShadow: filled ? '0 0 20px rgba(0,255,135,0.1)' : 'none',
                      }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          background: filled ? 'rgba(0,255,135,0.25)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${filled ? 'rgba(0,255,135,0.4)' : 'rgba(255,255,255,0.08)'}`,
                        }}>
                        <span className="font-display text-xs tabular leading-none"
                          style={{ color: filled ? 'var(--mint)' : 'rgba(255,255,255,0.3)' }}>
                          {i + 1}
                        </span>
                      </div>
                      {filled ? (
                        <span className="flex-1 font-bold text-sm leading-tight" style={{ color: 'var(--text)' }}>
                          {displayName}
                        </span>
                      ) : (
                        <div className="flex-1 flex items-center">
                          <div className="h-px rounded-full" style={{ width: '60%', background: 'rgba(255,255,255,0.08)' }} />
                        </div>
                      )}
                    </div>
                  )
                })
              } else {
                // Closed list: position-specific slots
                return question.answer_display.map((display, i) => {
                  const found = foundIndices.has(i)
                  const stat = display.match(/\(([^)]+)\)/)?.[1] ?? ''
                  return (
                    <div key={i}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl ${found ? 'animate-pop-in' : ''}`}
                      style={{
                        background: found
                          ? 'linear-gradient(135deg, rgba(0,255,135,0.15) 0%, rgba(0,255,135,0.04) 100%)'
                          : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${found ? 'rgba(0,255,135,0.35)' : 'rgba(255,255,255,0.06)'}`,
                        boxShadow: found ? '0 0 20px rgba(0,255,135,0.1)' : 'none',
                      }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          background: found ? 'rgba(0,255,135,0.25)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${found ? 'rgba(0,255,135,0.4)' : 'rgba(255,255,255,0.08)'}`,
                        }}>
                        <span className="font-display text-xs tabular leading-none"
                          style={{ color: found ? 'var(--mint)' : 'rgba(255,255,255,0.3)' }}>
                          {i + 1}
                        </span>
                      </div>
                      {found ? (
                        <span className="flex-1 font-bold text-sm leading-tight" style={{ color: 'var(--text)' }}>
                          {display.split('(')[0].trim()}
                        </span>
                      ) : (
                        <div className="flex-1 flex items-center">
                          <div className="h-px rounded-full" style={{ width: '60%', background: 'rgba(255,255,255,0.08)' }} />
                        </div>
                      )}
                      {found && stat && (
                        <span className="text-[10px] font-semibold tabular px-2 py-1 rounded-lg shrink-0"
                          style={{ background: 'rgba(0,255,135,0.12)', border: '1px solid rgba(0,255,135,0.2)', color: 'var(--mint)' }}>
                          {stat}
                        </span>
                      )}
                    </div>
                  )
                })
              }
            })()}
          </div>
        </div>

        {/* ── Sticky bottom: score strip + timer ── */}
        <div className="shrink-0 relative z-10"
          style={{ background: 'rgba(10,14,19,0.97)', backdropFilter: 'blur(16px)', borderTop: '1px solid var(--border)' }}>
          <div className="px-4 py-2.5 flex items-center gap-3">
            {/* Goals */}
            <div className="flex items-baseline gap-1">
              <span className="font-display text-2xl tabular"
                style={{ color: 'var(--mint)', textShadow: '0 0 12px var(--mint-glow)' }}>
                {String(goals).padStart(2, '0')}
              </span>
              <span className="text-base leading-none">⚽</span>
            </div>
            {/* Progress bar */}
            <div className="flex-1 flex items-center gap-1.5">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(goals / total) * 100}%`, background: 'linear-gradient(90deg, var(--mint) 0%, #7dffb8 100%)', boxShadow: '0 0 8px var(--mint-glow)' }} />
              </div>
              <span className="label-micro tabular shrink-0" style={{ color: 'var(--text-faint)' }}>{goals}/{total}</span>
            </div>
            {/* Shots */}
            <div className="flex items-baseline gap-1">
              <span className="font-display text-2xl tabular" style={{ color: 'var(--text-muted)' }}>
                {String(shots).padStart(2, '0')}
              </span>
              <span className="text-base leading-none">🎯</span>
            </div>
            <div className="w-px h-4 opacity-20 shrink-0" style={{ background: 'var(--text)' }} />
            {/* Timer */}
            <div className="flex items-center gap-1 shrink-0">
              {totalRounds > 1 && (
                <span className="label-micro px-1.5 py-0.5 rounded mr-1"
                  style={{ background: 'rgba(0,255,135,0.12)', color: 'var(--mint)' }}>
                  R{currentRound}/{totalRounds}
                </span>
              )}
              <div className="live-dot shrink-0" />
              <span className="font-display text-2xl tabular"
                style={{ color: timerColor, textShadow: `0 0 10px ${timerColor}` }}>{mins}:{secs}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── BETWEEN ROUNDS ────────────────────────────────────────────────────────
  if (phase === 'between_rounds') {
    const completedRound = game?.current_round || 1
    const totalRounds = game?.total_rounds || 1
    const roundAnswers = allGameAnswers.filter(a => a.round_number === completedRound)
    const roundShots = allGameShots.filter(a => a.round_number === completedRound)
    // My answers for the completed round (for answer reveal)
    const myCompletedAnswers = myAnswers.length > 0
      ? myAnswers
      : allGameAnswers.filter(a => a.player_id === player?.id && a.round_number === completedRound)
    const myCompletedFoundIndices = new Set(myCompletedAnswers.map(a => a.matched_index))

    const goalSets: Record<string, Set<number>> = {}
    const shotCounts: Record<string, number> = {}
    const lastGoalMs: Record<string, number> = {}
    for (const p of allPlayers) { goalSets[p.id] = new Set(); shotCounts[p.id] = 0; lastGoalMs[p.id] = Infinity }
    for (const a of roundAnswers) {
      if (a.matched_index !== null && goalSets[a.player_id]) {
        goalSets[a.player_id].add(a.matched_index)
        const t = new Date(a.created_at).getTime()
        if (!isFinite(lastGoalMs[a.player_id]) || t > lastGoalMs[a.player_id]) lastGoalMs[a.player_id] = t
      }
    }
    for (const s of roundShots) { if (shotCounts[s.player_id] !== undefined) shotCounts[s.player_id]++ }

    const roundLeaderboard = [...allPlayers].sort((a, b) => {
      const ga = goalSets[a.id]?.size || 0, gb = goalSets[b.id]?.size || 0
      if (gb !== ga) return gb - ga
      const ta = lastGoalMs[a.id] ?? Infinity, tb = lastGoalMs[b.id] ?? Infinity
      if (ta !== tb) return ta - tb
      return (shotCounts[a.id] || 0) - (shotCounts[b.id] || 0)
    })

    const myGoals = goalSets[player?.id ?? '']?.size || 0
    const myRank = roundLeaderboard.findIndex(p => p.id === player?.id) + 1
    const medals = ['🥇', '🥈', '🥉']

    return (
      <div className="min-h-screen flex flex-col stadium-bg noise">
        <div className="relative z-10 flex-1 flex flex-col">
          <Header status={`ROUND ${completedRound}/${totalRounds}`} />
          <div className="flex-1 p-4 pb-8 space-y-4 max-w-lg mx-auto w-full">
            <div className="text-center py-4">
              <div className="text-4xl mb-2">🏁</div>
              <h2 className="font-display text-4xl tracking-tight" style={{ color: 'var(--text)' }}>ROUND {completedRound} DONE</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                You scored {myGoals} — {myRank === 1 ? 'you\'re leading!' : `${myRank}${['st','nd','rd'][myRank-1]||'th'} place`}
              </p>
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
                <span className="label-micro">Round {completedRound} Table</span>
              </div>
              <div className="space-y-2">
                {roundLeaderboard.map((p, i) => {
                  const isMe = p.id === player?.id
                  const g = goalSets[p.id]?.size || 0
                  const s = shotCounts[p.id] || 0
                  const tMs = lastGoalMs[p.id]
                  const started = game?.started_at ? new Date(game.started_at).getTime() : 0
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-3 rounded-xl"
                      style={{
                        background: i === 0 && g > 0 ? 'rgba(255,214,10,0.1)' : 'var(--surface-2)',
                        border: `1px solid ${isMe ? 'rgba(0,255,135,0.3)' : i === 0 && g > 0 ? 'rgba(255,214,10,0.3)' : 'var(--border)'}`,
                      }}>
                      <span className="text-xl w-7">{medals[i] || ''}</span>
                      {!medals[i] && <span className="font-display text-lg w-7 tabular text-center" style={{ color: 'var(--text-faint)' }}>{i+1}</span>}
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate">
                          {p.name}{isMe && <span className="ml-1.5 label-micro" style={{ color: 'var(--mint)' }}>YOU</span>}
                        </div>
                        <div className="text-[10px] tabular mt-0.5" style={{ color: 'var(--text-faint)' }}>
                          {fmtTime(isFinite(tMs) ? tMs - started : Infinity)} · {s}🎯
                        </div>
                      </div>
                      <span className="font-display text-2xl tabular" style={{ color: i === 0 && g > 0 ? 'var(--gold)' : 'var(--mint)' }}>{g}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="card px-5 py-4 text-center">
              <div className="flex gap-2 justify-center mb-3">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full animate-breathe" style={{ background: 'var(--mint)', animationDelay: `${i*0.25}s` }} />
                ))}
              </div>
              <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Round {completedRound + 1} coming up…</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Waiting for the host to kick off</p>
            </div>

            {/* Answer reveal for completed round */}
            {question && (
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
                  <span className="label-micro">Round {completedRound} Answers</span>
                </div>
                <div className="space-y-1.5">
                  {(() => {
                    const isOpenList = question.answer_display.length > 10
                    const scorerMap: Record<number, string[]> = {}
                    for (const a of allGameAnswers.filter(x => x.round_number === completedRound && x.matched_index !== null)) {
                      const idx = a.matched_index!
                      if (!scorerMap[idx]) scorerMap[idx] = []
                      if (!scorerMap[idx].includes(a.player_id)) scorerMap[idx].push(a.player_id)
                    }
                    return question.answer_display.map((display, i) => {
                      const iScored = myCompletedFoundIndices.has(i)
                      const scorerIds = scorerMap[i] || []
                      const anyScored = scorerIds.length > 0
                      return (
                        <div key={i} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm"
                          style={{
                            background: iScored ? 'rgba(0,255,135,0.08)' : anyScored ? 'rgba(255,255,255,0.03)' : isOpenList ? 'rgba(255,255,255,0.02)' : 'var(--surface-2)',
                            border: `1px solid ${iScored ? 'rgba(0,255,135,0.25)' : anyScored ? 'rgba(255,255,255,0.08)' : isOpenList ? 'rgba(255,255,255,0.06)' : 'var(--border)'}`,
                          }}>
                          <span className="font-display text-base w-6 text-center tabular shrink-0" style={{ color: iScored ? 'var(--mint)' : 'var(--text-faint)' }}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span className="flex-1 font-semibold min-w-0 truncate" style={{ color: iScored ? 'var(--text)' : 'var(--text-muted)' }}>{display}</span>
                          <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                            {anyScored ? (
                              scorerIds.map(pid => {
                                const isMe = pid === player?.id
                                const pName = allPlayers.find(p => p.id === pid)?.name || '?'
                                return (
                                  <span key={pid} className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                                    style={{
                                      background: isMe ? 'rgba(0,255,135,0.15)' : 'rgba(255,255,255,0.07)',
                                      color: isMe ? 'var(--mint)' : 'var(--text-muted)',
                                      border: `1px solid ${isMe ? 'rgba(0,255,135,0.3)' : 'rgba(255,255,255,0.1)'}`,
                                    }}>
                                    {isMe ? `⚽ ${pName}` : pName}
                                  </span>
                                )
                              })
                            ) : isOpenList ? (
                              <span className="label-micro" style={{ color: 'var(--text-faint)' }}>also valid</span>
                            ) : (
                              <span className="label-micro" style={{ color: 'var(--red)' }}>MISSED</span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── FINISHED ──────────────────────────────────────────────────────────────
  if (phase === 'finished' && question) {
    const totalRounds = game?.total_rounds || 1
    const currentRound = game?.current_round || 1

    // My answers for the current/last round (for answer reveal)
    const myRoundAnswers = myAnswers.length > 0 ? myAnswers : allGameAnswers.filter(a => a.player_id === player?.id && a.round_number === currentRound)
    const myFoundIndices = new Set(myRoundAnswers.map(a => a.matched_index))

    // Overall stats
    const overallGoalSets: Record<string, Set<number>[]> = {}
    const overallShotCounts: Record<string, number> = {}
    const overallLastGoalMs: Record<string, number> = {}
    for (const p of allPlayers) {
      overallGoalSets[p.id] = Array.from({ length: totalRounds }, () => new Set())
      overallShotCounts[p.id] = 0
      overallLastGoalMs[p.id] = Infinity
    }
    for (const a of allGameAnswers) {
      if (a.matched_index !== null && overallGoalSets[a.player_id]) {
        overallGoalSets[a.player_id][a.round_number - 1]?.add(a.matched_index)
        const t = new Date(a.created_at).getTime()
        if (!isFinite(overallLastGoalMs[a.player_id]) || t > overallLastGoalMs[a.player_id]) {
          overallLastGoalMs[a.player_id] = t
        }
      }
    }
    for (const s of allGameShots) { if (overallShotCounts[s.player_id] !== undefined) overallShotCounts[s.player_id]++ }

    const totalGoals = (pid: string) => overallGoalSets[pid]?.reduce((sum, s) => sum + s.size, 0) || 0

    const leaderboard = [...allPlayers].sort((a, b) => {
      const ga = totalGoals(a.id), gb = totalGoals(b.id)
      if (gb !== ga) return gb - ga
      const ta = overallLastGoalMs[a.id] ?? Infinity, tb = overallLastGoalMs[b.id] ?? Infinity
      if (ta !== tb) return ta - tb
      return (overallShotCounts[a.id] || 0) - (overallShotCounts[b.id] || 0)
    })

    const myTotalGoals = totalGoals(player?.id ?? '')
    const myRank = leaderboard.findIndex(p => p.id === player?.id) + 1
    const medals = ['🥇', '🥈', '🥉']
    const suffixes = ['st', 'nd', 'rd']
    const iWon = myRank === 1
    // Use actual answer count per round (fetched async), fall back to question.answers.length for single round
    const maxGoals = maxGoalsTotal ?? (totalRounds === 1 ? Math.min(question.answers.length, 10) : totalRounds * 10)
    const myTotalShots = overallShotCounts[player?.id ?? ''] || 0

    function shareChallenge() {
      const text = `⚽ Footy Trivia Shots — I scored ${myTotalGoals}/${maxGoals} in ${myTotalShots} shots!\nThink you can beat me?\n${window.location.origin}`
      if (navigator.share) {
        navigator.share({ title: 'Footy Trivia Shots', text, url: window.location.origin }).catch(() => {})
      } else {
        navigator.clipboard.writeText(text)
      }
    }

    return (
      <div className="min-h-screen flex flex-col stadium-bg noise">
        <div className="relative z-10 flex-1 flex flex-col">
          <Header status="FULL TIME" />
          <div className="flex-1 p-4 pb-8 space-y-4 max-w-lg mx-auto w-full">
            {/* My result */}
            <div className="card p-6 text-center animate-fade-in relative overflow-hidden">
              {iWon && <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at top, rgba(255,214,10,0.18) 0%, transparent 60%)' }} />}
              <div className="relative">
                <div className="text-6xl mb-3 animate-pop-in">{medals[myRank - 1] || '⚽'}</div>
                <p className="label-micro mb-1" style={{ color: iWon ? 'var(--gold)' : 'var(--mint)' }}>
                  {iWon ? 'MATCH WINNER' : `${myRank}${suffixes[myRank - 1] || 'th'} place`}
                </p>
                <h2 className="font-display text-4xl tracking-tight mb-3" style={{ color: 'var(--text)' }}>{name.toUpperCase()}</h2>
                <div className="flex items-end justify-center gap-2">
                  <span className="font-display score-big text-7xl tabular"
                    style={{ color: iWon ? 'var(--gold)' : 'var(--mint)', textShadow: iWon ? '0 0 30px rgba(255,214,10,0.5)' : '0 0 30px var(--mint-glow)' }}>
                    {myTotalGoals}
                  </span>
                  <span className="font-display text-3xl tabular pb-2" style={{ color: 'var(--text-faint)' }}>/{maxGoals}</span>
                </div>
                {totalRounds > 1 && (
                  <div className="flex justify-center gap-2 mt-2 flex-wrap">
                    {overallGoalSets[player?.id ?? '']?.map((set, ri) => (
                      <span key={ri} className="text-[10px] px-2 py-0.5 rounded-full tabular"
                        style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.1)' }}>
                        R{ri + 1}: {set.size}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>{myTotalShots} shots taken</p>
              </div>
            </div>

            {/* Full leaderboard */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
                <span className="label-micro">{totalRounds > 1 ? 'Overall Table' : 'Full Table'}</span>
              </div>
              <div className="space-y-2">
                {(() => {
                  const gameStartMs = game?.started_at ? new Date(game.started_at).getTime() : 0
                  return leaderboard.map((p, i) => {
                    const isMe = p.id === player?.id
                    const g = totalGoals(p.id)
                    const s = overallShotCounts[p.id] || 0
                    const pct = (g / maxGoals) * 100
                    const isFirst = i === 0
                    const gotPerfect = g === maxGoals && g > 0
                    const prevG = i > 0 ? totalGoals(leaderboard[i - 1].id) : -1
                    const nextG = i < leaderboard.length - 1 ? totalGoals(leaderboard[i + 1].id) : -1
                    const isTied = g > 0 && (g === prevG || g === nextG)
                    const showTime = (gotPerfect || isTied) && overallLastGoalMs[p.id] !== Infinity
                    const timeStr = showTime ? fmtTime(overallLastGoalMs[p.id] - gameStartMs) : ''
                    return (
                      <div key={p.id} className="rounded-xl p-3 animate-slide-up"
                        style={{
                          background: isFirst ? 'linear-gradient(135deg, rgba(255,214,10,0.12) 0%, rgba(255,214,10,0.03) 100%)' : 'var(--surface-2)',
                          border: `1px solid ${isFirst ? 'rgba(255,214,10,0.35)' : isMe ? 'rgba(0,255,135,0.3)' : 'var(--border)'}`,
                          animationDelay: `${i * 80}ms`,
                        }}>
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xl w-7 shrink-0">{medals[i] || ''}</span>
                          {!medals[i] && <span className="font-display text-xl w-7 tabular text-center" style={{ color: 'var(--text-muted)' }}>{String(i+1).padStart(2,'0')}</span>}
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm truncate">
                              {p.name}{isMe && <span className="ml-1.5 label-micro" style={{ color: 'var(--mint)' }}>YOU</span>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className="text-[10px] px-1.5 py-0.5 rounded tabular"
                                style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                🎯 {s} shot{s===1?'':'s'}
                              </span>
                              {totalRounds > 1 && overallGoalSets[p.id]?.map((set, ri) => (
                                <span key={ri} className="text-[10px] px-1.5 py-0.5 rounded tabular"
                                  style={{ background: 'rgba(0,255,135,0.08)', color: 'var(--mint)', border: '1px solid rgba(0,255,135,0.15)' }}>
                                  R{ri + 1}: {set.size}
                                </span>
                              ))}
                              {showTime && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded tabular"
                                  style={{ background: 'rgba(0,255,135,0.1)', color: 'var(--mint)', border: '1px solid rgba(0,255,135,0.2)' }}>
                                  ⏱ {timeStr}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-display text-2xl tabular" style={{ color: isFirst ? 'var(--gold)' : 'var(--mint)' }}>{g}</span>
                            <span className="text-sm ml-0.5 tabular" style={{ color: 'var(--text-faint)' }}>/{maxGoals}</span>
                          </div>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: isFirst ? 'linear-gradient(90deg, var(--gold) 0%, #ffed4e 100%)' : 'linear-gradient(90deg, var(--mint) 0%, #7dffb8 100%)', transitionDelay: `${i*80+100}ms` }} />
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>

            {/* Answer reveal for last round */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
                <span className="label-micro">{totalRounds > 1 ? `Round ${currentRound} Answers` : 'The Answers'}</span>
              </div>
              <div className="space-y-1.5">
                {(() => {
                  const isOpenList = question.answer_display.length > 10
                  // Build who scored each answer this round
                  const scorerMap: Record<number, string[]> = {}
                  for (const a of allGameAnswers.filter(x => x.round_number === currentRound && x.matched_index !== null)) {
                    const idx = a.matched_index!
                    if (!scorerMap[idx]) scorerMap[idx] = []
                    if (!scorerMap[idx].includes(a.player_id)) scorerMap[idx].push(a.player_id)
                  }
                  return question.answer_display.map((display, i) => {
                    const iScored = myFoundIndices.has(i)
                    const scorerIds = scorerMap[i] || []
                    const anyScored = scorerIds.length > 0
                    return (
                      <div key={i} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm"
                        style={{
                          background: iScored ? 'rgba(0,255,135,0.08)' : anyScored ? 'rgba(255,255,255,0.03)' : isOpenList ? 'rgba(255,255,255,0.02)' : 'var(--surface-2)',
                          border: `1px solid ${iScored ? 'rgba(0,255,135,0.25)' : anyScored ? 'rgba(255,255,255,0.08)' : isOpenList ? 'rgba(255,255,255,0.06)' : 'var(--border)'}`,
                        }}>
                        <span className="font-display text-base w-6 text-center tabular shrink-0" style={{ color: iScored ? 'var(--mint)' : 'var(--text-faint)' }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="flex-1 font-semibold min-w-0 truncate" style={{ color: iScored ? 'var(--text)' : 'var(--text-muted)' }}>{display}</span>
                        <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                          {anyScored ? (
                            scorerIds.map(pid => {
                              const isMe = pid === player?.id
                              const pName = allPlayers.find(p => p.id === pid)?.name || '?'
                              return (
                                <span key={pid} className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                                  style={{
                                    background: isMe ? 'rgba(0,255,135,0.15)' : 'rgba(255,255,255,0.07)',
                                    color: isMe ? 'var(--mint)' : 'var(--text-muted)',
                                    border: `1px solid ${isMe ? 'rgba(0,255,135,0.3)' : 'rgba(255,255,255,0.1)'}`,
                                  }}>
                                  {isMe ? `⚽ ${pName}` : pName}
                                </span>
                              )
                            })
                          ) : isOpenList ? (
                            <span className="label-micro" style={{ color: 'var(--text-faint)' }}>also valid</span>
                          ) : (
                            <span className="label-micro" style={{ color: 'var(--red)' }}>MISSED</span>
                          )}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>

            {/* Challenge buttons */}
            <div className="flex gap-3">
              <button onClick={shareChallenge}
                className="flex-1 py-4 rounded-xl font-bold text-sm"
                style={{ background: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.4)', color: '#25D366' }}>
                📲 CHALLENGE
              </button>
              <button onClick={() => window.location.href = '/'}
                className="btn-primary flex-1 py-4 font-display text-lg tracking-wider">
                HOST MATCH ⚽
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen stadium-bg noise">
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="text-4xl animate-spin-slow">⚽</div>
        <div className="label-micro">Loading…</div>
      </div>
    </div>
  )
}

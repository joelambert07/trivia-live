'use client'

import { use, useEffect, useState, useRef, useCallback } from 'react'
import { supabase, type Game, type GamePlayer, type Question, type PlayerAnswer, checkAnswer, normalizeAnswer } from '@/lib/supabase'

type Phase = 'join' | 'waiting' | 'playing' | 'finished'

function Header({ status, name }: { status?: string; name?: string }) {
  return (
    <header className="px-5 py-3 flex items-center justify-between border-b relative z-10"
      style={{ borderColor: 'var(--border)', background: 'rgba(10,14,19,0.7)', backdropFilter: 'blur(12px)' }}>
      <div className="flex items-center gap-2.5">
        <span className="text-lg animate-spin-slow">⚽</span>
        <div className="leading-none">
          <div className="font-display text-lg tracking-tight" style={{ color: 'var(--text)' }}>FOOTY TRIVIA</div>
          <div className="label-micro" style={{ color: 'var(--mint)' }}>When you shoot, score</div>
        </div>
      </div>
      {status && (
        <div className="flex items-center gap-1.5">
          {status === 'LIVE' && <div className="live-dot" />}
          <span className="label-micro" style={{ color: status === 'LIVE' ? 'var(--red)' : 'var(--text-muted)' }}>{status}</span>
        </div>
      )}
      {!status && name && (
        <span className="label-micro">{name}</span>
      )}
    </header>
  )
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
  const [myAnswers, setMyAnswers] = useState<PlayerAnswer[]>([])
  const [allPlayers, setAllPlayers] = useState<GamePlayer[]>([])
  const [allAnswers, setAllAnswers] = useState<PlayerAnswer[]>([])
  const [inputValue, setInputValue] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [goalFlash, setGoalFlash] = useState(false)
  const [shakeInput, setShakeInput] = useState(false)
  const [shots, setShots] = useState(0)
  const [joining, setJoining] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)

  async function joinGame() {
    const trimmed = nameInput.trim()
    if (!trimmed) { setNameError('Enter your name'); return }
    setJoining(true); setNameError('')

    const { data: gameData } = await supabase
      .from('games').select('*').eq('code', code.toUpperCase()).single()

    if (!gameData) { setNameError('Game not found. Check the code.'); setJoining(false); return }
    if (gameData.status === 'finished') { setNameError('This game has already ended.'); setJoining(false); return }

    const { data: playerData } = await supabase
      .from('game_players').insert({ game_id: gameData.id, name: trimmed }).select().single()

    if (!playerData) { setNameError('Failed to join. Try again.'); setJoining(false); return }

    setGame(gameData as Game)
    setPlayer(playerData as GamePlayer)
    setName(trimmed)
    if (gameData.status === 'active') {
      setPhase('playing')
      setTimeout(() => inputRef.current?.focus(), 300)
    } else {
      setPhase('waiting')
    }
    setJoining(false)
  }

  const loadQuestion = useCallback(async (questionId: string) => {
    const { data } = await supabase.from('questions').select('*').eq('id', questionId).single()
    if (data) setQuestion(data as Question)
  }, [])

  const loadAllData = useCallback(async (gameId: string) => {
    const [{ data: answers }, { data: players }] = await Promise.all([
      supabase.from('player_answers').select('*').eq('game_id', gameId).eq('is_correct', true),
      supabase.from('game_players').select('*').eq('game_id', gameId),
    ])
    setAllAnswers((answers as PlayerAnswer[]) || [])
    setAllPlayers((players as GamePlayer[]) || [])
  }, [])

  useEffect(() => {
    if (!game) return
    if (game.question_id) loadQuestion(game.question_id)

    const ch = supabase
      .channel(`play-${game.id}-${player?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${game.id}` },
        async payload => {
          const updated = payload.new as Game
          setGame(updated)
          if (updated.question_id) loadQuestion(updated.question_id)
          if (updated.status === 'active') {
            setPhase('playing')
            setTimeout(() => inputRef.current?.focus(), 300)
          }
          if (updated.status === 'finished') {
            setPhase('finished')
            await loadAllData(updated.id)
          }
        })
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id])

  useEffect(() => {
    if (phase === 'finished' && game) loadAllData(game.id)
    if (phase === 'playing') setTimeout(() => inputRef.current?.focus(), 300)
  }, [phase, game, loadAllData])

  useEffect(() => {
    if (!game?.ends_at || game.status !== 'active') return
    const tick = () => setTimeLeft(Math.max(0, Math.ceil((new Date(game.ends_at!).getTime() - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [game?.ends_at, game?.status])

  async function submitAnswer() {
    if (submitting.current || !inputValue.trim() || !player || !game || !question) return
    submitting.current = true

    const raw = inputValue.trim()
    const normalized = normalizeAnswer(raw)
    setInputValue('')
    setShots(s => s + 1)

    if (myAnswers.some(a => a.answer_normalized === normalized)) {
      submitting.current = false
      return
    }

    const { correct, index } = checkAnswer(raw, question.answers)

    if (correct && myAnswers.some(a => a.matched_index === index)) {
      submitting.current = false
      return
    }

    if (correct) {
      const optimistic: PlayerAnswer = {
        id: crypto.randomUUID(),
        game_id: game.id,
        player_id: player.id,
        answer_raw: raw,
        answer_normalized: normalized,
        is_correct: true,
        matched_index: index,
        created_at: new Date().toISOString(),
      }
      setMyAnswers(prev => [...prev, optimistic])
      setGoalFlash(true)
      setTimeout(() => setGoalFlash(false), 900)
    } else {
      setShakeInput(true)
      setTimeout(() => setShakeInput(false), 400)
    }

    await supabase.from('player_answers').insert({
      game_id: game.id,
      player_id: player.id,
      answer_raw: raw,
      answer_normalized: normalized,
      is_correct: correct,
      matched_index: correct ? index : null,
    })

    submitting.current = false
  }

  // ── JOIN ────────────────────────────────────────────────────
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
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinGame()}
              placeholder="e.g. Mark"
              maxLength={20}
              className="w-full px-4 py-3.5 rounded-xl text-lg font-bold outline-none mb-3"
              style={{
                background: 'var(--surface-2)',
                border: '1.5px solid var(--border)',
                color: 'var(--text)',
              }}
            />
            {nameError && <p className="text-sm mb-3 font-medium" style={{ color: 'var(--red)' }}>{nameError}</p>}
            <button onClick={joinGame} disabled={joining}
              className="btn-primary w-full py-4 text-base">
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

  // ── WAITING ─────────────────────────────────────────────────
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
          <p className="text-sm mb-8 max-w-xs" style={{ color: 'var(--text-muted)' }}>
            Waiting for the manager to kick off. Stay sharp.
          </p>
          <div className="flex gap-2 justify-center mb-10">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full animate-breathe"
                style={{ background: 'var(--mint)', animationDelay: `${i*0.25}s` }} />
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

  // ── PLAYING ─────────────────────────────────────────────────
  if (phase === 'playing' && question) {
    const goals = myAnswers.length
    const total = question.answers.length
    const foundIndices = new Set(myAnswers.map(a => a.matched_index))
    const timerPct = game?.ends_at ? timeLeft / (game.round_duration || 180) : 1
    const timerColor = timerPct > 0.5 ? 'var(--mint)' : timerPct > 0.25 ? 'var(--gold)' : 'var(--red)'
    const mins = Math.floor(timeLeft / 60)
    const secs = String(timeLeft % 60).padStart(2, '0')

    return (
      <div className="min-h-screen flex flex-col stadium-bg noise">
        {/* Goal flash overlay */}
        {goalFlash && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, var(--mint-glow) 0%, transparent 60%)' }} />
            <div className="animate-goal flex flex-col items-center relative">
              <div className="text-8xl">⚽</div>
              <div className="font-display text-7xl tracking-tight mt-2"
                style={{ color: 'var(--mint)', textShadow: '0 0 40px rgba(0,255,135,0.8)' }}>
                GOAL!
              </div>
            </div>
          </div>
        )}

        <div className="relative z-10 flex-1 flex flex-col">
          {/* Scoreboard header */}
          <div className="border-b" style={{ borderColor: 'var(--border)', background: 'rgba(10,14,19,0.85)', backdropFilter: 'blur(12px)' }}>
            <div className="px-5 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="live-dot animate-pulse-glow" />
                <span className="label-micro" style={{ color: 'var(--red)' }}>LIVE</span>
                <span className="label-micro">·</span>
                <span className="label-micro">{name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="label-micro" style={{ color: timerColor }}>TIME</span>
                <span className="font-display text-2xl tabular tracking-tight"
                  style={{ color: timerColor, textShadow: `0 0 12px ${timerColor}` }}>
                  {mins}:{secs}
                </span>
              </div>
            </div>

            {/* Scoreboard row */}
            <div className="px-5 pb-3 flex items-end gap-5">
              <div>
                <div className="label-micro mb-0.5" style={{ color: 'var(--mint)' }}>Goals</div>
                <div className="font-display score-big text-5xl tabular" style={{ color: 'var(--mint)', textShadow: '0 0 20px var(--mint-glow)' }}>
                  {String(goals).padStart(2, '0')}
                </div>
              </div>
              <div className="w-px h-10" style={{ background: 'var(--border)' }} />
              <div>
                <div className="label-micro mb-0.5">Shots</div>
                <div className="font-display score-big text-5xl tabular" style={{ color: 'var(--text)' }}>
                  {String(shots).padStart(2, '0')}
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="label-micro mb-0.5">Target</div>
                <div className="font-display text-2xl tabular" style={{ color: 'var(--text-muted)' }}>
                  {goals}<span style={{ color: 'var(--text-faint)' }}>/{total}</span>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full transition-all duration-500"
                style={{
                  width: `${(goals / total) * 100}%`,
                  background: 'linear-gradient(90deg, var(--mint) 0%, #7dffb8 100%)',
                  boxShadow: '0 0 10px var(--mint-glow)',
                }} />
            </div>
          </div>

          {/* Question */}
          <div className="px-4 pt-4 pb-2">
            <div className="card px-4 py-3">
              <p className="label-micro mb-1" style={{ color: 'var(--mint)' }}>{question.category}</p>
              <p className="font-semibold text-sm leading-snug" style={{ color: 'var(--text)' }}>{question.question}</p>
            </div>
          </div>

          {/* Input */}
          <div className="px-4 pt-2 pb-3">
            <div className={`flex gap-2 ${shakeInput ? 'animate-shake' : ''}`}>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitAnswer()}
                placeholder="Type an answer..."
                autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
                className="flex-1 px-4 py-3.5 rounded-xl text-base font-semibold outline-none"
                style={{
                  background: 'var(--surface)',
                  border: '1.5px solid var(--border)',
                  color: 'var(--text)',
                }}
              />
              <button onClick={submitAnswer}
                className="btn-primary px-5 py-3.5 text-sm">
                SHOOT
              </button>
            </div>
          </div>

          {/* Answer grid */}
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <div className="grid grid-cols-2 gap-2">
              {question.answer_display.map((display, i) => {
                const found = foundIndices.has(i)
                return (
                  <div key={i}
                    className={`px-3 py-3 rounded-xl ${found ? 'animate-pop-in' : ''}`}
                    style={{
                      background: found ? 'linear-gradient(135deg, rgba(0,255,135,0.15) 0%, rgba(0,255,135,0.05) 100%)' : 'var(--surface)',
                      border: `1px solid ${found ? 'rgba(0,255,135,0.4)' : 'var(--border)'}`,
                      boxShadow: found ? '0 0 16px rgba(0,255,135,0.15)' : 'none',
                    }}>
                    <p className="label-micro mb-1"
                      style={{ color: found ? 'var(--mint)' : 'var(--text-faint)' }}>
                      #{String(i + 1).padStart(2, '0')}
                    </p>
                    <p className="font-bold leading-tight text-sm"
                      style={{ color: found ? 'var(--text)' : 'var(--text-faint)' }}>
                      {found ? display.split('(')[0].trim() : '———'}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── FINISHED ────────────────────────────────────────────────
  if (phase === 'finished' && question) {
    const myGoals = myAnswers.length
    const total = question.answers.length
    const foundIndices = new Set(myAnswers.map(a => a.matched_index))

    const playerGoals = allAnswers.reduce<Record<string, Set<number>>>((acc, a) => {
      if (a.matched_index !== null) {
        if (!acc[a.player_id]) acc[a.player_id] = new Set()
        acc[a.player_id].add(a.matched_index)
      }
      return acc
    }, {})

    const leaderboard = [...allPlayers]
      .map(p => ({ ...p, goals: playerGoals[p.id]?.size || 0 }))
      .sort((a, b) => b.goals - a.goals)

    const myRank = leaderboard.findIndex(p => p.id === player?.id) + 1
    const medals = ['🥇', '🥈', '🥉']
    const suffixes = ['st', 'nd', 'rd']
    const iWon = myRank === 1

    return (
      <div className="min-h-screen flex flex-col stadium-bg noise">
        <div className="relative z-10 flex-1 flex flex-col">
          <Header status="FULL TIME" />

          <div className="flex-1 p-4 pb-8 space-y-4 max-w-lg mx-auto w-full">
            {/* My result */}
            <div className="card p-6 text-center animate-fade-in relative overflow-hidden">
              {iWon && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: 'radial-gradient(ellipse at top, rgba(255,214,10,0.18) 0%, transparent 60%)',
                }} />
              )}
              <div className="relative">
                <div className="text-6xl mb-3 animate-pop-in">{medals[myRank - 1] || '⚽'}</div>
                <p className="label-micro mb-1" style={{ color: iWon ? 'var(--gold)' : 'var(--mint)' }}>
                  {iWon ? 'MATCH WINNER' : `${myRank}${suffixes[myRank - 1] || 'th'} place`}
                </p>
                <h2 className="font-display text-4xl tracking-tight mb-3" style={{ color: 'var(--text)' }}>
                  {name.toUpperCase()}
                </h2>
                <div className="flex items-end justify-center gap-2">
                  <span className="font-display score-big text-7xl tabular"
                    style={{
                      color: iWon ? 'var(--gold)' : 'var(--mint)',
                      textShadow: iWon ? '0 0 30px rgba(255,214,10,0.5)' : '0 0 30px var(--mint-glow)',
                    }}>
                    {myGoals}
                  </span>
                  <span className="font-display text-3xl tabular pb-2" style={{ color: 'var(--text-faint)' }}>/{total}</span>
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                  {shots} shots taken
                </p>
              </div>
            </div>

            {/* Leaderboard */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
                <span className="label-micro">Full Table</span>
              </div>
              <div className="space-y-2">
                {leaderboard.map((p, i) => {
                  const isMe = p.id === player?.id
                  const pct = (p.goals / total) * 100
                  const isFirst = i === 0
                  return (
                    <div key={p.id} className="rounded-xl p-3 animate-slide-up"
                      style={{
                        background: isFirst ? 'linear-gradient(135deg, rgba(255,214,10,0.12) 0%, rgba(255,214,10,0.03) 100%)' : 'var(--surface-2)',
                        border: `1px solid ${isFirst ? 'rgba(255,214,10,0.35)' : isMe ? 'rgba(0,255,135,0.3)' : 'var(--border)'}`,
                        animationDelay: `${i * 80}ms`,
                        boxShadow: isFirst ? '0 0 20px rgba(255,214,10,0.1)' : 'none',
                      }}>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-display text-xl w-7 tabular text-center" style={{ color: isFirst ? 'var(--gold)' : 'var(--text-muted)' }}>
                          {medals[i] || String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="flex-1 font-bold text-sm" style={{ color: 'var(--text)' }}>
                          {p.name}
                          {isMe && <span className="ml-1.5 label-micro" style={{ color: 'var(--mint)' }}>YOU</span>}
                        </span>
                        <span className="font-display text-2xl tabular" style={{ color: isFirst ? 'var(--gold)' : 'var(--mint)' }}>
                          {p.goals}
                          <span className="text-sm ml-0.5" style={{ color: 'var(--text-faint)' }}>/{total}</span>
                        </span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            background: isFirst ? 'linear-gradient(90deg, var(--gold) 0%, #ffed4e 100%)' : 'linear-gradient(90deg, var(--mint) 0%, #7dffb8 100%)',
                            transitionDelay: `${i * 80 + 100}ms`,
                          }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Answer reveal */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="w-1 h-5 rounded-full" style={{ background: 'var(--mint)' }} />
                <span className="label-micro">The Answers</span>
              </div>
              <div className="space-y-1.5">
                {question.answer_display.map((display, i) => {
                  const found = foundIndices.has(i)
                  return (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm"
                      style={{
                        background: found ? 'rgba(0,255,135,0.08)' : 'var(--surface-2)',
                        border: `1px solid ${found ? 'rgba(0,255,135,0.25)' : 'var(--border)'}`,
                      }}>
                      <span className="font-display text-base w-6 text-center tabular"
                        style={{ color: found ? 'var(--mint)' : 'var(--text-faint)' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="flex-1 font-semibold" style={{ color: found ? 'var(--text)' : 'var(--text-muted)' }}>
                        {display}
                      </span>
                      {found
                        ? <span className="label-micro" style={{ color: 'var(--mint)' }}>⚽ GOAL</span>
                        : <span className="label-micro" style={{ color: 'var(--red)' }}>MISSED</span>}
                    </div>
                  )
                })}
              </div>
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
        <div className="label-micro">Loading...</div>
      </div>
    </div>
  )
}

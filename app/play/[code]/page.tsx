'use client'

import { use, useEffect, useState, useRef, useCallback } from 'react'
import { supabase, type Game, type GamePlayer, type Question, type PlayerAnswer, checkAnswer, normalizeAnswer } from '@/lib/supabase'

type Phase = 'join' | 'waiting' | 'playing' | 'finished'

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
  const [shots, setShots] = useState(0) // total guesses
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

  // Subscribe to game state changes after joining
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

  // Load all data when finished
  useEffect(() => {
    if (phase === 'finished' && game) loadAllData(game.id)
    if (phase === 'playing') setTimeout(() => inputRef.current?.focus(), 300)
  }, [phase, game, loadAllData])

  // Countdown timer
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

    // Check if already correctly found this normalised form
    if (myAnswers.some(a => a.answer_normalized === normalized)) {
      submitting.current = false
      return
    }

    const { correct, index } = checkAnswer(raw, question.answers)

    // Check if already found this position
    if (correct && myAnswers.some(a => a.matched_index === index)) {
      submitting.current = false
      return
    }

    // Optimistically update local state immediately — don't wait for real-time
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

    // Persist to DB in background
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
    <div className="min-h-screen flex flex-col">
      <header className="px-5 py-4" style={{ background: 'var(--navy)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚽</span>
          <h1 className="text-white font-black tracking-tight">FOOTY TRIVIA SHOTS</h1>
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Room: <span className="font-bold text-white">{code.toUpperCase()}</span>
        </p>
      </header>

      <div className="flex-1 flex flex-col justify-center px-5 py-8 max-w-sm mx-auto w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">⚽</div>
          <h2 className="text-2xl font-black" style={{ color: 'var(--navy)' }}>What&apos;s your name?</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>This is how you&apos;ll appear on the leaderboard</p>
        </div>

        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-lg)' }}>
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
            className="w-full py-4 rounded-xl font-black text-lg transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'var(--navy)', color: '#fff' }}>
            {joining ? 'Joining...' : 'Join Game'}
          </button>
        </div>
      </div>
    </div>
  )

  // ── WAITING ─────────────────────────────────────────────────
  if (phase === 'waiting') return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 py-4" style={{ background: 'var(--navy)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚽</span>
          <h1 className="text-white font-black tracking-tight">FOOTY TRIVIA SHOTS</h1>
        </div>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
        <div className="text-6xl mb-6" style={{ animation: 'bounce 1.5s infinite' }}>⚽</div>
        <h2 className="text-2xl font-black mb-2" style={{ color: 'var(--navy)' }}>You&apos;re in the squad, {name}!</h2>
        <p className="mb-8" style={{ color: 'var(--text-muted)' }}>Waiting for the manager to kick off...</p>
        <div className="flex gap-1.5 justify-center">
          {[0,1,2].map(i => (
            <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce"
              style={{ background: 'var(--green)', animationDelay: `${i*0.2}s` }} />
          ))}
        </div>
        <div className="mt-10 px-5 py-2.5 rounded-full text-sm font-bold"
          style={{ background: 'var(--green-light)', color: 'var(--green)' }}>
          Room {code.toUpperCase()}
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
    const timerColor = timerPct > 0.5 ? 'var(--green)' : timerPct > 0.25 ? 'var(--gold)' : 'var(--red)'
    const r = 28; const circ = 2 * Math.PI * r

    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
        {/* Goal flash overlay */}
        {goalFlash && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="animate-goal flex flex-col items-center">
              <div className="text-7xl">⚽</div>
              <div className="text-5xl font-black mt-2" style={{ color: 'var(--green)', textShadow: '0 2px 20px rgba(22,163,74,0.5)' }}>
                GOAL!
              </div>
            </div>
          </div>
        )}

        {/* Header: score strip */}
        <header style={{ background: 'var(--navy)' }}>
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚽</span>
              <span className="text-white font-black text-sm tracking-tight">{name}</span>
            </div>
            {/* Timer circle */}
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 70 70">
                <circle cx="35" cy="35" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
                <circle cx="35" cy="35" r={r} fill="none"
                  stroke={timerColor} strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={circ} strokeDashoffset={circ * (1 - timerPct)}
                  style={{ transition: 'stroke-dashoffset 0.5s linear, stroke 0.5s' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-black tabular-nums text-white">
                  {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                </span>
              </div>
            </div>
          </div>

          {/* Goals / Shots bar */}
          <div className="px-5 pb-3 flex gap-4">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black tabular-nums" style={{ color: 'var(--green-bright)' }}>{goals}</span>
              <span className="text-xs font-bold uppercase tracking-wide text-white opacity-60">Goals</span>
            </div>
            <div className="w-px" style={{ background: 'rgba(255,255,255,0.15)' }} />
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black tabular-nums text-white">{shots}</span>
              <span className="text-xs font-bold uppercase tracking-wide text-white opacity-60">Shots</span>
            </div>
            <div className="ml-auto flex items-center">
              <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.5)' }}>{goals}/{total} answers</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div className="h-full transition-all duration-300"
              style={{ width: `${(goals / total) * 100}%`, background: 'var(--green-bright)' }} />
          </div>
        </header>

        {/* Question */}
        <div className="px-4 pt-4 pb-2">
          <div className="rounded-xl px-4 py-3" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-faint)' }}>{question.category}</p>
            <p className="font-semibold text-sm leading-snug">{question.question}</p>
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
                boxShadow: 'var(--shadow)',
              }}
            />
            <button onClick={submitAnswer}
              className="px-5 py-3.5 rounded-xl font-black text-sm transition-all active:scale-[0.95]"
              style={{ background: 'var(--green)', color: '#fff', boxShadow: '0 2px 8px rgba(22,163,74,0.3)' }}>
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
                  className={`px-3 py-3 rounded-xl text-sm ${found ? 'animate-pop-in' : ''}`}
                  style={{
                    background: found ? 'var(--green-light)' : 'var(--surface)',
                    border: `1.5px solid ${found ? '#86efac' : 'var(--border)'}`,
                    boxShadow: found ? '0 1px 8px rgba(22,163,74,0.15)' : 'var(--shadow)',
                  }}>
                  <p className="text-xs font-bold mb-0.5"
                    style={{ color: found ? '#15803d' : 'var(--text-faint)' }}>
                    #{i + 1}
                  </p>
                  <p className="font-bold leading-tight"
                    style={{ color: found ? 'var(--green)' : 'var(--text-faint)' }}>
                    {found ? display.split('(')[0].trim() : '???'}
                  </p>
                </div>
              )
            })}
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

    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
        <header className="px-5 py-4" style={{ background: 'var(--navy)' }}>
          <div className="flex items-center gap-3">
            <span className="text-xl">⚽</span>
            <h1 className="text-white font-black tracking-tight">FOOTY TRIVIA SHOTS</h1>
          </div>
        </header>

        <div className="flex-1 p-5 pb-8 space-y-4 max-w-lg mx-auto w-full">
          {/* My result */}
          <div className="rounded-2xl p-6 text-center animate-fade-in"
            style={{
              background: myRank === 1 ? '#fefce8' : 'var(--surface)',
              border: `1.5px solid ${myRank === 1 ? '#fde68a' : 'var(--border)'}`,
              boxShadow: 'var(--shadow-lg)',
            }}>
            <div className="text-5xl mb-2">{medals[myRank - 1] || '⚽'}</div>
            <h2 className="text-xl font-black mb-1" style={{ color: 'var(--navy)' }}>{name}</h2>
            <div className="text-5xl font-black tabular-nums my-2" style={{ color: myRank === 1 ? 'var(--gold)' : 'var(--green)' }}>
              {myGoals}
              <span className="text-lg font-medium ml-1" style={{ color: 'var(--text-faint)' }}>/{total}</span>
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
              {myRank === 1 ? 'Winner! 🏆' : `${myRank}${suffixes[myRank - 1] || 'th'} place`}
              {' · '}{shots} shots taken
            </p>
          </div>

          {/* Leaderboard */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-faint)' }}>Full Table</p>
            <div className="space-y-2">
              {leaderboard.map((p, i) => {
                const isMe = p.id === player?.id
                const pct = (p.goals / total) * 100
                return (
                  <div key={p.id} className="rounded-xl p-3 animate-slide-up"
                    style={{
                      background: isMe ? (i === 0 ? '#fefce8' : 'var(--green-light)') : 'var(--surface-2)',
                      border: `1.5px solid ${isMe ? (i === 0 ? '#fde68a' : '#86efac') : 'var(--border)'}`,
                      animationDelay: `${i * 80}ms`,
                    }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base w-7">{medals[i] || `${i + 1}`}</span>
                      <span className="flex-1 font-bold text-sm" style={{ color: isMe ? 'var(--navy)' : 'var(--text)' }}>
                        {p.name} {isMe && <span className="text-xs font-medium opacity-60">(you)</span>}
                      </span>
                      <span className="font-black tabular-nums" style={{ color: i === 0 ? 'var(--gold)' : 'var(--green)' }}>
                        {p.goals}/{total}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: i === 0 ? 'var(--gold)' : 'var(--green)', transitionDelay: `${i * 80}ms` }} />
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
              {question.answer_display.map((display, i) => {
                const found = foundIndices.has(i)
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
                    style={{
                      background: found ? 'var(--green-light)' : '#fff5f5',
                      border: `1px solid ${found ? '#86efac' : '#fecaca'}`,
                      color: found ? 'var(--green)' : 'var(--red)',
                    }}>
                    <span className="font-bold text-xs w-4 text-center opacity-60">{i + 1}</span>
                    <span className="flex-1 font-medium">{display}</span>
                    {found
                      ? <span className="text-xs font-black" style={{ color: 'var(--green)' }}>GOAL ⚽</span>
                      : <span className="text-xs font-bold opacity-50">MISSED</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-base font-semibold" style={{ color: 'var(--text-muted)' }}>Loading...</div>
    </div>
  )
}

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
  const [lastResult, setLastResult] = useState<'correct' | 'wrong' | null>(null)
  const [joining, setJoining] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Join game
  async function joinGame() {
    const trimmed = nameInput.trim()
    if (!trimmed) { setNameError('Enter your name'); return }
    setJoining(true)
    setNameError('')

    // Find game by code
    const { data: gameData } = await supabase
      .from('games')
      .select('*')
      .eq('code', code.toUpperCase())
      .single()

    if (!gameData) {
      setNameError('Game not found. Check the code.')
      setJoining(false)
      return
    }

    if (gameData.status === 'finished') {
      setNameError('This game has already ended.')
      setJoining(false)
      return
    }

    // Add player
    const { data: playerData } = await supabase
      .from('game_players')
      .insert({ game_id: gameData.id, name: trimmed })
      .select()
      .single()

    if (!playerData) {
      setNameError('Failed to join. Try again.')
      setJoining(false)
      return
    }

    setGame(gameData as Game)
    setPlayer(playerData as GamePlayer)
    setName(trimmed)
    setPhase(gameData.status === 'active' ? 'playing' : 'waiting')
    setJoining(false)
  }

  // Load question
  const loadQuestion = useCallback(async (questionId: string) => {
    const { data } = await supabase.from('questions').select('*').eq('id', questionId).single()
    if (data) setQuestion(data as Question)
  }, [])

  // Load my answers
  const loadMyAnswers = useCallback(async (playerId: string, gameId: string) => {
    const { data } = await supabase
      .from('player_answers')
      .select('*')
      .eq('player_id', playerId)
      .eq('game_id', gameId)
      .eq('is_correct', true)
      .order('created_at')
    setMyAnswers((data as PlayerAnswer[]) || [])
  }, [])

  // Load all answers (for finished screen)
  const loadAllAnswers = useCallback(async (gameId: string) => {
    const { data } = await supabase
      .from('player_answers')
      .select('*')
      .eq('game_id', gameId)
      .eq('is_correct', true)
    setAllAnswers((data as PlayerAnswer[]) || [])
  }, [])

  // Load all players (for leaderboard)
  const loadAllPlayers = useCallback(async (gameId: string) => {
    const { data } = await supabase
      .from('game_players')
      .select('*')
      .eq('game_id', gameId)
    setAllPlayers((data as GamePlayer[]) || [])
  }, [])

  // Real-time: subscribe to game changes after joining
  useEffect(() => {
    if (!game) return

    if (game.question_id) loadQuestion(game.question_id)

    const ch = supabase
      .channel(`player-game-${game.id}`)
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
            await loadAllAnswers(updated.id)
            await loadAllPlayers(updated.id)
          }
        })
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [game, loadQuestion, loadAllAnswers, loadAllPlayers])

  // Load my answers when playing starts
  useEffect(() => {
    if (phase === 'playing' && player && game) {
      loadMyAnswers(player.id, game.id)
      inputRef.current?.focus()
    }
    if (phase === 'finished' && game) {
      loadAllAnswers(game.id)
      loadAllPlayers(game.id)
    }
  }, [phase, player, game, loadMyAnswers, loadAllAnswers, loadAllPlayers])

  // Real-time: my answers while playing
  useEffect(() => {
    if (!player || !game || phase !== 'playing') return
    const ch = supabase
      .channel(`player-answers-${player.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'player_answers', filter: `player_id=eq.${player.id}` },
        () => loadMyAnswers(player.id, game.id))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [player, game, phase, loadMyAnswers])

  // Countdown timer
  useEffect(() => {
    if (!game?.ends_at || game.status !== 'active') return
    const tick = () => {
      const left = Math.max(0, Math.ceil((new Date(game.ends_at!).getTime() - Date.now()) / 1000))
      setTimeLeft(left)
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [game?.ends_at, game?.status])

  // Submit an answer
  async function submitAnswer() {
    if (!inputValue.trim() || !player || !game || !question) return
    const raw = inputValue.trim()
    const normalized = normalizeAnswer(raw)

    // Already answered this?
    if (myAnswers.some(a => a.answer_normalized === normalized)) {
      setInputValue('')
      return
    }

    const { correct, index } = checkAnswer(raw, question.answers)

    // Already found this answer?
    if (correct && myAnswers.some(a => a.matched_index === index)) {
      setInputValue('')
      return
    }

    await supabase.from('player_answers').insert({
      game_id: game.id,
      player_id: player.id,
      answer_raw: raw,
      answer_normalized: normalized,
      is_correct: correct,
      matched_index: correct ? index : null,
    })

    setInputValue('')

    if (lastResultTimer.current) clearTimeout(lastResultTimer.current)
    setLastResult(correct ? 'correct' : 'wrong')
    lastResultTimer.current = setTimeout(() => setLastResult(null), 1200)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') submitAnswer()
  }

  // ── JOIN ─────────────────────────────────────────────────────────────────
  if (phase === 'join') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">⚽</div>
            <h1 className="text-3xl font-black" style={{ color: 'var(--accent)' }}>TRIVIA LIVE</h1>
            <p className="text-sm mt-1" style={{ color: 'rgba(240,240,255,0.4)' }}>Room: <span className="font-bold text-white tracking-widest">{code.toUpperCase()}</span></p>
          </div>

          <div className="rounded-2xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <h2 className="text-xl font-bold mb-1">What&apos;s your name?</h2>
            <p className="text-sm mb-5" style={{ color: 'rgba(240,240,255,0.4)' }}>This is how you&apos;ll appear on the leaderboard</p>
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinGame()}
              placeholder="e.g. Mark"
              maxLength={20}
              className="w-full px-4 py-3 rounded-xl text-lg font-bold mb-3 outline-none"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            />
            {nameError && <p className="text-red-400 text-sm mb-3">{nameError}</p>}
            <button
              onClick={joinGame}
              disabled={joining}
              className="w-full py-4 rounded-xl font-black text-lg transition-all active:scale-95 disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#0d0d1a' }}
            >
              {joining ? 'Joining...' : 'Join Game'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── WAITING ──────────────────────────────────────────────────────────────
  if (phase === 'waiting') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <div className="text-5xl mb-4">⚽</div>
        <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--accent)' }}>TRIVIA LIVE</h1>
        <p className="text-xl font-bold mb-2">You&apos;re in, {name}!</p>
        <p className="mb-8" style={{ color: 'rgba(240,240,255,0.5)' }}>Waiting for the host to start...</p>

        <div className="flex gap-1 justify-center">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-2 h-2 rounded-full animate-bounce"
              style={{ background: 'var(--accent)', animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>

        <div className="mt-12 px-6 py-3 rounded-full text-sm font-medium"
          style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--accent)' }}>
          Room {code.toUpperCase()}
        </div>
      </div>
    )
  }

  // ── PLAYING ──────────────────────────────────────────────────────────────
  if (phase === 'playing' && question) {
    const totalAnswers = question.answers.length
    const found = myAnswers.length
    const timerPct = game?.ends_at ? timeLeft / (game.round_duration || 180) : 1
    const timerColor = timerPct > 0.5 ? 'var(--accent)' : timerPct > 0.25 ? '#ffd700' : '#ff4444'
    const foundIndices = new Set(myAnswers.map(a => a.matched_index))

    return (
      <div className="min-h-screen flex flex-col p-4 pb-6">
        {/* Header with timer */}
        <div className="flex items-center justify-between mb-4 pt-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(240,240,255,0.4)' }}>{name}</p>
            <p className="text-2xl font-black" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
              {found}<span className="text-sm font-medium ml-1" style={{ color: 'rgba(240,240,255,0.4)' }}>/ {totalAnswers}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'rgba(240,240,255,0.4)' }}>Time</p>
            <p className="text-2xl font-black" style={{ color: timerColor, fontVariantNumeric: 'tabular-nums' }}>
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full overflow-hidden mb-4" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${(found / totalAnswers) * 100}%`, background: 'var(--accent)' }} />
        </div>

        {/* Question */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(240,240,255,0.4)' }}>{question.category}</span>
          <p className="text-base font-bold mt-1 leading-snug">{question.question}</p>
        </div>

        {/* Input */}
        <div className="relative mb-4">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type an answer..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            className="w-full px-4 py-4 rounded-2xl text-lg font-bold outline-none pr-16 transition-all"
            style={{
              background: lastResult === 'correct'
                ? 'rgba(0,232,122,0.15)'
                : lastResult === 'wrong'
                  ? 'rgba(255,50,50,0.1)'
                  : 'var(--card)',
              border: `2px solid ${lastResult === 'correct'
                ? 'rgba(0,232,122,0.6)'
                : lastResult === 'wrong'
                  ? 'rgba(255,50,50,0.4)'
                  : 'var(--border)'}`,
              color: 'var(--foreground)',
            }}
          />
          <button
            onClick={submitAnswer}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
            style={{ background: 'var(--accent)', color: '#0d0d1a' }}
          >
            GO
          </button>
          {lastResult === 'correct' && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-sm font-black animate-slide-up" style={{ color: 'var(--accent)' }}>
              YES!
            </div>
          )}
          {lastResult === 'wrong' && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-sm font-black animate-slide-up" style={{ color: '#ff6b6b' }}>
              Not quite...
            </div>
          )}
        </div>

        {/* Found answers grid */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {question.answer_display.map((display, i) => {
              const isFound = foundIndices.has(i)
              return (
                <div
                  key={i}
                  className={`px-3 py-3 rounded-xl text-sm font-bold answer-chip ${isFound ? 'correct' : ''}`}
                  style={{
                    background: isFound ? 'rgba(0,232,122,0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isFound ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                    color: isFound ? 'var(--accent)' : 'rgba(240,240,255,0.2)',
                  }}
                >
                  <span className="block text-xs mb-0.5 opacity-60">#{i + 1}</span>
                  {isFound ? display.split('(')[0].trim() : '???'}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ── FINISHED ─────────────────────────────────────────────────────────────
  if (phase === 'finished' && question) {
    const myCorrect = myAnswers.length
    const total = question.answers.length
    const myPct = Math.round((myCorrect / total) * 100)
    const foundIndices = new Set(myAnswers.map(a => a.matched_index))

    // Build leaderboard from allAnswers
    const playerScoreMap = allAnswers.reduce<Record<string, Set<number>>>((acc, a) => {
      if (a.matched_index !== null) {
        if (!acc[a.player_id]) acc[a.player_id] = new Set()
        acc[a.player_id].add(a.matched_index)
      }
      return acc
    }, {})

    const leaderboard = [...allPlayers]
      .map(p => ({ ...p, score: playerScoreMap[p.id]?.size || 0 }))
      .sort((a, b) => b.score - a.score)

    const myRank = leaderboard.findIndex(p => p.id === player?.id) + 1
    const medals = ['🥇', '🥈', '🥉']

    return (
      <div className="min-h-screen p-4 pb-8">
        <div className="text-center pt-6 mb-6">
          <div className="text-5xl mb-2">{myRank === 1 ? '🏆' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '⚽'}</div>
          <h2 className="text-2xl font-black mb-1">{name}</h2>
          <p className="text-5xl font-black mb-1" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
            {myCorrect}<span className="text-xl" style={{ color: 'rgba(240,240,255,0.4)' }}>/{total}</span>
          </p>
          <p className="text-sm" style={{ color: 'rgba(240,240,255,0.5)' }}>
            {myPct}% — {myRank === 1 ? 'Winner!' : `${myRank}${['st','nd','rd'][myRank-1]||'th'} place`}
          </p>
        </div>

        {/* Leaderboard */}
        <div className="rounded-2xl p-4 mb-5" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm uppercase tracking-widest mb-3 font-bold" style={{ color: 'rgba(240,240,255,0.4)' }}>Leaderboard</h3>
          <div className="space-y-2">
            {leaderboard.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                style={{
                  background: p.id === player?.id ? 'rgba(0,232,122,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${p.id === player?.id ? 'rgba(0,232,122,0.2)' : 'transparent'}`,
                }}>
                <span className="text-lg w-7 text-center">{medals[i] || `${i + 1}`}</span>
                <span className="flex-1 font-medium">{p.name}</span>
                <span className="font-black" style={{ color: i === 0 ? 'var(--gold)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                  {p.score}/{total}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Full answer reveal */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm uppercase tracking-widest mb-3 font-bold" style={{ color: 'rgba(240,240,255,0.4)' }}>The Answers</h3>
          <p className="text-sm mb-3" style={{ color: 'rgba(240,240,255,0.5)' }}>{question.question}</p>
          <div className="space-y-1.5">
            {question.answer_display.map((display, i) => {
              const found = foundIndices.has(i)
              return (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                  style={{
                    background: found ? 'rgba(0,232,122,0.1)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${found ? 'rgba(0,232,122,0.3)' : 'var(--border)'}`,
                    color: found ? 'var(--accent)' : 'rgba(240,240,255,0.5)',
                  }}>
                  <span className="font-bold w-5 text-center text-xs">{i + 1}</span>
                  <span>{display}</span>
                  {found && <span className="ml-auto text-xs font-bold" style={{ color: 'var(--accent)' }}>GOT IT</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-xl" style={{ color: 'var(--accent)' }}>Loading...</div>
    </div>
  )
}

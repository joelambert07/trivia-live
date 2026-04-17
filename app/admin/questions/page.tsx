'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase, type Question } from '@/lib/supabase'

interface EditableAnswer {
  match: string    // the canonical answer (used for matching)
  display: string  // shown on screen (e.g. "Wayne Rooney (2003)")
}

interface EditableQuestion {
  id: string
  category: string
  question: string
  answers: EditableAnswer[]
  dirty: boolean
  expanded: boolean
}

function toEditable(q: Question): EditableQuestion {
  return {
    id: q.id,
    category: q.category,
    question: q.question,
    answers: (q.answers || []).map((a, i) => ({
      match: a,
      display: (q.answer_display || [])[i] ?? a,
    })),
    dirty: false,
    expanded: false,
  }
}

export default function AdminQuestionsPage() {
  const [qs, setQs] = useState<EditableQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null)
  const [newQ, setNewQ] = useState<EditableQuestion | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('questions').select('*').order('category').order('question')
    setQs((data as Question[] || []).map(toEditable))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(id: string, text: string, ok: boolean) {
    setMsg({ id, text, ok })
    setTimeout(() => setMsg(null), 3000)
  }

  function updateQ(id: string, patch: Partial<EditableQuestion>) {
    setQs(prev => prev.map(q => q.id === id ? { ...q, ...patch, dirty: true } : q))
  }

  function updateAnswer(qId: string, idx: number, field: 'match' | 'display', value: string) {
    setQs(prev => prev.map(q => {
      if (q.id !== qId) return q
      const answers = [...q.answers]
      answers[idx] = { ...answers[idx], [field]: value }
      return { ...q, answers, dirty: true }
    }))
  }

  function addAnswer(qId: string) {
    setQs(prev => prev.map(q =>
      q.id === qId ? { ...q, answers: [...q.answers, { match: '', display: '' }], dirty: true } : q
    ))
  }

  function removeAnswer(qId: string, idx: number) {
    setQs(prev => prev.map(q =>
      q.id === qId ? { ...q, answers: q.answers.filter((_, i) => i !== idx), dirty: true } : q
    ))
  }

  function moveAnswer(qId: string, idx: number, dir: -1 | 1) {
    setQs(prev => prev.map(q => {
      if (q.id !== qId) return q
      const arr = [...q.answers]
      const target = idx + dir
      if (target < 0 || target >= arr.length) return q;
      [arr[idx], arr[target]] = [arr[target], arr[idx]]
      return { ...q, answers: arr, dirty: true }
    }))
  }

  async function saveQ(q: EditableQuestion) {
    setSaving(q.id)
    const { error } = await supabase.from('questions').upsert({
      id: q.id,
      category: q.category.trim(),
      question: q.question.trim(),
      answers: q.answers.map(a => a.match.trim()),
      answer_display: q.answers.map(a => a.display.trim()),
    })
    setSaving(null)
    if (error) { flash(q.id, `Save failed: ${error.message}`, false) }
    else {
      flash(q.id, 'Saved ✓', true)
      setQs(prev => prev.map(p => p.id === q.id ? { ...p, dirty: false } : p))
    }
  }

  async function deleteQ(q: EditableQuestion) {
    if (!confirm(`Delete "${q.question}"?\n\nThis can't be undone.`)) return
    setDeleting(q.id)
    // Null out any game using this question first
    await supabase.from('games').update({ question_id: null }).eq('question_id', q.id)
    const { error } = await supabase.from('questions').delete().eq('id', q.id)
    setDeleting(null)
    if (error) { flash(q.id, `Delete failed: ${error.message}`, false) }
    else { setQs(prev => prev.filter(p => p.id !== q.id)) }
  }

  function startNewQ() {
    setNewQ({
      id: crypto.randomUUID(),
      category: '',
      question: '',
      answers: Array.from({ length: 10 }, () => ({ match: '', display: '' })),
      dirty: false,
      expanded: true,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveNewQ() {
    if (!newQ) return
    if (!newQ.category.trim() || !newQ.question.trim()) {
      flash('new', 'Category and question are required', false); return
    }
    const filtered = newQ.answers.filter(a => a.match.trim())
    if (filtered.length === 0) { flash('new', 'Add at least one answer', false); return }
    setSaving('new')
    const { error } = await supabase.from('questions').insert({
      id: newQ.id,
      category: newQ.category.trim(),
      question: newQ.question.trim(),
      answers: filtered.map(a => a.match.trim()),
      answer_display: filtered.map(a => a.display.trim() || a.match.trim()),
    })
    setSaving(null)
    if (error) { flash('new', `Save failed: ${error.message}`, false) }
    else { setNewQ(null); load(); flash('ok', 'Question added!', true) }
  }

  const categories = Array.from(new Set(qs.map(q => q.category))).sort()
  const filtered = qs.filter(q =>
    !filter || q.category.toLowerCase().includes(filter.toLowerCase()) || q.question.toLowerCase().includes(filter.toLowerCase())
  )
  const byCategory = filtered.reduce<Record<string, EditableQuestion[]>>((acc, q) => {
    ;(acc[q.category] = acc[q.category] || []).push(q)
    return acc
  }, {})

  function AnswerEditor({ q, isNew = false, updateFn }: {
    q: EditableQuestion
    isNew?: boolean
    updateFn: (patch: Partial<EditableQuestion>) => void
  }) {
    const id = isNew ? 'new' : q.id
    return (
      <div className="space-y-3">
        {/* Category + question */}
        <div className="flex gap-2">
          <input value={q.category}
            onChange={e => updateFn({ category: e.target.value })}
            placeholder="Category"
            className="w-28 px-3 py-2 rounded-lg text-xs font-bold outline-none"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <input value={q.question}
            onChange={e => updateFn({ question: e.target.value })}
            placeholder="Question text…"
            className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold outline-none"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        </div>

        {/* Answer rows */}
        <div className="space-y-1.5">
          <div className="flex gap-2 px-1">
            <span className="label-micro w-5 shrink-0">#</span>
            <span className="label-micro flex-1">Answer (for matching — no accents needed)</span>
            <span className="label-micro flex-1">Display text (shown on screen)</span>
            <span className="w-16 shrink-0" />
          </div>
          {q.answers.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="font-display text-sm w-5 text-center shrink-0" style={{ color: 'var(--text-faint)' }}>{i + 1}</span>
              <input value={a.match}
                onChange={e => {
                  if (isNew) {
                    const answers = [...q.answers]; answers[i] = { ...answers[i], match: e.target.value }
                    updateFn({ answers })
                  } else {
                    updateAnswer(q.id, i, 'match', e.target.value)
                  }
                }}
                placeholder="e.g. Wayne Rooney"
                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold outline-none"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <input value={a.display}
                onChange={e => {
                  if (isNew) {
                    const answers = [...q.answers]; answers[i] = { ...answers[i], display: e.target.value }
                    updateFn({ answers })
                  } else {
                    updateAnswer(q.id, i, 'display', e.target.value)
                  }
                }}
                placeholder="e.g. Wayne Rooney (2004)"
                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <div className="flex gap-0.5 shrink-0">
                <button onClick={() => isNew ? null : moveAnswer(q.id, i, -1)}
                  disabled={i === 0}
                  className="w-6 h-6 rounded text-xs flex items-center justify-center disabled:opacity-30"
                  style={{ background: 'var(--surface-2)' }}>↑</button>
                <button onClick={() => isNew ? null : moveAnswer(q.id, i, 1)}
                  disabled={i === q.answers.length - 1}
                  className="w-6 h-6 rounded text-xs flex items-center justify-center disabled:opacity-30"
                  style={{ background: 'var(--surface-2)' }}>↓</button>
                <button onClick={() => isNew
                  ? updateFn({ answers: q.answers.filter((_, idx) => idx !== i) })
                  : removeAnswer(q.id, i)}
                  className="w-6 h-6 rounded text-xs flex items-center justify-center"
                  style={{ background: 'rgba(255,45,85,0.15)', color: 'var(--red)' }}>×</button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => isNew
            ? updateFn({ answers: [...q.answers, { match: '', display: '' }] })
            : addAnswer(q.id)}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--surface-2)', color: 'var(--mint)', border: '1px solid rgba(0,255,135,0.2)' }}>
          + Add answer
        </button>

        {msg?.id === id && (
          <p className="text-xs font-semibold" style={{ color: msg.ok ? 'var(--mint)' : 'var(--red)' }}>{msg.text}</p>
        )}
      </div>
    )
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen stadium-bg noise">
      <div className="font-display text-2xl" style={{ color: 'var(--mint)' }}>LOADING</div>
    </div>
  )

  return (
    <div className="min-h-screen stadium-bg noise">
      <div className="max-w-3xl mx-auto px-5 py-8 relative z-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <a href="/" className="text-2xl">⚽</a>
          <div className="flex-1">
            <h1 className="font-display text-3xl tracking-wide" style={{ color: 'var(--text)' }}>
              QUESTION <span style={{ color: 'var(--mint)' }}>EDITOR</span>
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{qs.length} questions across {categories.length} categories</p>
          </div>
          <button onClick={startNewQ}
            className="btn-primary px-4 py-2.5 text-sm font-bold">
            + NEW QUESTION
          </button>
        </div>

        {/* Search */}
        <div className="mb-5">
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Search questions or categories…"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        </div>

        {/* New question form */}
        {newQ && (
          <div className="card p-5 mb-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full" style={{ background: 'var(--mint)' }} />
            <div className="pl-3">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="font-bold text-sm flex-1" style={{ color: 'var(--mint)' }}>NEW QUESTION</h3>
                <button onClick={() => setNewQ(null)} className="text-xs px-2 py-1 rounded"
                  style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}>✕ Cancel</button>
              </div>
              <AnswerEditor q={newQ} isNew updateFn={patch => setNewQ(prev => prev ? { ...prev, ...patch } : null)} />
              {msg?.id === 'new' && (
                <p className="text-xs font-semibold mt-2" style={{ color: msg.ok ? 'var(--mint)' : 'var(--red)' }}>{msg.text}</p>
              )}
              <button onClick={saveNewQ} disabled={saving === 'new'}
                className="btn-primary w-full py-3 mt-4 text-sm font-bold">
                {saving === 'new' ? 'SAVING…' : 'SAVE QUESTION'}
              </button>
            </div>
          </div>
        )}

        {msg?.id === 'ok' && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: 'rgba(0,255,135,0.1)', border: '1px solid rgba(0,255,135,0.3)', color: 'var(--mint)' }}>
            {msg.text}
          </div>
        )}

        {/* Questions grouped by category */}
        {Object.entries(byCategory).map(([cat, catQs]) => (
          <div key={cat} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1 h-4 rounded-full" style={{ background: 'var(--mint)' }} />
              <h2 className="label-micro">{cat}</h2>
              <span className="label-micro" style={{ color: 'var(--text-faint)' }}>{catQs.length}</span>
            </div>
            <div className="space-y-2">
              {catQs.map(q => (
                <div key={q.id} className="card overflow-hidden">
                  {/* Question header row */}
                  <button
                    onClick={() => updateQ(q.id, { expanded: !q.expanded })}
                    className="w-full flex items-center gap-3 p-4 text-left">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-snug truncate" style={{ color: 'var(--text)' }}>{q.question}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{q.answers.length} answers</p>
                    </div>
                    {q.dirty && <span className="label-micro shrink-0" style={{ color: 'var(--gold)' }}>UNSAVED</span>}
                    <span className="text-sm shrink-0" style={{ color: 'var(--text-faint)' }}>{q.expanded ? '▲' : '▼'}</span>
                  </button>

                  {/* Expanded editor */}
                  {q.expanded && (
                    <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
                      <div className="pt-4">
                        <AnswerEditor q={q} updateFn={patch => updateQ(q.id, patch)} />
                        {msg?.id === q.id && (
                          <p className="text-xs font-semibold mt-2" style={{ color: msg.ok ? 'var(--mint)' : 'var(--red)' }}>{msg.text}</p>
                        )}
                        <div className="flex gap-2 mt-4">
                          <button onClick={() => deleteQ(q)} disabled={deleting === q.id}
                            className="px-4 py-2.5 rounded-xl text-xs font-bold"
                            style={{ background: 'rgba(255,45,85,0.1)', color: 'var(--red)', border: '1px solid rgba(255,45,85,0.2)' }}>
                            {deleting === q.id ? 'DELETING…' : '🗑 DELETE'}
                          </button>
                          <button onClick={() => saveQ(q)} disabled={saving === q.id || !q.dirty}
                            className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
                            style={{
                              background: q.dirty ? 'var(--mint)' : 'var(--surface-2)',
                              color: q.dirty ? 'var(--text-dark)' : 'var(--text-muted)',
                            }}>
                            {saving === q.id ? 'SAVING…' : q.dirty ? 'SAVE CHANGES' : 'NO CHANGES'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

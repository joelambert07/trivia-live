/**
 * Batch-generate Tenable-style top-10 football trivia questions using
 * Perplexity sonar-pro (so answers are web-verified and current).
 *
 * Run: node --env-file=.env.local --experimental-strip-types scripts/generate-questions.ts
 * Or with the npm script: npm run gen-questions
 */

import { createClient } from '@supabase/supabase-js'

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions'
const MODEL = 'sonar-pro'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

interface QuestionSpec {
  category: string
  question: string
  // A tight prompt describing exactly what the top 10 list should contain.
  // Must instruct Perplexity to verify with up-to-date web sources.
  prompt: string
}

// Evergreen Tenable-style questions. Perplexity will return fresh, sourced
// answers for each.
const QUESTIONS: QuestionSpec[] = [
  {
    category: 'Premier League',
    question: 'Name the top 10 all-time Premier League goalscorers',
    prompt: 'Return the current top 10 all-time Premier League goalscorers (regular season, 1992-present). Include Harry Kane, Mohamed Salah and any other current-era players who are in the top 10 as of today.',
  },
  {
    category: 'Premier League',
    question: 'Name the top 10 all-time Premier League assists leaders',
    prompt: 'Return the current top 10 all-time Premier League assists leaders (regular season, 1992-present).',
  },
  {
    category: 'Premier League',
    question: 'Name the 10 English clubs with the most Premier League titles',
    prompt: 'Return every club that has ever won the Premier League (since 1992/93), ordered by number of titles won, with the exact count next to each. There should be only a handful — list all of them (even if fewer than 10) and do not include clubs with zero PL titles.',
  },
  {
    category: 'World Cup',
    question: 'Name the countries that have won the FIFA Men\'s World Cup',
    prompt: 'Return every country that has won the FIFA Men\'s World Cup, ordered by number of titles won, with the count next to each. As of 2022 there have only been 8 winners — list all of them. Do not include runners-up.',
  },
  {
    category: 'World Cup',
    question: 'Name the top 10 all-time FIFA World Cup goalscorers',
    prompt: 'Return the top 10 all-time FIFA Men\'s World Cup goalscorers across all tournaments in history. Include the goal totals.',
  },
  {
    category: 'Champions League',
    question: 'Name the top 10 all-time UEFA Champions League goalscorers',
    prompt: 'Return the current top 10 all-time UEFA Champions League (including European Cup era) goalscorers as of today.',
  },
  {
    category: 'Champions League',
    question: 'Name the 10 clubs with the most Champions League / European Cup titles',
    prompt: 'Return the top 10 clubs with the most European Cup / UEFA Champions League titles won. Include the title count next to each.',
  },
  {
    category: 'Ballon d\'Or',
    question: 'Name the players with the most Ballon d\'Or wins',
    prompt: 'Return the top players by number of Ballon d\'Or wins across the trophy\'s entire history up to and including the most recent award. Include Messi (most wins), Ronaldo, Platini, Cruyff, Van Basten and any tied on 2 wins. Order by wins descending. Aim for a top 10 but include ties honestly.',
  },
  {
    category: 'England',
    question: 'Name the top 10 most capped England men\'s football players',
    prompt: 'Return the current top 10 most-capped England men\'s senior football internationals of all time, as of today. Make sure Harry Kane and Jordan Henderson\'s current cap totals are up to date.',
  },
  {
    category: 'England',
    question: 'Name the top 10 all-time England men\'s goalscorers',
    prompt: 'Return the current top 10 all-time England men\'s senior football top goalscorers. Harry Kane is number one — include his current goal total.',
  },
  {
    category: 'Transfers',
    question: 'Name the 10 most expensive football transfers of all time',
    prompt: 'Return the top 10 most expensive football transfer fees of all time in men\'s football (in euros). As of today, Neymar to PSG (2017) is still #1 at €222m. Include recent big-money transfers. Provide the fee and year.',
  },
  {
    category: 'Premier League',
    question: 'Name the 10 managers with the most Premier League titles',
    prompt: 'Return the managers who have won the Premier League (since 1992/93), ordered by number of PL titles won, with the count next to each. Include Sir Alex Ferguson, Pep Guardiola, Jose Mourinho, Arsène Wenger and any others. List all qualifying managers.',
  },

  // ─── Niche / shirt-number / chronological ───────────────────────────────
  {
    category: 'Man United',
    question: 'Name the last 10 players to wear the number 7 shirt for Manchester United',
    prompt: 'Return the 10 most recent players to wear the number 7 shirt for Manchester United men\'s first team, from most recent to least recent. As of today (2026), include Mason Mount (current #7 as of 2024/25), Antony, Cristiano Ronaldo (2nd spell 2021-22), Edinson Cavani, Alexis Sanchez, Memphis Depay, Angel Di Maria, Michael Owen, Cristiano Ronaldo (1st spell) and David Beckham. Verify the exact order and include the year they started wearing it.',
  },
  {
    category: 'Arsenal',
    question: 'Name the last 10 players to wear the number 10 shirt for Arsenal',
    prompt: 'Return the 10 most recent players to wear the number 10 shirt for Arsenal men\'s first team, from most recent to least recent. Verify against Arsenal squad records. Include the year each started wearing #10.',
  },
  {
    category: 'Premier League',
    question: 'Name the last 10 winners of the Premier League Golden Boot',
    prompt: 'Return the winners of the Premier League Golden Boot (top scorer) for the last 10 seasons, from most recent backwards. Include the season (e.g. 2023/24) and goal total. Account for any seasons with shared winners.',
  },
  {
    category: 'Champions League',
    question: 'Name the last 10 winners of the UEFA Champions League',
    prompt: 'Return the 10 most recent UEFA Champions League winning clubs, from most recent final backwards. Include the season and the team they beat in the final.',
  },
  {
    category: 'World Cup',
    question: 'Name the last 10 winners of the FIFA Men\'s World Cup',
    prompt: 'Return the 10 most recent FIFA Men\'s World Cup winning nations, from most recent backwards. Include the year of the tournament.',
  },
  {
    category: 'FA Cup',
    question: 'Name the last 10 winners of the FA Cup',
    prompt: 'Return the 10 most recent winners of the FA Cup (men\'s competition), from most recent final backwards. Include the year and the team they beat in the final.',
  },
  {
    category: 'Ballon d\'Or',
    question: 'Name the last 10 winners of the Ballon d\'Or',
    prompt: 'Return the 10 most recent winners of the men\'s Ballon d\'Or, from most recent backwards. Include the year and their club at the time of winning. As of today (2026) the most recent winners include Rodri (2024), Lionel Messi (2023) and Karim Benzema (2022).',
  },
  {
    category: 'Premier League',
    question: 'Name the 10 Premier League clubs with the longest current top-flight runs',
    prompt: 'Return the 10 Premier League clubs with the longest continuous current top-flight (Premier League era 1992/93 onwards) runs without being relegated, as of the 2025/26 season. Include the year their current run started. Arsenal (since 1919) and Liverpool (since 1962) have the longest. Verify current status.',
  },
  {
    category: 'Transfers',
    question: 'Name the 10 most expensive goalkeeper transfers of all time',
    prompt: 'Return the top 10 most expensive goalkeeper transfer fees of all time in men\'s football (in euros). Include Kepa Arrizabalaga to Chelsea, Alisson to Liverpool, Ederson to Man City, Onana to Man United etc. Include the fee and year for each.',
  },
  {
    category: 'England',
    question: 'Name the last 10 permanent England men\'s football managers',
    prompt: 'Return the last 10 permanent (not caretaker) managers of the England men\'s senior football team, from most recent backwards. As of 2026, include Thomas Tuchel (appointed 2025), Gareth Southgate, Sam Allardyce, Roy Hodgson, Fabio Capello, Steve McClaren, Sven-Göran Eriksson, Kevin Keegan, Glenn Hoddle and Terry Venables. Include the years they managed.',
  },
  {
    category: 'Premier League',
    question: 'Name the last 10 Premier League Player of the Season winners',
    prompt: 'Return the PFA Players\' Player of the Year (or, where unavailable, the Premier League Player of the Season) winners for the last 10 seasons. Include the season and their club at the time.',
  },
  {
    category: 'Champions League',
    question: 'Name the last 10 different clubs to reach a Champions League final',
    prompt: 'Return the 10 most recent different clubs (finalists — winners or runners-up) to appear in a UEFA Champions League final, working backwards from the most recent final. First appearance only, so each club is listed once. Include the year of their most recent final appearance.',
  },
  {
    category: 'Premier League',
    question: 'Name the 10 players with the most Premier League red cards',
    prompt: 'Return the top 10 players with the most red cards in Premier League history. Include the red card count. Richard Dunne and Patrick Vieira are among the leaders.',
  },
  {
    category: 'Liverpool',
    question: 'Name the 10 all-time top goalscorers for Liverpool FC',
    prompt: 'Return the top 10 all-time goalscorers for Liverpool FC men\'s first team (all competitions), with goal totals. Mohamed Salah has overtaken Ian Rush — verify the current order and include his up-to-date tally.',
  },
  {
    category: 'Chelsea',
    question: 'Name the 10 all-time top goalscorers for Chelsea FC',
    prompt: 'Return the top 10 all-time goalscorers for Chelsea FC men\'s first team (all competitions), with goal totals. Frank Lampard is the all-time top scorer.',
  },
  {
    category: 'Euros',
    question: 'Name the 10 most recent UEFA European Championship winners',
    prompt: 'Return the 10 most recent winners of the UEFA European Championship (men\'s Euros), from most recent backwards. Include the year.',
  },
  {
    category: 'Real Madrid',
    question: 'Name the last 10 managers of Real Madrid',
    prompt: 'Return the last 10 permanent managers of Real Madrid men\'s first team, from most recent backwards. Include the years they managed.',
  },
  {
    category: 'Barcelona',
    question: 'Name the 10 all-time top goalscorers for FC Barcelona',
    prompt: 'Return the top 10 all-time goalscorers for FC Barcelona men\'s first team (all competitions), with goal totals. Lionel Messi is #1.',
  },
  {
    category: 'Hat-tricks',
    question: 'Name the 10 players with the most Premier League hat-tricks',
    prompt: 'Return the top 10 players with the most Premier League hat-tricks (3+ goals in a single match), with the hat-trick count. Alan Shearer, Harry Kane, Sergio Aguero and Robbie Fowler are among the leaders.',
  },
]

// ─── Additional questions (appended to existing DB, not replacing) ───────────
const EXTRA_QUESTIONS: QuestionSpec[] = [
  // ── Club all-time top scorers ─────────────────────────────────────────────
  {
    category: 'Man United',
    question: 'Name the 10 all-time top goalscorers for Manchester United',
    prompt: 'Return the top 10 all-time goalscorers for Manchester United men\'s first team (all competitions), with goal totals. Wayne Rooney is the all-time top scorer with 253 goals. Verify up-to-date totals.',
  },
  {
    category: 'Arsenal',
    question: 'Name the 10 all-time top goalscorers for Arsenal FC',
    prompt: 'Return the top 10 all-time goalscorers for Arsenal FC men\'s first team (all competitions), with goal totals. Thierry Henry is the all-time top scorer. Verify current players like Bukayo Saka\'s tally.',
  },
  {
    category: 'Tottenham',
    question: 'Name the 10 all-time top goalscorers for Tottenham Hotspur',
    prompt: 'Return the top 10 all-time goalscorers for Tottenham Hotspur men\'s first team (all competitions), with goal totals. Jimmy Greaves is the all-time top scorer with 266 goals.',
  },
  {
    category: 'Man City',
    question: 'Name the 10 all-time top goalscorers for Manchester City',
    prompt: 'Return the top 10 all-time goalscorers for Manchester City men\'s first team (all competitions), with goal totals. Sergio Aguero is the all-time top scorer with 260 goals.',
  },
  // ── Managers ─────────────────────────────────────────────────────────────
  {
    category: 'Man United',
    question: 'Name the last 10 permanent managers of Manchester United',
    prompt: 'Return the last 10 permanent (not caretaker) managers of Manchester United men\'s first team, from most recent backwards. As of 2026, include Ruben Amorim (2024-), Erik ten Hag (2022-2024), Ole Gunnar Solskjaer, Jose Mourinho, Louis van Gaal, David Moyes, Sir Alex Ferguson and others. Include the years they managed.',
  },
  {
    category: 'Liverpool',
    question: 'Name the last 10 permanent managers of Liverpool FC',
    prompt: 'Return the last 10 permanent (not caretaker) managers of Liverpool FC men\'s first team, from most recent backwards. As of 2026, Arne Slot took over from Jurgen Klopp in 2024. Include years managed.',
  },
  {
    category: 'Arsenal',
    question: 'Name the last 10 permanent managers of Arsenal FC',
    prompt: 'Return the last 10 permanent (not caretaker) managers of Arsenal FC men\'s first team, from most recent backwards. As of 2026, Mikel Arteta is manager (since 2019). Include years managed.',
  },
  // ── Shirt numbers ────────────────────────────────────────────────────────
  {
    category: 'Liverpool',
    question: 'Name the last 10 players to wear the number 7 shirt for Liverpool',
    prompt: 'Return the 10 most recent players to wear the iconic number 7 shirt for Liverpool men\'s first team, from most recent to least recent. Luis Diaz currently wears #7. Include the year each started wearing it.',
  },
  {
    category: 'Tottenham',
    question: 'Name the last 10 players to wear the number 10 shirt for Tottenham Hotspur',
    prompt: 'Return the 10 most recent players to wear the number 10 shirt for Tottenham Hotspur men\'s first team, from most recent to least recent. Include the year each started wearing #10.',
  },
  {
    category: 'Man City',
    question: 'Name the last 10 players to wear the number 10 shirt for Manchester City',
    prompt: 'Return the 10 most recent players to wear the number 10 shirt for Manchester City men\'s first team, from most recent to least recent. Jack Grealish currently wears #10. Include the year each started wearing it.',
  },
  // ── Domestic cups ─────────────────────────────────────────────────────────
  {
    category: 'FA Cup',
    question: 'Name the clubs with the most FA Cup wins of all time',
    prompt: 'Return every club with 5 or more FA Cup wins (men\'s competition), ordered by number of wins descending. Arsenal, Manchester United and Chelsea are among the leaders. Include the win count for each.',
  },
  {
    category: 'EFL Cup',
    question: 'Name the last 10 winners of the EFL Cup (Carabao Cup / League Cup)',
    prompt: 'Return the 10 most recent winners of the English Football League Cup (also known as the Carabao Cup or League Cup), from most recent final backwards. Include the year and the team they beat in the final. Liverpool have won it most recently multiple times.',
  },
  {
    category: 'Copa del Rey',
    question: 'Name the last 10 winners of the Copa del Rey',
    prompt: 'Return the 10 most recent winners of the Spanish Copa del Rey (men\'s competition), from most recent final backwards. Include the year and the team they beat in the final.',
  },
  // ── International competitions ─────────────────────────────────────────
  {
    category: 'Copa America',
    question: 'Name the countries that have won the Copa America',
    prompt: 'Return every country that has won the Copa America (men\'s tournament), ordered by number of titles won descending, with the count. Argentina and Uruguay are the most successful. As of 2024, Argentina won the most recent Copa America.',
  },
  {
    category: 'Africa',
    question: 'Name the last 10 winners of the Africa Cup of Nations',
    prompt: 'Return the 10 most recent winners of the Africa Cup of Nations (AFCON, men\'s competition), from most recent tournament backwards. Include the year. The 2024 AFCON was won by Ivory Coast.',
  },
  {
    category: 'World Cup',
    question: 'Name the last 10 FIFA World Cup Golden Boot winners',
    prompt: 'Return the winners of the FIFA World Cup Golden Boot (top scorer) for the last 10 tournaments, from most recent backwards. Include the year, player name, country and goals scored. Kylian Mbappe won it at 2022.',
  },
  {
    category: 'World Cup',
    question: 'Name the last 10 FIFA World Cup host nations',
    prompt: 'Return the host nation(s) of the last 10 FIFA Men\'s World Cup tournaments, from most recent backwards. Include the year. 2026 is USA/Canada/Mexico.',
  },
  // ── La Liga ───────────────────────────────────────────────────────────────
  {
    category: 'La Liga',
    question: 'Name the top 10 all-time La Liga goalscorers',
    prompt: 'Return the current top 10 all-time La Liga goalscorers (in the Spanish top flight). Lionel Messi is #1 with 474 goals. Cristiano Ronaldo, Hugo Sanchez, Raul and Benzema are in the top 10.',
  },
  {
    category: 'La Liga',
    question: 'Name the 10 clubs with the most La Liga titles',
    prompt: 'Return the top 10 clubs by number of La Liga (Spanish top flight) titles won. Real Madrid and Barcelona are #1 and #2. Include the title count for each.',
  },
  // ── International records ─────────────────────────────────────────────
  {
    category: 'International',
    question: 'Name the top 10 all-time international goalscorers in men\'s football',
    prompt: 'Return the top 10 all-time international goalscorers in men\'s senior football across all nations, with goal totals. Cristiano Ronaldo is #1 with 130+ goals. Include Ali Daei, Mokhtar Dahari, Romelu Lukaku, Sunil Chhetri and any others in the top 10.',
  },
  {
    category: 'International',
    question: 'Name the top 10 most capped players in men\'s international football history',
    prompt: 'Return the top 10 most capped male footballers in international football history (all nations combined). Bader Al-Mutawa of Kuwait holds the record with 200+ caps. Include Cristiano Ronaldo, Sergio Ramos, Luca Toni and others in the top 10. Include cap totals.',
  },
  // ── Premier League records ────────────────────────────────────────────
  {
    category: 'Premier League',
    question: 'Name the 10 highest individual goal tallies in a single Premier League season',
    prompt: 'Return the top 10 highest individual goal tallies (most goals scored in a single Premier League season by one player), with the player name, season and goal count. Erling Haaland\'s 36 goals in 2022/23 is the record.',
  },
  {
    category: 'Premier League',
    question: 'Name the 10 Premier League clubs with the most top-flight titles in English football (First Division + Premier League combined)',
    prompt: 'Return the top 10 clubs by combined total of English top-flight titles (First Division 1888/89 to 1991/92 plus Premier League 1992/93 onwards). Manchester United lead with 20. Include both eras combined.',
  },
  // ── Awards ─────────────────────────────────────────────────────────────
  {
    category: 'Awards',
    question: 'Name the last 10 winners of the FIFA Best Men\'s Player award',
    prompt: 'Return the last 10 winners of the FIFA Best Men\'s Player award (introduced in 2016), from most recent backwards. Include the year and their club at the time. Rodri won in 2024.',
  },
  {
    category: 'Awards',
    question: 'Name the last 10 winners of the UEFA Men\'s Player of the Year award',
    prompt: 'Return the last 10 winners of the UEFA Men\'s Player of the Year award (previously UEFA Best Player in Europe), from most recent backwards. Include the year and their club at the time.',
  },
  // ── European league titles ────────────────────────────────────────────
  {
    category: 'Bundesliga',
    question: 'Name the 10 clubs with the most Bundesliga titles',
    prompt: 'Return the top 10 clubs by number of Bundesliga (German top flight) titles won. Bayern Munich dominate with 30+ titles. Include the title count for each.',
  },
  {
    category: 'Serie A',
    question: 'Name the 10 clubs with the most Serie A titles',
    prompt: 'Return the top 10 clubs by number of Serie A (Italian top flight) titles won. Juventus lead with 36 titles. Include the title count for each.',
  },
]

interface PerplexityResponse {
  choices: Array<{ message: { content: string } }>
}

async function askPerplexity(spec: QuestionSpec): Promise<{ answers: string[]; answer_display: string[] }> {
  const system = `You are a meticulous sports trivia researcher. You will be asked to produce a top-10 list for a football trivia game. You MUST return strictly valid JSON and nothing else — no markdown, no prose, no commentary.

The JSON must have this exact shape:
{
  "answers": ["primary name 1", "primary name 2", ...],
  "answer_display": ["Primary Name 1 (stat)", "Primary Name 2 (stat)", ...]
}

Rules:
- "answers" is the simple, canonical name players would type (e.g. "Wayne Rooney", "Brazil", "Manchester United"). No accents where avoidable for easier matching.
- "answer_display" is the same order but formatted for display with the stat in parentheses (e.g. "Wayne Rooney (208 goals)", "Brazil (5 titles)").
- Both arrays must be the same length, ideally 10 entries. Fewer is fine if the category has fewer qualifying entries (e.g. only 8 countries have won the World Cup).
- Order from highest/best to lowest/worst.
- Verify every entry against current web sources — do NOT include anyone who doesn't belong on the list.`

  const user = `Category: ${spec.category}
Question: ${spec.question}

${spec.prompt}

Return the JSON now.`

  const res = await fetch(PERPLEXITY_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
    }),
  })

  if (!res.ok) {
    throw new Error(`Perplexity error ${res.status}: ${await res.text()}`)
  }

  const data = await res.json() as PerplexityResponse
  const content = data.choices[0].message.content.trim()

  // Strip markdown fences if Perplexity added any
  const jsonStr = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(jsonStr) as { answers: string[]; answer_display: string[] }

  if (!Array.isArray(parsed.answers) || !Array.isArray(parsed.answer_display)) {
    throw new Error(`Malformed response for "${spec.question}": ${content}`)
  }
  if (parsed.answers.length !== parsed.answer_display.length) {
    throw new Error(`Array length mismatch for "${spec.question}"`)
  }

  return parsed
}

async function main() {
  // APPEND=1 → only generate EXTRA_QUESTIONS and insert without wiping existing data
  const appendMode = process.env.APPEND === '1'
  const specs = appendMode ? EXTRA_QUESTIONS : QUESTIONS

  console.log(`${appendMode ? 'Appending' : 'Generating'} ${specs.length} questions via Perplexity...\n`)

  const results: Array<QuestionSpec & { answers: string[]; answer_display: string[] }> = []
  for (const spec of specs) {
    process.stdout.write(`• ${spec.question} ... `)
    try {
      const { answers, answer_display } = await askPerplexity(spec)
      results.push({ ...spec, answers, answer_display })
      console.log(`✓ ${answers.length} answers`)
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`)
    }
  }

  console.log(`\nPreview:`)
  for (const r of results) {
    console.log(`\n[${r.category}] ${r.question}`)
    r.answer_display.forEach((a, i) => console.log(`  ${i + 1}. ${a}`))
  }

  if (!appendMode) {
    console.log(`\nWiping existing questions and inserting ${results.length}...`)
    // Clear FK references from any existing games/rounds before deleting questions
    const { error: nullErr } = await supabase.from('games').update({ question_id: null }).not('question_id', 'is', null)
    if (nullErr) throw nullErr
    const { error: deleteErr } = await supabase.from('questions').delete().not('id', 'is', null)
    if (deleteErr) throw deleteErr
  } else {
    console.log(`\nAppending ${results.length} new questions (existing questions preserved)...`)
  }

  const { error: insertErr } = await supabase.from('questions').insert(
    results.map(r => ({
      category: r.category,
      question: r.question,
      answers: r.answers,
      answer_display: r.answer_display,
    }))
  )
  if (insertErr) throw insertErr

  console.log(`✓ Done. ${results.length} questions ${appendMode ? 'added' : 'live'}.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

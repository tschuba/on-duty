#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const DIFF_THRESHOLD = 80
const OVERALL_CAP = 80
const MARKER = '<!-- coverage-gate -->'

const { GITHUB_TOKEN, BASE_REF = 'master', PR_NUMBER, REPO } = process.env

const prCov = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8')).total
const masterCov = existsSync('coverage-master/coverage-summary.json')
  ? JSON.parse(readFileSync('coverage-master/coverage-summary.json', 'utf8')).total
  : null

function checkOverall(metric) {
  const pr = prCov[metric].pct
  const master = masterCov?.[metric].pct ?? null
  if (pr >= OVERALL_CAP) return { pass: true, pr, master, reason: `≥${OVERALL_CAP}%` }
  if (master === null) return { pass: true, pr, master, reason: 'no baseline' }
  if (pr >= master) return { pass: true, pr, master, reason: 'no regression' }
  return { pass: false, pr, master, reason: `${pr.toFixed(1)}% < master ${master.toFixed(1)}%` }
}

const lines = checkOverall('lines')
const branches = checkOverall('branches')

function diffCoverage() {
  let diffOutput
  try {
    diffOutput = execSync(`git diff origin/${BASE_REF}...HEAD -- 'src/**'`, { encoding: 'utf8' })
  } catch {
    return { skip: true }
  }

  const changedLines = {}
  let currentFile = null, lineNum = 0

  for (const line of diffOutput.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6)
      changedLines[currentFile] ??= new Set()
    } else if (line.startsWith('@@ ')) {
      const m = line.match(/\+(\d+)/)
      lineNum = m ? parseInt(m[1]) - 1 : 0
    } else if (currentFile) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        changedLines[currentFile].add(lineNum)
        lineNum++
      } else if (!line.startsWith('-')) {
        lineNum++
      }
    }
  }

  if (!existsSync('coverage/coverage-final.json')) return { skip: true }

  const coverage = JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8'))
  const cwd = process.cwd()

  const coveredLines = {}
  for (const [filePath, data] of Object.entries(coverage)) {
    const rel = filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath
    const covered = new Set()
    for (const [id, count] of Object.entries(data.s)) {
      if (count > 0) {
        const stmt = data.statementMap[id]
        for (let l = stmt.start.line; l <= stmt.end.line; l++) covered.add(l)
      }
    }
    coveredLines[rel] = covered
  }

  let total = 0, covered = 0
  for (const [file, addedLines] of Object.entries(changedLines)) {
    const cov = coveredLines[file]
    if (!cov) continue
    for (const l of addedLines) { total++; if (cov.has(l)) covered++ }
  }

  if (total === 0) return { skip: true }
  const pct = (covered / total) * 100
  return { pct, covered, total, pass: pct >= DIFF_THRESHOLD }
}

const diff = diffCoverage()

const icon = (pass) => pass ? '✅' : '❌'

const diffLine = diff.skip
  ? '> ℹ️ **Diff coverage:** no new coverable lines'
  : `> ${icon(diff.pass)} **Diff coverage:** ${diff.pct.toFixed(1)}% (${diff.covered}/${diff.total} new lines, threshold: ${DIFF_THRESHOLD}%)`

function fmtRow(label, result) {
  const base = result.master !== null ? ` _(master: ${result.master.toFixed(1)}%)_` : ''
  return `| ${label} | ${result.pr.toFixed(1)}%${base} | ${icon(result.pass)} ${result.reason} |`
}

const body = `${MARKER}
## Coverage

${diffLine}

| Metric | PR | Status |
|--------|----|--------|
${fmtRow('Lines', lines)}
${fmtRow('Branches', branches)}
`

async function postComment() {
  if (!GITHUB_TOKEN || !PR_NUMBER || !REPO) {
    console.log(body)
    return
  }

  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  const comments = await fetch(
    `https://api.github.com/repos/${REPO}/issues/${PR_NUMBER}/comments?per_page=100`,
    { headers }
  ).then(r => r.json())

  const existing = Array.isArray(comments) && comments.find(c => c.body?.includes(MARKER))

  if (existing) {
    await fetch(`https://api.github.com/repos/${REPO}/issues/comments/${existing.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ body }),
    })
  } else {
    await fetch(`https://api.github.com/repos/${REPO}/issues/${PR_NUMBER}/comments`, {
      method: 'POST', headers, body: JSON.stringify({ body }),
    })
  }
}

await postComment()

const allPass = lines.pass && branches.pass && (diff.skip || diff.pass)
if (!allPass) {
  console.error('Coverage gate failed')
  process.exit(1)
}

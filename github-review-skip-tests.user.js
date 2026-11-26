// ==UserScript==
// @name         GitHub Review: Skip Tests
// @namespace    https://github.com/hyoban/github-review-skip-tests
// @version      0.4.0
// @description  PR files/changes pages: auto-marks test and generated files as Viewed. Commit pages: auto-collapses them.
// @author       hyoban
// @license      MIT
// @homepageURL  https://github.com/hyoban/github-review-skip-tests
// @supportURL   https://github.com/hyoban/github-review-skip-tests/issues
// @updateURL    https://github.com/hyoban/github-review-skip-tests/raw/main/github-review-skip-tests.user.js
// @downloadURL  https://github.com/hyoban/github-review-skip-tests/raw/main/github-review-skip-tests.user.js
// @match        https://github.com/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict'

  const TEST_RE = /(^|\/)(__tests__|__mocks__|tests?|e2e|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|(^|\/)conftest\.py$/
  const PR_PAGE_RE = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/
  const COMMIT_PAGE_RE = /^\/[^/]+\/[^/]+\/(commit\/[0-9a-f]{7,40}|pull\/\d+\/commits\/[0-9a-f]{7,40})/
  const BTN_ID = 'tm-mark-tests-viewed'
  const COLLAPSE_SEL = 'button[data-telemetry-action="shared.file_header.collapse"]'
  const FILE_TOGGLE_SEL = `${COLLAPSE_SEL}, button[data-telemetry-action="shared.file_header.expand"]`

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const clean = s => (s || '').replace(/[‎‏​]/g, '').trim()
  const pageKey = () => (location.pathname.match(/^\/[^/]+\/[^/]+\/(pull\/\d+(\/commits\/[0-9a-f]+)?|commit\/[0-9a-f]+)/) || [location.pathname])[0]

  // ---------- shared helpers ----------

  const isViewedToggle = el => {
    if (el.matches('input.js-reviewed-checkbox')) return true
    if (el.tagName !== 'BUTTON' || el.id === BTN_ID) return false
    const label = clean(el.getAttribute('aria-label') || el.textContent)
    return /^(mark as )?(not )?viewed$/i.test(label) || /^viewed\b/i.test(label)
  }

  const isChecked = el =>
    el.type === 'checkbox'
      ? el.checked
      : el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true'

  // Largest ancestor of `el` that still holds only one element matching `isOwn`.
  const blockOf = (el, isOwn) => {
    let node = el
    while (node.parentElement && node.parentElement !== document.body) {
      if ([...node.parentElement.querySelectorAll('input, button')].filter(isOwn).length > 1) break
      node = node.parentElement
    }
    return node.closest('.file') || node
  }

  const pathIn = box =>
    box.dataset?.path || box.dataset?.tagsearchPath ||
    box.querySelector('[data-path]')?.dataset.path ||
    clean(box.querySelector('h3 code, h3 a, h3')?.textContent) ||
    box.querySelector('[data-file-path]')?.dataset.filePath ||
    clean(box.querySelector('table[aria-label^="Diff for: "]')?.getAttribute('aria-label').slice(10)) ||
    null

  // Climb from the toggle to the smallest ancestor that names a file path.
  const pathOf = el => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const p = node.dataset.path || node.dataset.filePath || node.dataset.tagsearchPath
      if (p) return p
      const attr = node.querySelector(':scope [data-path], :scope [data-file-path]')
      if (attr && node.querySelectorAll('input.js-reviewed-checkbox, button').length < 30)
        return attr.dataset.path || attr.dataset.filePath
      const named = [...node.querySelectorAll('h3, a, code')]
        .map(e => clean(e.textContent))
        .find(t => /^[\w@.\-]+(\/[\w@.\-\[\]()]+)+$/.test(t) || /^[\w@.\-]+\.\w+$/.test(t))
      if (named) return named
    }
    return null
  }

  // GitHub collapses generated files (linguist-generated, lockfiles, …) with a notice like
  // "Some generated files are not rendered by default". Look for that text outside diff code.
  const GENERATED_RE = /\bgenerated files?\b/i
  const hasGeneratedNotice = box => {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
      acceptNode: n =>
        n.parentElement?.closest('table, pre, code, [role="grid"], .blob-code, [class*="diff-text"]')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    })
    for (let n; (n = walker.nextNode());) if (GENERATED_RE.test(n.textContent)) return true
    return false
  }

  const shouldMark = (el, path) => TEST_RE.test(path) || hasGeneratedNotice(blockOf(el, isViewedToggle))

  // ---------- PR pages: mark as viewed ----------

  let running = false
  async function run() {
    if (running || !PR_PAGE_RE.test(location.pathname)) return
    running = true
    const btn = document.getElementById(BTN_ID)
    const setLabel = t => btn && (btn.textContent = t)
    setLabel('Marking…')

    const done = new Set()
    let marked = 0
    const sweep = async () => {
      for (const el of document.querySelectorAll('input.js-reviewed-checkbox, button')) {
        if (!isViewedToggle(el)) continue
        const path = pathOf(el)
        if (!path || done.has(path)) continue
        done.add(path)
        if (!shouldMark(el, path)) continue
        if (isChecked(el)) { console.log('[mark-tests] already viewed:', path); continue }
        el.click()
        marked++
        console.log('[mark-tests] marked viewed:', path)
        await sleep(250)
      }
    }

    try {
      const start = scrollY
      await sweep()
      // Scroll through so lazily rendered files get handled too.
      for (let y = 0; y <= document.documentElement.scrollHeight; y += innerHeight * 0.8) {
        scrollTo(0, y)
        await sleep(400)
        await sweep()
      }
      scrollTo(0, start)
      const msg = `${marked} file(s) marked, ${done.size} file(s) seen`
      console.log('[mark-tests]', msg)
      setLabel(`✓ ${msg}`)
      setTimeout(() => setLabel('Mark tests viewed'), 4000)
    } finally {
      running = false
    }
  }

  function ensureButton() {
    const onPage = PR_PAGE_RE.test(location.pathname)
    const existing = document.getElementById(BTN_ID)
    if (!onPage) { existing?.remove(); return }
    if (existing) return
    const btn = document.createElement('button')
    btn.id = BTN_ID
    btn.type = 'button'
    btn.textContent = 'Mark tests viewed'
    Object.assign(btn.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647,
      padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(31,35,40,.15)',
      background: '#1f883d', color: '#fff', font: '600 12px -apple-system, sans-serif',
      cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
    })
    btn.addEventListener('click', run)
    document.body.appendChild(btn)
  }

  // ---------- auto mode ----------
  // Each file is handled at most once per page visit, so undoing one by hand sticks.
  let autoKey = null
  let autoDone = new Set()
  let autoBusy = false

  async function autoMarkViewed() {
    for (const el of document.querySelectorAll('input.js-reviewed-checkbox, button')) {
      if (!isViewedToggle(el)) continue
      const path = pathOf(el)
      if (!path || autoDone.has(path)) continue
      autoDone.add(path)
      if (!shouldMark(el, path) || isChecked(el)) continue
      el.click()
      console.log('[mark-tests] auto-marked viewed:', path)
      await sleep(250)
    }
  }

  async function autoCollapse() {
    const isFileToggle = el => el.matches(FILE_TOGGLE_SEL)
    for (const el of document.querySelectorAll(FILE_TOGGLE_SEL)) {
      const box = blockOf(el, isFileToggle)
      const path = pathIn(box)
      if (!path || autoDone.has(path)) continue
      autoDone.add(path)
      if (!el.matches(COLLAPSE_SEL)) continue // already collapsed
      if (!TEST_RE.test(path) && !hasGeneratedNotice(box)) continue
      el.click()
      console.log('[mark-tests] auto-collapsed:', path)
      await sleep(50)
    }
  }

  async function autoSweep() {
    const onPR = PR_PAGE_RE.test(location.pathname)
    const onCommit = COMMIT_PAGE_RE.test(location.pathname)
    if ((!onPR && !onCommit) || autoBusy || running) return
    const key = pageKey()
    if (key !== autoKey) { autoKey = key; autoDone = new Set() }
    autoBusy = true
    try {
      if (onPR) await autoMarkViewed()
      else await autoCollapse()
    } finally {
      autoBusy = false
    }
  }

  let timer
  const schedule = () => { clearTimeout(timer); timer = setTimeout(autoSweep, 500) }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })

  GM_registerMenuCommand('Mark test files as viewed (scroll whole page)', run)

  // GitHub is an SPA: re-check on navigation.
  ensureButton()
  schedule()
  document.addEventListener('turbo:load', () => { ensureButton(); schedule() })
  window.addEventListener('popstate', ensureButton)
  setInterval(ensureButton, 1000)
})()

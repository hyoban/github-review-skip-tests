// ==UserScript==
// @name         GitHub Review: Skip Tests
// @namespace    https://github.com/hyoban/github-review-skip-tests
// @version      0.6.0
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

  // Scroll through the whole page (so lazily rendered files get handled too) and mark every
  // file for which `match(el, path)` is true. `targets`, when given, lets it stop early.
  let running = false
  async function markAll({ match = shouldMark, targets = null, setLabel = () => {}, doneLabel } = {}) {
    if (running || !PR_PAGE_RE.test(location.pathname)) return
    running = true
    setLabel('Marking…')

    const done = new Set()
    let marked = 0
    const allFound = () => targets && [...targets].every(p => done.has(p))
    const sweep = async () => {
      for (const el of document.querySelectorAll('input.js-reviewed-checkbox, button')) {
        if (!isViewedToggle(el)) continue
        const path = pathOf(el)
        if (!path || done.has(path)) continue
        done.add(path)
        if (!match(el, path)) continue
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
      for (let y = 0; !allFound() && y <= document.documentElement.scrollHeight; y += innerHeight * 0.8) {
        scrollTo(0, y)
        await sleep(400)
        await sweep()
      }
      scrollTo(0, start)
      const msg = `${marked} file(s) marked`
      console.log('[mark-tests]', msg, `(${done.size} file(s) seen)`)
      setLabel(`✓ ${msg}`)
      setTimeout(() => setLabel(doneLabel), 3000)
    } finally {
      running = false
    }
  }

  function run() {
    const btn = document.getElementById(BTN_ID)
    return markAll({ setLabel: t => btn && t && (btn.textContent = t), doneLabel: 'Mark tests viewed' })
  }

  // Commit pages: scroll through the page and collapse every file whose path starts with `prefix`.
  async function collapseAll({ prefix, targets = null, setLabel = () => {}, doneLabel } = {}) {
    if (running || !COMMIT_PAGE_RE.test(location.pathname)) return
    running = true
    setLabel('Collapsing…')

    const isFileToggle = el => el.matches(FILE_TOGGLE_SEL)
    const done = new Set()
    let collapsed = 0
    const allFound = () => targets && [...targets].every(p => done.has(p))
    const sweep = async () => {
      for (const el of document.querySelectorAll(FILE_TOGGLE_SEL)) {
        const path = pathIn(blockOf(el, isFileToggle))
        if (!path || done.has(path) || !path.startsWith(prefix)) continue
        done.add(path)
        if (!el.matches(COLLAPSE_SEL)) continue // already collapsed
        el.click()
        collapsed++
        await sleep(50)
      }
    }

    try {
      const start = scrollY
      await sweep()
      for (let y = 0; !allFound() && y <= document.documentElement.scrollHeight; y += innerHeight * 0.8) {
        scrollTo(0, y)
        await sleep(300)
        await sweep()
      }
      scrollTo(0, start)
      console.log('[mark-tests]', `${collapsed} file(s) collapsed under ${prefix}`)
      setLabel(`✓ ${collapsed} collapsed`)
      setTimeout(() => setLabel(doneLabel), 3000)
    } finally {
      running = false
    }
  }

  // ---------- Folder buttons in the file tree ----------
  // PR pages: "View all" marks every file in the folder as viewed.
  // Commit pages: "Collapse all" collapses every file in the folder.
  // Tree items carry the full path as their id: folders "web/app", files "web/app/x.ts".
  const FOLDER_BTN_CLASS = 'tm-folder-view-all'

  function ensureFolderButtons() {
    const mode = PR_PAGE_RE.test(location.pathname) ? 'view' : COMMIT_PAGE_RE.test(location.pathname) ? 'collapse' : null
    if (!mode) return
    const label = mode === 'view' ? 'View all' : 'Collapse all'
    if (!document.getElementById(`${FOLDER_BTN_CLASS}-style`)) {
      const style = document.createElement('style')
      style.id = `${FOLDER_BTN_CLASS}-style`
      style.textContent = `
        .${FOLDER_BTN_CLASS} {
          margin-left: auto; flex-shrink: 0; padding: 0 6px; height: 20px; line-height: 18px;
          border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 6px;
          background: var(--bgColor-default, #fff); color: var(--fgColor-muted, #59636e);
          font: 500 11px -apple-system, sans-serif; cursor: pointer; visibility: hidden;
        }
        [role="treeitem"] > div:hover > * > .${FOLDER_BTN_CLASS},
        [role="treeitem"] > div:focus-within > * > .${FOLDER_BTN_CLASS},
        .${FOLDER_BTN_CLASS}[data-busy] { visibility: visible; }
        .${FOLDER_BTN_CLASS}:hover { color: var(--fgColor-default, #1f2328); }
      `
      document.head.appendChild(style)
    }
    for (const li of document.querySelectorAll('[role="treeitem"][aria-expanded]')) {
      const content = li.querySelector(':scope > div > [class*="TreeView-item-content"], :scope > div > .PRIVATE_TreeView-item-content')
      if (!content) continue
      const existing = content.querySelector(`:scope > .${FOLDER_BTN_CLASS}`)
      if (existing?.dataset.mode === mode) continue
      existing?.remove()
      const folder = li.id
      if (!folder) continue
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = FOLDER_BTN_CLASS
      btn.dataset.mode = mode
      btn.textContent = label
      btn.title = mode === 'view' ? `Mark every file in ${folder}/ as viewed` : `Collapse every file in ${folder}/`
      // Keep the tree from toggling / navigating when the button is used.
      for (const type of ['mousedown', 'pointerdown', 'keydown'])
        btn.addEventListener(type, e => e.stopPropagation())
      btn.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        const prefix = `${folder}/`
        const targets = new Set(
          [...li.querySelectorAll('[role="treeitem"]:not([aria-expanded])')].map(f => f.id).filter(id => id.startsWith(prefix)),
        )
        // A collapsed subfolder hides its files from the tree, so we can't know when we're done early.
        const complete = !li.querySelector('[role="treeitem"][aria-expanded="false"]') && targets.size > 0
        btn.dataset.busy = ''
        const common = {
          targets: complete ? targets : null,
          setLabel: t => t && (btn.textContent = t),
          doneLabel: label,
        }
        const job = mode === 'view'
          ? markAll({ ...common, match: (_, path) => path.startsWith(prefix) })
          : collapseAll({ ...common, prefix })
        job.finally(() => delete btn.dataset.busy)
      })
      content.appendChild(btn)
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
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { ensureFolderButtons(); autoSweep() }, 500) }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })

  GM_registerMenuCommand('Mark test files as viewed (scroll whole page)', run)

  // GitHub is an SPA: re-check on navigation.
  ensureButton()
  schedule()
  document.addEventListener('turbo:load', () => { ensureButton(); schedule() })
  window.addEventListener('popstate', ensureButton)
  setInterval(() => { ensureButton(); ensureFolderButtons() }, 1000)
})()

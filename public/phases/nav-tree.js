// The side menu as a tree: groups open and close, stay how you left them, and the group of the current page opens by itself.
(function () {
  'use strict'
  const KEY = 'tp_nav_open'
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch (_) { return null } }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(groups().filter(g => g.classList.contains('open')).map(g => g.dataset.group))) } catch (_) {} }
  const groups = () => [...document.querySelectorAll('.sidebar .nav-group')]

  function set(g, open) {
    g.classList.toggle('open', open)
    g.querySelector('.nav-group-head').setAttribute('aria-expanded', String(open))
  }
  window.toggleNavGroup = head => { const g = head.closest('.nav-group'); set(g, !g.classList.contains('open')); save() }
  // called by nav(): make sure the chosen page can be seen in the tree
  window.revealNavItem = item => { const g = item && item.closest('.nav-group'); if (g && !g.classList.contains('open')) { set(g, true); save() } }

  const opened = load() || ['sales']          // first visit: Sales open, the rest closed
  groups().forEach(g => set(g, opened.includes(g.dataset.group) || !!g.querySelector('.nav-item.active')))
})()

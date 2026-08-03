/*
 * danielsolves.ai reusable navigation web-component
 *
 * Vanilla JS, single self-contained script. Loaded via:
 *   <script src="site-nav.js"></script>
 *
 * Renders the site navigation into every <site-nav></site-nav> placeholder.
 * The injected markup mirrors the canonical <nav> structure from index.html
 * (brand, nav-links, Portfolio dropdown, Book-a-call CTA, language switch).
 *
 * Page context:
 *   - On the homepage (/ or /index.html) section links are bare anchors (#work).
 *   - On subpages they are prefixed (index.html#work) so they still resolve.
 *   - The Portfolio link is marked .active on subpages, matching prior behavior.
 *
 * Optional attributes on the placeholder, all opt-in. With none of them set the
 * generated markup is byte-identical to what the case-study pages have always
 * rendered, so adding them cannot regress an existing page:
 *
 *   base="https://danielsolves.ai/"
 *     Absolute prefix for every generated link. Needed once the nav is embedded
 *     on a different origin (ngl.danielsolves.ai), where "portfolio.html" would
 *     resolve against the wrong host and dead-end.
 *   active="portfolio"
 *     Names the link to mark as current instead of guessing from the filename.
 *     A foreign origin has its own paths, so the filename heuristic has nothing
 *     useful to work with there.
 *   lang-switch="off"
 *     Drops the DE/EN control. It flips window.i18n, which only exists on the
 *     main site, so an embedding page that ships no dictionary would otherwise
 *     offer a button that does nothing.
 *
 * The host gets `display: contents` so the injected <nav> behaves as a direct
 * body child, keeping `position: sticky` working. The language switch is wired
 * via a single delegated document-level click listener so it is robust no
 * matter when the nav is injected.
 *
 * Self-contained on purpose: the case-study pages load neither shared-ui.css nor
 * interactions.js, so the skip link, the burger and the mobile panel — markup,
 * styles and toggle logic — all have to ship from here. index.html and
 * portfolio.html render their own navigation and never load this file, so there
 * is no duplicate-markup risk.
 */
(function () {
  'use strict';

  function injectStyle() {
    if (document.getElementById('__site-nav-style')) return;
    var css = '' +
      'site-nav { display: contents; }' +
      'nav {' +
      ' position: sticky; top: 0; z-index: 50;' +
      ' backdrop-filter: blur(14px);' +
      ' background: oklch(from var(--bg) l c h / 0.6);' +
      ' border-bottom: 1px solid var(--line);' +
      ' }' +
      '.nav-inner { display: flex; align-items: center; justify-content: space-between; height: 68px; }' +
      '.brand { display: flex; align-items: center; gap: 11px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); text-decoration: none; }' +
      '.brand .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 14px var(--glow); }' +
      '.nav-links { display: flex; gap: 30px; align-items: center; }' +
      '.nav-links a { font-family: var(--mono); font-size: 13px; color: var(--muted); text-decoration: none; transition: color 0.2s; }' +
      '.nav-links a:hover { color: var(--text); }' +
      '.nav-links a.active { color: var(--accent); }' +
      '.nav-cta {' +
      ' font-family: var(--mono); font-size: 13px; padding: 9px 18px; border-radius: 999px;' +
      ' border: 1px solid var(--line-strong); color: var(--text); text-decoration: none;' +
      ' transition: border-color 0.2s, box-shadow 0.2s, color 0.2s;' +
      ' }' +
      '.nav-cta:hover { border-color: var(--accent); box-shadow: 0 0 20px var(--glow); }' +
      '.lang-switch { display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; padding-left: 18px; border-left: 1px solid var(--line); }' +
      '.lang-btn { background: none; border: none; padding: 0; font-family: var(--mono); font-size: 12px; color: var(--muted); cursor: pointer; letter-spacing: 0.04em; transition: color 0.18s; }' +
      '.lang-btn:hover { color: var(--text); }' +
      '.lang-btn.active { color: var(--accent); }' +
      '.lang-sep { color: var(--faint); font-family: var(--mono); font-size: 12px; }' +
      '.nav-dd { position: relative; display: inline-flex; align-items: center; }' +
      '.nav-dd-menu { position: absolute; top: 100%; left: 0; margin-top: 14px; min-width: 250px; display: flex; flex-direction: column; gap: 2px; padding: 8px; background: oklch(from var(--bg) calc(l + 0.05) c h); border: 1px solid var(--line-strong); border-radius: 14px; box-shadow: 0 18px 50px oklch(0 0 0 / 0.45); opacity: 0; visibility: hidden; transform: translateY(-6px); transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s; z-index: 60; }' +
      '.nav-dd:hover .nav-dd-menu, .nav-dd:focus-within .nav-dd-menu { opacity: 1; visibility: visible; transform: translateY(0); }' +
      '.nav-dd-menu::before { content: ""; position: absolute; left: 0; right: 0; top: -14px; height: 14px; }' +
      '.nav-dd-menu a { font-family: var(--sans); font-size: 13.5px; color: var(--muted); text-decoration: none; padding: 9px 12px; border-radius: 9px; white-space: nowrap; transition: background 0.15s, color 0.15s; }' +
      '.nav-dd-menu a:hover { background: var(--surface); color: var(--text); }' +
      '.nav-dd-menu .nav-dd-all { color: var(--accent); font-family: var(--mono); font-size: 12px; letter-spacing: 0.02em; border-top: 1px solid var(--line); margin-top: 4px; padding-top: 11px; }' +
      // Skip link: the case-study pages get theirs from here, matching the rule
      // shared-ui.css applies on index.html and portfolio.html.
      '.skip-link {' +
      ' position: absolute; left: 12px; top: -100px; z-index: 100;' +
      ' background: var(--accent); color: var(--on-accent);' +
      ' font-family: var(--mono); font-size: 13px; font-weight: 600;' +
      ' padding: 12px 20px; border-radius: var(--r-control); text-decoration: none;' +
      ' }' +
      '.skip-link:focus { top: 12px; }' +
      '.nav-burger {' +
      ' display: none; background: none; border: 1px solid var(--line-strong); border-radius: 10px;' +
      ' width: 40px; height: 40px; cursor: pointer; padding: 0;' +
      ' align-items: center; justify-content: center; flex-direction: column; gap: 4px;' +
      ' }' +
      '.nav-burger span { display: block; width: 16px; height: 1.5px; background: var(--text); border-radius: 2px; transition: transform 0.3s, opacity 0.2s; }' +
      '.nav-burger[aria-expanded="true"] span:nth-child(1) { transform: translateY(5.5px) rotate(45deg); }' +
      '.nav-burger[aria-expanded="true"] span:nth-child(2) { opacity: 0; }' +
      '.nav-burger[aria-expanded="true"] span:nth-child(3) { transform: translateY(-5.5px) rotate(-45deg); }' +
      '.nav-panel {' +
      ' position: fixed; inset: 68px 0 0; z-index: 49;' +
      ' background: oklch(from var(--bg) l c h / 0.98); backdrop-filter: blur(20px);' +
      ' padding: 28px 32px max(48px, env(safe-area-inset-bottom)); overflow-y: auto;' +
      ' overscroll-behavior: contain;' +
      ' }' +
      '.nav-panel[hidden] { display: none; }' +
      '.nav-panel a {' +
      ' display: block; font-size: 26px; font-weight: 600; letter-spacing: -0.02em;' +
      ' color: var(--text); text-decoration: none; padding: 16px 0;' +
      ' border-bottom: 1px solid var(--line);' +
      ' animation: siteNavPanelIn 0.45s backwards;' +
      ' }' +
      '.nav-panel a .k { font-family: var(--mono); font-size: 12px; color: var(--accent); display: block; margin-bottom: 4px; letter-spacing: 0.1em; }' +
      '@keyframes siteNavPanelIn { from { opacity: 0; transform: translateY(14px); } }' +
      '@media (prefers-reduced-motion: reduce) {' +
      ' .nav-panel a { animation: none; }' +
      ' .nav-burger span { transition: none; }' +
      ' }' +
      '@media (max-width: 900px) {' +
      ' .nav-links { display: none; }' +
      ' .nav-burger { display: inline-flex; }' +
      ' .nav-right { display: flex; align-items: center; gap: 10px; }' +
      // The CTA does not fit beside burger and language switch and only repeats
      // item 07 of the panel. display:none, not opacity — opacity keeps
      // reserving the width and pushes the brand into a second line.
      ' .nav-cta { display: none; }' +
      ' .lang-switch { margin-left: 0; padding-left: 0; border-left: none; }' +
      ' }';
    var s = document.createElement('style');
    s.id = '__site-nav-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // Homepage = "/" or "/index.html"; subpages get an index.html prefix on
  // section anchors so the in-page links still resolve from elsewhere.
  function isHomepage() {
    return /(?:^|\/)(?:index\.html)?$/.test(location.pathname);
  }

  function anchorBase() {
    return isHomepage() ? '' : 'index.html';
  }

  function readOptions(host) {
    var base = host.getAttribute('base') || '';
    // A base without a trailing slash would glue straight onto the filename and
    // produce ".../danielsolves.aiportfolio.html", so normalize once here rather
    // than trusting every author to remember the slash.
    if (base && base.charAt(base.length - 1) !== '/') base += '/';
    return {
      base: base,
      // Without an explicit name, keep the historical guess: the homepage marks
      // nothing, every other page of the main site marks Portfolio. A base means
      // the nav lives on a foreign origin whose paths say nothing about which
      // page of danielsolves.ai is showing, so guessing there would be wrong.
      active: host.getAttribute('active') || (base || isHomepage() ? '' : 'portfolio'),
      langSwitch: host.getAttribute('lang-switch') !== 'off'
    };
  }

  // Section links point at the homepage, which is a real document only once the
  // base is absolute: from a foreign origin a bare "#work" would scroll the
  // embedding page instead of leaving it.
  function sectionHref(opts, hash) {
    return opts.base ? opts.base + 'index.html' + hash : anchorBase() + hash;
  }

  function pageHref(opts, file) {
    return opts.base + file;
  }

  function activeAttr(opts, key) {
    return opts.active === key ? ' class="active"' : '';
  }

  function buildMarkup(opts) {
    // The dropdown is a plain list of links revealed on hover/focus, not a
    // composite widget: no role="menu"/"menuitem", which would promise arrow-key
    // navigation this does not implement.
    return '' +
      '<div class="wrap nav-inner">' +
      '<a class="brand" href="' + pageHref(opts, 'index.html') + '"><span class="dot"></span> Daniel F.</a>' +
      '<div class="nav-links">' +
      '<a href="' + sectionHref(opts, '#work') + '"' + activeAttr(opts, 'work') + ' data-i18n="nav.work">Work</a>' +
      '<div class="nav-dd">' +
      '<a href="' + pageHref(opts, 'portfolio.html') + '"' + activeAttr(opts, 'portfolio') + ' data-i18n="nav.portfolio">Portfolio</a>' +
      '<div class="nav-dd-menu">' +
      // First because it is the newest, and because it is the only one a visitor can
      // walk into and operate rather than read about.
      '<a href="' + pageHref(opts, 'nothing-gets-lost.html') + '"' + activeAttr(opts, 'nothing-gets-lost') + ' data-i18n="work.project5.title">Nothing Gets Lost</a>' +
      '<a href="' + pageHref(opts, 'mcp-servers.html') + '"' + activeAttr(opts, 'mcp-servers') + ' data-i18n="work.project3.title">Production MCP Servers</a>' +
      '<a href="' + pageHref(opts, 'data-pipeline.html') + '"' + activeAttr(opts, 'data-pipeline') + ' data-i18n="work.project1.title">AI-Powered Data Pipeline</a>' +
      '<a href="' + pageHref(opts, 'sgr-app.html') + '"' + activeAttr(opts, 'sgr-app') + ' data-i18n="portfolio.project4.title">SGR App — Sports Club Platform</a>' +
      '<a href="' + pageHref(opts, 'portfolio.html') + '" class="nav-dd-all" data-i18n="work.seeAll">See all case studies →</a>' +
      '</div>' +
      '</div>' +
      '<a href="' + sectionHref(opts, '#mcp-demo') + '"' + activeAttr(opts, 'demo') + ' data-i18n="nav.demo">Demo</a>' +
      '<a href="' + sectionHref(opts, '#deliver') + '"' + activeAttr(opts, 'deliver') + ' data-i18n="nav.deliver">Deliver</a>' +
      '<a href="' + sectionHref(opts, '#about') + '"' + activeAttr(opts, 'about') + ' data-i18n="nav.about">About</a>' +
      '<a href="' + sectionHref(opts, '#process') + '"' + activeAttr(opts, 'process') + ' data-i18n="nav.process">Process</a>' +
      '</div>' +
      '<div class="nav-right">' +
      '<a href="' + sectionHref(opts, '#contact') + '" class="nav-cta" data-i18n="nav.cta">Book a call</a>' +
      (opts.langSwitch ?
        '<div class="lang-switch" role="group" aria-label="Language" data-i18n-attr="aria-label:a11y.langLabel">' +
        '<button type="button" class="lang-btn" data-lang="de" data-i18n="lang.switch.de" data-i18n-attr="title:lang.switch.tooltipDe" title="Deutsche Version">DE</button>' +
        '<span class="lang-sep" aria-hidden="true">·</span>' +
        '<button type="button" class="lang-btn" data-lang="en" data-i18n="lang.switch.en" data-i18n-attr="title:lang.switch.tooltipEn" title="English version">EN</button>' +
        '</div>' : '') +
      '<button type="button" class="nav-burger" data-nav-toggle aria-expanded="false" aria-controls="siteNavPanel" aria-label="Menu" data-i18n-attr="aria-label:a11y.menuLabel">' +
      '<span></span><span></span><span></span>' +
      '</button>' +
      '</div>' +
      '</div>';
  }

  function buildPanelMarkup(opts) {
    return '' +
      '<a href="' + sectionHref(opts, '#work') + '"><span class="k">01</span><span data-i18n="nav.work">Work</span></a>' +
      '<a href="' + sectionHref(opts, '#mcp-demo') + '"><span class="k">02</span><span data-i18n="nav.demo">Demo</span></a>' +
      '<a href="' + pageHref(opts, 'portfolio.html') + '"><span class="k">03</span><span data-i18n="nav.portfolio">Portfolio</span></a>' +
      '<a href="' + sectionHref(opts, '#deliver') + '"><span class="k">04</span><span data-i18n="nav.deliver">Deliver</span></a>' +
      '<a href="' + sectionHref(opts, '#about') + '"><span class="k">05</span><span data-i18n="nav.about">About</span></a>' +
      '<a href="' + sectionHref(opts, '#process') + '"><span class="k">06</span><span data-i18n="nav.process">Process</span></a>' +
      '<a href="' + sectionHref(opts, '#contact') + '"><span class="k">07</span><span data-i18n="nav.cta">Book a call</span></a>';
  }

  function markActiveLang(scope) {
    var lang = (window.i18n && window.i18n.lang) || 'en';
    var buttons = scope.querySelectorAll('.lang-btn[data-lang]');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-lang') === lang;
      buttons[i].classList.toggle('active', on);
      if (on) buttons[i].setAttribute('aria-current', 'true');
      else buttons[i].removeAttribute('aria-current');
    }
  }

  // The panel needs the same treatment interactions.js gives index.html: hide the
  // background from the tab order rather than leaving a screenful of invisible
  // focus stops behind the overlay.
  function wireMobileNav(host) {
    var toggle = host.querySelector('[data-nav-toggle]');
    var panel = host.querySelector('[data-nav-panel]');
    if (!toggle || !panel) return;

    function background() {
      return [].slice.call(document.querySelectorAll('.nav-inner, #main, footer'));
    }

    function isOpen() {
      return toggle.getAttribute('aria-expanded') === 'true';
    }

    function close() {
      toggle.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
      document.body.style.overflow = '';
      background().forEach(function (el) { el.removeAttribute('inert'); });
      toggle.focus();          // otherwise focus falls back to <body>
    }

    toggle.addEventListener('click', function () {
      if (isOpen()) { close(); return; }
      toggle.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      document.body.style.overflow = 'hidden';
      background().forEach(function (el) { el.setAttribute('inert', ''); });
      var first = panel.querySelector('a');
      if (first) first.focus();
    });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900 && isOpen()) close();
    });
  }

  function renderInto(host) {
    if (host.dataset.siteNavRendered) return;
    var opts = readOptions(host);
    // The skip link stays relative on purpose: it targets #main in the current
    // document, which is exactly what a keyboard user needs, base or not.
    host.innerHTML =
      (document.querySelector('.skip-link') ? '' :
        '<a class="skip-link" href="#main" data-i18n="a11y.skip">Skip to content</a>') +
      '<nav>' + buildMarkup(opts) + '</nav>' +
      '<div class="nav-panel" id="siteNavPanel" data-nav-panel role="dialog" aria-modal="true"' +
      ' aria-label="Menu" data-i18n-attr="aria-label:a11y.menuLabel" hidden>' +
      buildPanelMarkup(opts) +
      '</div>';
    host.dataset.siteNavRendered = '1';

    // Mark the active language button. aria-current carries the state for
    // assistive tech; the class only drives the accent colour.
    markActiveLang(host);
    wireMobileNav(host);

    // Localize the freshly injected markup, now and again once the dict loads.
    if (window.i18n && typeof window.i18n.apply === 'function') {
      window.i18n.apply(host);
      if (window.i18n.ready && typeof window.i18n.ready.then === 'function') {
        window.i18n.ready.then(function () {
          window.i18n.apply(host);
        });
      }
    }
  }

  function render() {
    injectStyle();
    var hosts = document.querySelectorAll('site-nav');
    for (var i = 0; i < hosts.length; i++) {
      renderInto(hosts[i]);
    }
  }

  // Wire the language switch via a single delegated document-level listener so
  // it works no matter when the nav is injected.
  function wireLangSwitch() {
    if (document.documentElement.dataset.siteNavLangWired) return;
    document.documentElement.dataset.siteNavLangWired = '1';
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.lang-btn[data-lang]');
      if (b && window.i18n && window.i18n.setLang) {
        window.i18n.setLang(b.getAttribute('data-lang'));
        markActiveLang(document);
      }
    });
  }

  function start() {
    wireLangSwitch();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

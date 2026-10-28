/* 光隅 · LUMIÈRE — public site interactions */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pad = (n) => String(n).padStart(2, "0");
  const EASE = "cubic-bezier(.22,1,.36,1)";

  const app = $("#app");
  const siteNav = $("#siteNav");
  const siteFooter = $("#siteFooter");
  const menuOverlay = $("#menuOverlay");
  const menuTrigger = $("#menuTrigger");
  const lightbox = $("#lightbox");

  const state = {
    data: null,
    route: null,
    activeSub: "all",
    previousFocus: null,
    menuOpen: false,
    toastTimer: 0,
    lightbox: {
      open: false,
      photos: [],
      index: 0,
      categoryNames: {},
      lastFocus: null,
      hintTimer: 0,
      busy: false,
      scale: 1,
      tx: 0,
      ty: 0,
      pointers: new Map(),
      startX: 0,
      startY: 0,
      startTx: 0,
      startTy: 0,
      moved: false,
      pinchStartDist: 0,
      pinchStartScale: 1,
      lastTap: 0,
      lastTapX: 0,
      lastTapY: 0,
      token: 0,
    },
  };

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */
  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escAttr(value) {
    return esc(value).replace(/`/g, "&#96;");
  }

  function safeColor(value) {
    return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "")) ? value : "#d8d0c2";
  }

  function safeLqip(value) {
    const s = String(value || "");
    return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s) ? s : "";
  }

  function categoryBySlug(slug) {
    return (state.data?.categories || []).find((c) => c.slug === slug) || null;
  }

  function allCategoryNames() {
    const map = {};
    (state.data?.categories || []).forEach((c) => { map[c.slug] = c.name; });
    return map;
  }

  function splitTagline(tagline) {
    const text = String(tagline || "光，会记得。").trim();
    const match = text.match(/^(.+?[，,。！!？?])(.*)$/);
    if (match && match[2] && match[1].length < text.length) return [match[1], match[2].trim()];
    if (text.length > 12) {
      const mid = Math.ceil(text.length / 2);
      return [text.slice(0, mid), text.slice(mid)];
    }
    return [text];
  }

  function photoAlt(photo, fallback) {
    return (photo.title || photo.caption || fallback || "影像作品").replace(/\s+/g, " ").slice(0, 180);
  }

  function subline(photo) {
    return [photo.location, photo.date].filter(Boolean).join(" · ");
  }

  function imgFadeAttrs() {
    return 'data-fade';
  }

  function showToast(message, duration = 2600) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
  }

  async function copyText(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("微信号已复制，去微信添加吧");
    } catch (err) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); showToast("微信号已复制，去微信添加吧"); }
      catch (e) { showToast("复制失败，请长按选中微信号"); }
      ta.remove();
    }
  }

  function setMetaDescription(text) {
    const meta = document.querySelector('meta[name="description"]');
    if (meta && text) meta.setAttribute("content", text.slice(0, 180));
  }

  function isLocalOrLanAccess() {
    const host = (location.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (!host.includes(".")) return true;
    if (host.endsWith(".local")) return true;
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  }

  /* ------------------------------------------------------------------ */
  /* Boot + data                                                         */
  /* ------------------------------------------------------------------ */
  async function boot() {
    history.scrollRestoration = "manual";
    bindGlobalEvents();
    try {
      let payload;
      if (window.__LUMIERE_STATIC__) {
        payload = window.__LUMIERE_STATIC__;
      } else {
        const res = await fetch("/api/public/site", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        payload = await res.json();
      }
      if (!payload.ok) throw new Error(payload.error || "加载失败");
      state.data = payload;
      state.lightbox.categoryNames = allCategoryNames();
      document.documentElement.dataset.accent = payload.site.accent || "gold";
      renderChrome();
      renderRoute();
      requestAnimationFrame(() => {
        window.setTimeout(() => $("#boot")?.classList.add("is-done"), 180);
      });
    } catch (err) {
      console.error(err);
      $("#boot")?.classList.add("is-done");
      app.innerHTML = `
        <div class="page-error">
          <p class="micro">CONNECTION LOST</p>
          <h2>网站数据暂时没有加载出来</h2>
          <p>请刷新页面；如果仍未加载，请确认发布文件完整。</p>
          <button class="btn btn-dark" type="button" data-reload><span>重新加载</span><span class="btn-arrow">↻</span></button>
        </div>`;
      app.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
    }
  }

  function parseRoute(pathname = location.pathname) {
    const match = pathname.match(/^\/1\/g\/([^/]+)\/?$/);
    if (match) return { name: "category", slug: decodeURIComponent(match[1]) };
    return { name: "home" };
  }

  /* ------------------------------------------------------------------ */
  /* Header, nav, footer, menu                                           */
  /* ------------------------------------------------------------------ */
  function renderChrome() {
    const site = state.data.site;
    const brand = $("#navBrand");
    const brandEn = $("#navBrandEn");
    const menuBrand = $("#menuBrand");
    if (brand) brand.textContent = site.brand || "诗意的摄影小院";
    if (brandEn) brandEn.textContent = site.brand_en || "POETIC YARD";
    if (menuBrand) menuBrand.textContent = site.brand || "诗意的摄影小院";
    if (!isLocalOrLanAccess()) $(".menu-admin")?.remove();
    document.title = `${site.brand || "诗意的摄影小院"} · ${site.tagline || "私人影像档案"}`;

    const navIndex = $("#navIndex");
    navIndex.innerHTML = (state.data.categories || []).slice(0, 5).map((cat, i) => `
      <a href="/1/g/${escAttr(cat.slug)}" data-nav="/1/g/${escAttr(cat.slug)}" data-category-link="${escAttr(cat.slug)}">
        ${esc(cat.name)}<span class="nav-count">${pad(cat.count)}</span>
      </a>`).join("");

    const menuLinks = $("#menuLinks");
    const menuItems = [
      { href: "/1/", name: "首页", en: "HOME", count: state.data.stats.photos, slug: "__home__", home: true },
      ...(state.data.categories || []).map((cat, i) => ({
        href: `/1/g/${cat.slug}`, name: cat.name, en: cat.name_en, count: cat.count, slug: cat.slug, no: pad(i + 1),
      })),
    ];
    menuLinks.innerHTML = menuItems.map((item, i) => `
      <a class="menu-link ${item.home ? "is-home" : ""} ${item.name.length > 4 ? "is-long" : ""}" href="${escAttr(item.href)}" data-nav="${escAttr(item.href)}"
         data-preview="${escAttr(item.slug)}">
        <span class="menu-no">${item.home ? "—" : item.no}</span>
        <span class="menu-link-main"><span class="menu-link-cn">${esc(item.name)}</span><span class="menu-link-en">${esc(item.en || "")}</span></span>
        <span class="menu-link-count">${pad(item.count || 0)}</span>
        <span class="menu-link-arrow" aria-hidden="true">↗</span>
      </a>`).join("");

    const previewData = menuItems.map((item) => {
      if (item.home) return { slug: "__home__", src: state.data.hero?.view || "" };
      const cat = categoryBySlug(item.slug);
      return { slug: item.slug, src: cat?.cover?.view || "" };
    }).filter((x) => x.src);
    const preview = $("#menuPreview");
    preview.innerHTML = previewData.map((item, i) => `
      <img src="${escAttr(item.src)}" alt="" data-preview-img="${escAttr(item.slug)}" class="${i === 0 ? "is-active" : ""}" loading="lazy" decoding="async">
    `).join("");
    if (!previewData.length) preview.hidden = true;

    renderMenuContact();
    bindMenuPreview();
  }

  function renderMenuContact() {
    const site = state.data.site;
    const contact = site.contact || {};
    const box = $("#menuContact");
    if (!site.show_contact) {
      box.innerHTML = `<span>预约通道暂未开放</span>`;
      return;
    }
    const parts = [];
    if (contact.wechat) parts.push(`<button type="button" data-copy="${escAttr(contact.wechat)}">微信 ${esc(contact.wechat)}</button>`);
    if (contact.phone) parts.push(`<a href="tel:${escAttr(contact.phone.replace(/\s+/g, ""))}">${esc(contact.phone)}</a>`);
    if (contact.email) parts.push(`<a href="mailto:${escAttr(contact.email)}">${esc(contact.email)}</a>`);
    box.innerHTML = parts.length ? parts.join("") : `<span>欢迎在后台补充联系方式</span>`;
  }

  function bindMenuPreview() {
    const preview = $("#menuPreview");
    if (!preview) return;
    const activate = (slug) => {
      $$("[data-preview-img]", preview).forEach((img) => {
        img.classList.toggle("is-active", img.dataset.previewImg === slug);
      });
    };
    $$("[data-preview]").forEach((link) => {
      link.addEventListener("pointerenter", () => activate(link.dataset.preview));
      link.addEventListener("focus", () => activate(link.dataset.preview));
    });
    const first = $("[data-preview-img]", preview);
    if (first) activate(first.dataset.previewImg);
  }

  function updateNavState() {
    const hasHero = !!document.querySelector(".hero, .cat-hero");
    const solid = !hasHero || window.scrollY > 34;
    siteNav.classList.toggle("is-solid", solid);
  }

  function renderFooter() {
    if (!state.data) return;
    const site = state.data.site;
    const year = new Date().getFullYear();
    siteFooter.innerHTML = `
      <div class="footer-top">
        <div class="footer-brand">${esc(site.brand)}<em>${esc(site.brand_en)}</em></div>
        <p class="footer-note">${esc(site.footer_note || "影像，是时间写给我们的信。")}</p>
      </div>
      <div class="footer-giant" aria-hidden="true">${esc((site.brand_en || "POETIC YARD").toUpperCase())}</div>
      <div class="footer-bottom">
        <p class="micro">© ${year} ${esc(site.brand)} · ALL RIGHTS RESERVED</p>
        <div class="footer-links">
          ${isLocalOrLanAccess() ? `<a href="/admin">管理入口</a>` : ""}
          <button class="to-top" type="button" data-to-top>回到顶部 <span>↑</span></button>
        </div>
      </div>`;
  }

  function updateCurrentNav(route) {
    $$("[data-category-link]").forEach((link) => {
      const current = route.name === "category" && link.dataset.categoryLink === route.slug;
      link.classList.toggle("is-current", current);
      if (current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  /* ------------------------------------------------------------------ */
  /* Views                                                               */
  /* ------------------------------------------------------------------ */
  function renderRoute(options = {}) {
    if (!state.data) return;
    const route = parseRoute();
    state.route = route;
    const preserveScroll = options.preserveScroll === true;
    const y = window.scrollY;
    if (!preserveScroll) window.scrollTo(0, 0);

    closeMenu({ restoreFocus: false, silent: true });
    if (state.lightbox.open) closeLightbox({ instant: true, restoreFocus: false });

    if (route.name === "category") {
      const cat = categoryBySlug(route.slug);
      if (!cat) {
        app.innerHTML = renderNotFound();
        document.title = `没找到这一章 · ${state.data.site.brand}`;
      } else {
        const requestedSub = new URLSearchParams(location.search).get("sub") || "all";
        state.activeSub = requestedSub !== "all" && (cat.subcategories || []).some((s) => s.id === requestedSub)
          ? requestedSub
          : "all";
        app.innerHTML = renderCategory(cat);
        document.title = `${cat.name} · ${state.data.site.brand}`;
        setMetaDescription(cat.intro || cat.description);
      }
    } else {
      state.activeSub = "all";
      app.innerHTML = renderHome();
      document.title = `${state.data.site.brand} · ${state.data.site.tagline || "私人影像档案"}`;
      setMetaDescription(state.data.site.intro);
    }

    renderFooter();
    updateCurrentNav(route);
    updateNavState();
    requestAnimationFrame(() => {
      updateNavState();
      initReveals();
      initImageFades();
      initPageWidgets();
      if (preserveScroll) window.scrollTo(0, y);
    });
    closeMenu({ restoreFocus: false, silent: true });
  }

  function heroMarkup() {
    const { site, hero, categories } = state.data;
    const lines = splitTagline(site.tagline);
    const long = lines.some((l) => l.length > 8) || lines.length > 2;
    const categoryNames = categories.map((c) => c.name).join(" · ");
    const image = hero
      ? `<div class="hero-media">
           <img src="${escAttr(hero.full)}" alt="${escAttr(photoAlt(hero, site.brand))}" fetchpriority="high" decoding="async" ${imgFadeAttrs()}>
         </div>`
      : `<div class="hero-no-image"></div>`;
    return `
      <section class="hero" id="top">
        ${image}
        <div class="hero-content">
          <div class="hero-kicker">
            <span class="k-rule"></span>
            <span class="micro">${esc(site.kicker || "PRIVATE PHOTO ARCHIVE")}</span>
            <span class="k-index">${new Date().getFullYear()}</span>
          </div>
          <h1 class="hero-title ${long ? "is-long" : ""}">
            ${lines.map((line) => `<span class="line"><span>${esc(line)}</span></span>`).join("")}
          </h1>
          <div class="hero-underline"></div>
          <p class="hero-sub">${esc(categoryNames)}<br>把稍纵即逝的瞬间，留在光里。</p>
          <div class="hero-actions">
            <button class="btn btn-primary" type="button" data-scroll="#chapters">
              <span>探索作品</span><span class="btn-arrow" aria-hidden="true">↘</span>
            </button>
            ${site.show_contact ? `<button class="btn btn-glass" type="button" data-scroll="#contact"><span>预约咨询</span><span class="btn-arrow" aria-hidden="true">↗</span></button>` : ""}
          </div>
        </div>
        <div class="hero-side" aria-hidden="true">EVERY FLEETING MOMENT, KEPT IN LIGHT.</div>
        <div class="scroll-cue" aria-hidden="true">SCROLL <span></span></div>
        <div class="hero-count" aria-hidden="true">${pad(state.data.stats.photos)} FRAMES / ${new Date().getFullYear()}</div>
      </section>`;
  }

  function renderHome() {
    const { site, categories, featured } = state.data;
    const catCards = categories.map((cat, i) => categoryCard(cat, i));
    const left = catCards.filter((_, i) => i % 2 === 0).join("");
    const right = catCards.filter((_, i) => i % 2 === 1).join("");
    const quote = splitTextIntoLines(site.manifesto || "不制造完美，只收藏真实。");
    const portrait = categories.find((c) => c.slug === "portrait");
    const manifestoPhoto = portrait?.photos?.[1] || portrait?.cover || categories.find((c) => c.cover)?.cover || null;
    const cnNumbers = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
    const countCn = cnNumbers[categories.length] || String(categories.length);
    const countEn = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"][categories.length] || String(categories.length);
    const categoryEnglish = categories.map((c) => c.name_en || c.name).join(" / ");
    return `
      <article class="page page-home">
        ${heroMarkup()}

        <section class="statement" id="about">
          <div class="statement-left" data-reveal>
            <span class="statement-index">01</span>
            <div class="statement-meta">
              <p class="micro">THE ARCHIVE</p>
              <p style="margin-top:8px">影像档案<br>KEPT IN LIGHT</p>
            </div>
          </div>
          <div class="statement-right">
            <h2 class="display-quote" data-reveal>关于爱、<em>光</em>，<br>和正在发生的成长。</h2>
            <div class="statement-body">
              <p class="body-copy" data-reveal style="--delay:90ms">${esc(site.intro)}</p>
              <div class="scribble" data-reveal style="--delay:180ms">Life, quietly kept.<span class="line2">${esc(categoryEnglish)}</span></div>
            </div>
          </div>
        </section>

        <section class="chapters section" id="chapters">
          <div class="section-head">
            <div>
              <div class="label-row" data-reveal>
                <span class="label-rule"></span><p class="micro">02 / CHAPTERS</p>
              </div>
              <h2 class="section-title chapters-title-wrap" data-reveal style="margin-top:16px;--delay:80ms">
                ${countCn}个故事 <span class="en">${countEn} Chapters</span>
              </h2>
            </div>
            <p class="section-note" data-reveal style="--delay:150ms">每一种仪式，都值得被认真观看。<br>选择你想走进的那一章。</p>
          </div>
          <div class="category-grid">
            <div class="cat-col">${left}</div>
            <div class="cat-col cat-col-offset">${right}</div>
          </div>
          <div class="category-mobile-grid">
            ${catCards.join("")}
          </div>
        </section>

        ${featured.length ? renderFilmstrip(featured) : ""}

        <section class="manifesto">
          <div class="manifesto-copy">
            <div class="label-row" data-reveal><span class="label-rule"></span><p class="micro">03 / OUR WAY</p></div>
            <h2 class="display-quote" data-reveal style="--delay:80ms">${quote}</h2>
            <p class="body-copy" data-reveal style="--delay:150ms">${esc(site.intro)}</p>
            <div class="values" data-reveal style="--delay:210ms">
              <span>自然光</span><span>真实情绪</span><span>克制的修饰</span><span>可以看很久的照片</span>
            </div>
          </div>
          ${manifestoPhoto ? `
          <figure class="manifesto-figure" data-reveal="scale" style="--delay:120ms">
            <div class="print">
              <img src="${escAttr(manifestoPhoto.view)}" alt="${escAttr(photoAlt(manifestoPhoto, "肖像"))}" loading="lazy" decoding="async" ${imgFadeAttrs()}>
            </div>
            <figcaption><em>${esc(manifestoPhoto.title || "留住光")}</em><span>PORTRAIT / ${new Date().getFullYear()}</span></figcaption>
            <span class="figure-stamp">${esc([...site.brand][0] || "诗")}</span>
          </figure>` : ""}
        </section>

        <div class="marquee" aria-hidden="true">
          <div class="marquee-track">
            ${marqueeItems()}
          </div>
          <div class="marquee-track">
            ${marqueeItems()}
          </div>
        </div>

        ${renderContact(site)}
      </article>`;
  }

  function marqueeItems() {
    const words = (state.data.categories || []).map((c) => (c.name_en || c.name).toUpperCase());
    if (!words.length) words.push("PHOTOGRAPHY");
    return `<span>${words.join(' <i>◆</i> ')} <i>◆</i> LOVE, LIGHT &amp; TIME <i>◆</i> ${words.join(' <i>◆</i> ')} <i>◆</i></span>`;
  }

  function splitTextIntoLines(text) {
    const t = String(text || "").trim();
    const idx = t.search(/[，,]/);
    if (idx > 0 && idx < t.length - 1) {
      return `${esc(t.slice(0, idx + 1))}<br><em>${esc(t.slice(idx + 1).trim())}</em>`;
    }
    return esc(t);
  }

  function categoryCard(cat, index) {
    const ratio = index % 3 === 1 ? "tall" : "wide";
    const cover = cat.cover;
    const image = cover
      ? `<div class="cat-media" style="background-color:${safeColor(cover.color)};${safeLqip(cover.lqip) ? `background-image:url('${safeLqip(cover.lqip)}');background-size:cover;background-position:center;` : ""}">
           <img src="${escAttr(cover.view)}" alt="${escAttr(cat.name)} — ${escAttr(cat.description)}" loading="${index < 2 ? "eager" : "lazy"}" decoding="async" ${imgFadeAttrs()}>
         </div>`
      : `<div class="cat-fallback"></div>`;
    return `
      <a class="cat-card" href="/1/g/${escAttr(cat.slug)}" data-nav="/1/g/${escAttr(cat.slug)}" data-cat-card="${escAttr(cat.slug)}" data-ratio="${ratio}" data-reveal style="--delay:${(index % 2) * 90 + 40}ms">
        ${image}
        <div class="cat-top">
          <span class="pill"><span class="dot"></span> CHAPTER ${pad(index + 1)}</span>
          <span class="count">${pad(cat.count)} FRAMES</span>
        </div>
        <div class="cat-bottom">
          <p class="cat-en">${esc(cat.name_en)}</p>
          <div class="cat-name-row">
            <h3 class="cat-name">${esc(cat.name)}</h3>
            <span class="cat-arrow" aria-hidden="true">↗</span>
          </div>
          <p class="cat-desc">${esc(cat.description)}</p>
        </div>
        <span class="cat-hover-line" aria-hidden="true"></span>
      </a>`;
  }

  function renderFilmstrip(featured) {
    const items = featured.slice(0, 10);
    return `
      <section class="filmstrip-section">
        <div class="section-head">
          <div>
            <div class="label-row"><span class="label-rule"></span><p class="micro">SELECTED FRAMES</p></div>
            <h2 class="section-title" style="margin-top:14px">掠影 <span style="font-family:var(--display);font-style:italic;font-size:.55em;color:var(--accent-soft)">Selected</span></h2>
          </div>
          <div class="strip-actions">
            <button class="strip-btn" type="button" data-strip="-1" aria-label="向左浏览"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
            <button class="strip-btn" type="button" data-strip="1" aria-label="向右浏览"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
          </div>
        </div>
        <div class="filmstrip" id="filmstrip" tabindex="0" aria-label="精选影像，可横向滚动">
          ${items.map((photo, i) => `
            <button class="film-card" type="button" data-film-index="${i}" aria-label="浏览 ${escAttr(photo.title || "影像")}">
              <span class="film-photo" style="background-color:${safeColor(photo.color)};${safeLqip(photo.lqip) ? `background-image:url('${safeLqip(photo.lqip)}');background-size:cover;background-position:center;` : ""}">
                <img src="${escAttr(photo.thumb)}" alt="${escAttr(photoAlt(photo))}" loading="lazy" decoding="async" ${imgFadeAttrs()}>
                <span class="film-view" aria-hidden="true">↗</span>
              </span>
              <span class="film-meta">
                <span class="film-title">${esc(photo.title || "Untitled")}</span>
                <span class="film-cat">${esc(categoryName(photo.category))}</span>
              </span>
            </button>`).join("")}
        </div>
        <div class="strip-foot">
          <span class="micro">A SELECTION OF QUIET MOMENTS</span>
          <div class="strip-progress" aria-hidden="true"><span></span></div>
        </div>
      </section>`;
  }

  function categoryName(slug) {
    return state.lightbox.categoryNames?.[slug] || categoryBySlug(slug)?.name || "";
  }

  function renderCategory(cat) {
    const index = state.data.categories.findIndex((c) => c.slug === cat.slug);
    const cover = cat.cover;
    const photos = cat.photos || [];
    const next = state.data.categories[(index + 1) % state.data.categories.length];
    const subcats = cat.subcategories || [];
    if (state.activeSub !== "all" && !subcats.some((s) => s.id === state.activeSub)) {
      state.activeSub = "all";
    }
    const activeSub = state.activeSub;
    const visiblePhotos = activeSub === "all" ? photos : photos.filter((p) => p.subcategory_id === activeSub);
    const subCount = activeSub === "all" ? photos.length : visiblePhotos.length;
    const countLabel = `${activeSub === "all" ? "PORTFOLIO" : "SET"} / ${pad(subCount)} FRAMES`;
    const coverMarkup = cover
      ? `<div class="cat-hero-media" style="background-color:${safeColor(cover.color)}">
           <img src="${escAttr(cover.full)}" alt="${escAttr(cat.name)}系列封面" fetchpriority="high" decoding="async" ${imgFadeAttrs()}>
         </div>`
      : `<div class="cat-fallback"></div>`;
    const submenu = subcats.length && photos.length ? `
      <div class="submenu-block" data-submenu-block>
        <div class="submenu-label">
          <span class="label-rule"></span>
          <p class="micro">细分 / SETS</p>
        </div>
        <div class="submenu-bar" role="group" aria-label="${escAttr(cat.name)}子菜单">
          <button class="submenu-tab ${activeSub === "all" ? "is-active" : ""}" type="button" data-submenu="all" aria-pressed="${activeSub === "all"}">
            全部 <span>${pad(photos.length)}</span>
          </button>
          ${subcats.map((sub) => `
            <button class="submenu-tab ${activeSub === sub.id ? "is-active" : ""}" type="button" data-submenu="${escAttr(sub.id)}" aria-pressed="${activeSub === sub.id}">
              ${esc(sub.name)} <span>${pad(sub.count)}</span>
            </button>`).join("")}
        </div>
      </div>` : "";
    return `
      <article class="page page-category">
        <section class="cat-hero">
          ${coverMarkup}
          <div class="cat-hero-index" aria-hidden="true">${pad(index + 1)}</div>
          <div class="cat-hero-copy">
            <div class="cat-chapter">
              <span class="rule"></span>
              <span class="micro">CHAPTER ${pad(index + 1)} / ${esc(cat.name_en)}</span>
              <span class="cat-chapter-frames">${pad(photos.length)} FRAMES</span>
            </div>
            <h1>${esc(cat.name)}<em>${esc(cat.name_en)}</em></h1>
            <p class="cat-hero-desc">${esc(cat.description)}</p>
          </div>
          <div class="scroll-cue" aria-hidden="true">SCROLL <span></span></div>
        </section>

        <div class="cat-body">
          <div class="cat-back-line">
            <a class="back-link" href="/1/" data-nav="/1/">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
              返回全部系列
            </a>
            <span class="cat-body-meta">${esc(cat.name_en)} COLLECTION / ${new Date().getFullYear()}</span>
          </div>
          <div class="cat-intro">
            <div class="cat-intro-label">
              <span class="big">${pad(index + 1)}</span>
              <p class="small">${esc(cat.name_en)}<br>私人影像选集</p>
            </div>
            <p class="cat-intro-text">${esc(cat.intro || cat.description)}<span class="sig">— ${esc(state.data.site.brand)}</span></p>
          </div>

          ${submenu}
          <section class="gallery-section" aria-label="${escAttr(cat.name)}作品">
            <div class="gallery-head">
              <p class="micro" data-gallery-count>${countLabel}</p>
              <p class="micro" style="text-transform:none;letter-spacing:.04em">${esc(state.data.site.brand)} · 影像档案</p>
            </div>
            ${photos.length ? `<div class="photo-columns" data-photo-columns>${photos.map((photo, i) => photoCard(photo, i, activeSub)).join("")}</div>
              <div class="gallery-empty sub-empty" data-sub-empty ${visiblePhotos.length ? "hidden" : ""}>
                <span class="mark">诗</span>
                <h3>这个子菜单，还在等待第一张照片。</h3>
                <p>可以在「全部」中先看看其他影像。</p>
              </div>` : `
              <div class="gallery-empty">
                <span class="mark">诗</span>
                <h3>这一章，正在被写下来。</h3>
                <p>新的影像很快会出现在这里。请稍后再来看看。</p>
              </div>`}
          </section>
        </div>

        ${next && next.slug !== cat.slug ? renderNextChapter(next, index) : ""}
        ${renderContact(state.data.site, true)}
      </article>`;
  }

  function photoCard(photo, index, activeSub = "all") {
    const ratio = photo.aspect && photo.aspect > 0.2 && photo.aspect < 4 ? photo.aspect : 1;
    const lqip = safeLqip(photo.lqip);
    const style = `aspect-ratio:${ratio};background-color:${safeColor(photo.color)};${lqip ? `background-image:url('${lqip}');` : ""}`;
    const sub = subline(photo);
    const hidden = activeSub !== "all" && photo.subcategory_id !== activeSub;
    return `
      <button class="photo-card" type="button" data-photo-index="${index}" data-subcategory="${escAttr(photo.subcategory_id || "")}" aria-label="查看 ${escAttr(photo.title || "影像")}" ${hidden ? "hidden" : ""}>
        <span class="photo-frame" style="${style}">
          <img src="${escAttr(photo.thumb)}" alt="${escAttr(photoAlt(photo, "影像作品"))}" loading="lazy" decoding="async" ${imgFadeAttrs()}>
          <span class="photo-zoom" aria-hidden="true">↗</span>
        </span>
        <span class="photo-meta">
          <span>
            <span class="photo-title">${esc(photo.title || "未命名影像")}</span>
            ${sub ? `<span class="photo-sub">${esc(sub)}</span>` : ""}
          </span>
          <span class="photo-no">${pad(index + 1)}</span>
        </span>
      </button>`;
  }

  function renderNextChapter(next, currentIndex) {
    return `
      <div class="cat-end">
        <a class="next-chapter" href="/1/g/${escAttr(next.slug)}" data-nav="/1/g/${escAttr(next.slug)}" data-next-card>
          ${next.cover ? `<div class="next-bg"><img src="${escAttr(next.cover.view)}" alt="" loading="lazy" decoding="async" ${imgFadeAttrs()}></div>` : ""}
          <div class="next-inner">
            <div class="next-top">
              <span class="micro">NEXT CHAPTER</span>
              <span class="micro">${pad(currentIndex + 2)} / ${pad(state.data.categories.length)}</span>
            </div>
            <div>
              <p class="micro">继续浏览</p>
              <h2 class="next-title">${esc(next.name)}<em>${esc(next.name_en)}</em></h2>
            </div>
            <span class="next-arrow" aria-hidden="true">↗</span>
          </div>
        </a>
      </div>`;
  }

  function renderContact(site, compact = false) {
    if (!site.show_contact) return "";
    const contact = site.contact || {};
    const wechat = contact.wechat && `<button class="contact-row" type="button" data-copy="${escAttr(contact.wechat)}">
        <span class="label">WECHAT</span><span class="value"><span>${esc(contact.wechat)}</span><span class="copy-hint">点击复制</span></span>
      </button>`;
    const phone = contact.phone && `<a class="contact-row" href="tel:${escAttr(contact.phone.replace(/\s+/g, ""))}">
        <span class="label">PHONE</span><span class="value"><span>${esc(contact.phone)}</span><span class="copy-hint">拨号</span></span>
      </a>`;
    const email = contact.email && `<a class="contact-row" href="mailto:${escAttr(contact.email)}">
        <span class="label">EMAIL</span><span class="value"><span>${esc(contact.email)}</span><span class="copy-hint">写信</span></span>
      </a>`;
    const hero = state.data.hero;
    return `
      <section class="contact" id="contact">
        ${hero ? `<div class="contact-bg" style="background-image:url('${escAttr(hero.view)}')"></div>` : ""}
        <div class="contact-inner">
          <div>
            <div class="label-row" data-reveal><span class="label-rule"></span><p class="micro">04 / ENQUIRY</p></div>
            <h2 class="contact-title" data-reveal style="--delay:80ms">把此刻，<br><em>留给我们。</em></h2>
            <p class="contact-lede" data-reveal style="--delay:140ms">如果你也在寻找一种不喧哗、不复制、只属于你的影像表达，欢迎来聊聊。${compact ? "" : "一次好的拍摄，从一次认真的对话开始。"}</p>
            <div class="contact-actions" data-reveal style="--delay:200ms">
              ${wechat ? `<button class="btn btn-primary" type="button" data-copy="${escAttr(contact.wechat)}"><span>复制微信号</span><span class="btn-arrow" aria-hidden="true">↗</span></button>` : ""}
              ${phone ? `<a class="btn btn-glass" href="tel:${escAttr(contact.phone.replace(/\s+/g, ""))}"><span>直接致电</span><span class="btn-arrow" aria-hidden="true">↙</span></a>` : ""}
            </div>
          </div>
          <div class="contact-panel" data-reveal="scale" style="--delay:160ms">
            <div class="contact-panel-head">
              <p class="micro">预约与咨询</p><span class="live-dot" aria-hidden="true"></span>
            </div>
            <div class="contact-rows">
              ${wechat || phone || email ? [wechat, phone, email].filter(Boolean).join("") : `<p class="contact-panel-empty">联系方式正在整理中。<br>欢迎稍后再来。</p>`}
            </div>
            ${contact.note ? `<p class="contact-note">${esc(contact.note)}</p>` : ""}
          </div>
        </div>
      </section>`;
  }

  function renderNotFound() {
    return `
      <div class="notfound">
        <p class="micro">CHAPTER NOT FOUND</p>
        <div class="code">404</div>
        <h1>这一章，还没有被写下。</h1>
        <p>你访问的页面不存在，或已经被重新排列。</p>
        <a class="btn btn-dark" href="/1/" data-nav="/1/"><span>回到首页</span><span class="btn-arrow" aria-hidden="true">↖</span></a>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Page-level interactive bits                                         */
  /* ------------------------------------------------------------------ */
  let revealObserver = null;
  function initReveals() {
    if (revealObserver) revealObserver.disconnect();
    const nodes = $$("[data-reveal]");
    if (!nodes.length) return;
    if (reduceMotion) {
      nodes.forEach((n) => n.classList.add("in-view"));
      return;
    }
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -7% 0px", threshold: 0.06 });
    nodes.forEach((n) => revealObserver.observe(n));
  }

  function initImageFades() {
    $$("img[data-fade]").forEach((img) => {
      const done = () => img.classList.add("is-loaded");
      if (img.complete && img.naturalWidth) done();
      else {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", () => {
          img.classList.add("is-loaded");
          img.style.opacity = "0";
          const frame = img.closest(".photo-frame, .film-photo, .cat-media, .manifesto-figure");
          if (frame) frame.classList.add("image-error");
        }, { once: true });
      }
    });
  }

  function initPageWidgets() {
    const homeHero = $(".hero");
    if (homeHero && !reduceMotion) {
      requestAnimationFrame(() => homeHero.classList.add("is-ready"));
    } else if (homeHero) {
      homeHero.classList.add("is-ready");
    }
    initFilmstrip();
    initCategorySubmenu();
    $$("[data-reveal]").forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        window.setTimeout(() => el.classList.add("in-view"), 60);
      }
    });
  }

  function initCategorySubmenu() {
    const block = $("[data-submenu-block]");
    if (!block) return;
    const buttons = $$(".submenu-tab", block);
    const cards = $$(".photo-card[data-subcategory]");
    const countEl = $("[data-gallery-count]");
    const emptyEl = $("[data-sub-empty]");
    const apply = (subId, updateUrl, scrollActive = false) => {
      if (subId !== "all" && !buttons.some((b) => b.dataset.submenu === subId)) return;
      state.activeSub = subId;
      buttons.forEach((btn) => {
        const active = btn.dataset.submenu === subId;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
      let visible = 0;
      cards.forEach((card) => {
        const show = subId === "all" || card.dataset.subcategory === subId;
        card.hidden = !show;
        if (show) visible++;
      });
      if (countEl) countEl.textContent = `${subId === "all" ? "PORTFOLIO" : "SET"} / ${pad(visible)} FRAMES`;
      if (emptyEl) emptyEl.hidden = visible > 0;
      if (updateUrl && state.route?.name === "category") {
        const url = new URL(location.href);
        if (subId === "all") url.searchParams.delete("sub");
        else url.searchParams.set("sub", subId);
        try {
          history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, "", url.pathname + url.search + url.hash);
        } catch (e) { /* ignore */ }
      }
      if (scrollActive) {
        const activeBtn = buttons.find((b) => b.dataset.submenu === subId);
        activeBtn?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", inline: "center", block: "nearest" });
      }
    };
    buttons.forEach((btn) => btn.addEventListener("click", () => apply(btn.dataset.submenu, true, true)));
    apply(state.activeSub || "all", false);
  }

  function initFilmstrip() {
    const strip = $("#filmstrip");
    if (!strip) return;
    const prev = $('[data-strip="-1"]');
    const next = $('[data-strip="1"]');
    const progress = $(".strip-progress span");
    const update = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      const pct = max > 0 ? strip.scrollLeft / max : 1;
      if (progress) progress.style.width = `${Math.max(4, pct * 100)}%`;
      if (prev) prev.disabled = strip.scrollLeft <= 4;
      if (next) next.disabled = strip.scrollLeft >= max - 4;
    };
    const scrollBy = (dir) => {
      const card = strip.querySelector(".film-card");
      const amount = card ? card.getBoundingClientRect().width + 18 : 260;
      strip.scrollBy({ left: amount * dir, behavior: reduceMotion ? "auto" : "smooth" });
    };
    prev?.addEventListener("click", () => scrollBy(-1));
    next?.addEventListener("click", () => scrollBy(1));
    strip.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();

    // Desktop click-drag, keep native touch scrolling intact.
    let down = false;
    let startX = 0;
    let startScroll = 0;
    let dragged = false;
    strip.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = true;
      dragged = false;
      startX = e.clientX;
      startScroll = strip.scrollLeft;
      strip.setPointerCapture?.(e.pointerId);
    });
    strip.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 6) {
        dragged = true;
        strip.classList.add("is-dragging");
      }
      if (dragged) {
        strip.scrollLeft = startScroll - dx;
        e.preventDefault();
      }
    });
    const release = () => {
      if (!down) return;
      down = false;
      strip.classList.remove("is-dragging");
    };
    strip.addEventListener("pointerup", release);
    strip.addEventListener("pointercancel", release);
    strip.addEventListener("click", (e) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
      }
    }, true);
    strip.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) {
        strip.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  }

  /* ------------------------------------------------------------------ */
  /* Routing                                                             */
  /* ------------------------------------------------------------------ */
  function saveScroll() {
    try {
      history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, "", location.href);
    } catch (e) { /* ignore */ }
  }

  function navigate(path, trigger = null) {
    if (!path || path === location.pathname + location.search) {
      closeMenu();
      return;
    }
    saveScroll();
    closeMenu({ restoreFocus: false, silent: true });
    let oldPoster = null;
    if (trigger && path.startsWith("/1/g/")) {
      oldPoster = trigger.querySelector?.(".cat-media img");
    }
    if (oldPoster) oldPoster.style.viewTransitionName = "category-poster";

    const commit = () => {
      history.pushState({ lumiere: true, scrollY: 0 }, "", path);
      window.scrollTo(0, 0);
      renderRoute();
      if (oldPoster && path.startsWith("/1/g/")) {
        const newPoster = $(".cat-hero-media img");
        if (newPoster) newPoster.style.viewTransitionName = "category-poster";
      }
    };

    if (document.startViewTransition && !reduceMotion) {
      const vt = document.startViewTransition(commit);
      vt.finished.finally(() => {
        if (oldPoster) oldPoster.style.viewTransitionName = "";
        const newPoster = $(".cat-hero-media img");
        if (newPoster) newPoster.style.viewTransitionName = "";
        state.pendingPoster = false;
      });
    } else {
      commit();
      if (oldPoster) oldPoster.style.viewTransitionName = "";
    }
  }

  function handleNavClick(e, link) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (!href.startsWith("/")) return;
    e.preventDefault();
    if (href === location.pathname + location.search) {
      closeMenu();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      return;
    }
    navigate(href, link);
  }

  /* ------------------------------------------------------------------ */
  /* Menu                                                                */
  /* ------------------------------------------------------------------ */
  function openMenu() {
    if (!state.data) return;
    state.previousFocus = document.activeElement;
    state.menuOpen = true;
    menuOverlay.classList.add("is-open");
    menuOverlay.setAttribute("aria-hidden", "false");
    menuTrigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("menu-open");
    window.setTimeout(() => $("#menuClose")?.focus({ preventScroll: true }), 220);
  }

  function trapMenuFocus(e) {
    if (e.key !== "Tab" || !state.menuOpen) return;
    const focusables = $$("button:not([disabled]), a[href]", menuOverlay).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function closeMenu(options = {}) {
    if (!menuOverlay.classList.contains("is-open")) return;
    menuOverlay.classList.remove("is-open");
    menuOverlay.setAttribute("aria-hidden", "true");
    menuTrigger.setAttribute("aria-expanded", "false");
    state.menuOpen = false;
    document.body.classList.remove("menu-open");
    if (options.restoreFocus !== false && state.previousFocus) {
      state.previousFocus.focus?.({ preventScroll: true });
      state.previousFocus = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lightbox                                                            */
  /* ------------------------------------------------------------------ */
  const lbEls = {};
  function cacheLightbox() {
    ["lightbox", "lbAtmosphere", "lbClose", "lbCounter", "lbPrev", "lbNext", "lbStage", "lbFigure", "lbImage", "lbCaption", "lbKicker", "lbTitle", "lbSub", "lbHint", "lbProgress", "lbInfoToggle"].forEach((id) => {
      lbEls[id] = document.getElementById(id);
    });
  }

  function openLightbox(photos, index, groupLabel = "") {
    if (!photos || !photos.length) return;
    cacheLightbox();
    const lb = state.lightbox;
    lb.open = true;
    lb.photos = photos;
    lb.index = Math.max(0, Math.min(index, photos.length - 1));
    lb.lastFocus = document.activeElement;
    lightbox.classList.remove("caption-hidden");
    lbEls.lbInfoToggle?.setAttribute("aria-pressed", "true");
    setLightboxInert(true);
    document.body.classList.add("lightbox-open");
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    lbEls.lbImage.style.opacity = "0";
    lbEls.lbFigure.style.opacity = "";
    setLightboxPhoto(lb.index, 0);
    window.setTimeout(() => lbEls.lbClose?.focus({ preventScroll: true }), 60);
    $$("[data-photo-index], [data-film-index]").forEach((el) => el.setAttribute("aria-expanded", "false"));
    if (!reduceMotion) {
      lbEls.lbFigure.animate(
        [{ opacity: 0, transform: "translateY(10px) scale(.985)" }, { opacity: 1, transform: "none" }],
        { duration: 520, easing: EASE }
      );
    }
    clearTimeout(lb.hintTimer);
    lbEls.lbHint?.classList.remove("is-hidden");
    lb.hintTimer = window.setTimeout(() => lbEls.lbHint?.classList.add("is-hidden"), 3800);
  }

  function closeLightbox(options = {}) {
    const lb = state.lightbox;
    if (!lb.open) return;
    lb.open = false;
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lightbox-open");
    setLightboxInert(false);
    clearTimeout(lb.hintTimer);
    resetZoom();
    const restore = options.restoreFocus !== false ? lb.lastFocus : null;
    if (restore && !options.instant) restore.focus?.({ preventScroll: true });
    lb.lastFocus = null;
    if (options.instant) {
      lightbox.style.transition = "none";
      requestAnimationFrame(() => { lightbox.style.transition = ""; });
    }
  }

  function setLightboxInert(on) {
    const appEl = $("#app");
    if (appEl) appEl.inert = on;
    siteNav.inert = on;
    siteFooter.inert = on;
    if (on) {
      lightbox.removeAttribute("hidden");
    }
  }

  function setLightboxPhoto(index, direction = 0) {
    const lb = state.lightbox;
    const photo = lb.photos[index];
    if (!photo) return;
    cacheLightbox();
    lb.index = index;
    lb.busy = false;
    resetZoom({ silent: true });
    const token = ++lb.token;
    const category = categoryName(photo.category) || "影像";
    const categoryData = categoryBySlug(photo.category);
    const subData = categoryData?.subcategories?.find((s) => s.id === photo.subcategory_id);
    lbEls.lbCounter.innerHTML = `<span>${pad(index + 1)}</span><i>/</i><span>${pad(lb.photos.length)}</span>`;
    lbEls.lbKicker.textContent = `${category}${subData ? " / " + subData.name : ""} · ${photo.date || new Date().getFullYear()}`;
    lbEls.lbTitle.textContent = photo.title || "未命名影像";
    const meta = [photo.caption, [photo.location, photo.date].filter(Boolean).join(" · ")].filter(Boolean).join("　·　");
    lbEls.lbSub.textContent = meta;
    if (lbEls.lbProgress) {
      const span = lbEls.lbProgress.querySelector("span") || document.createElement("span");
      if (!span.parentNode) lbEls.lbProgress.appendChild(span);
      span.style.width = `${((index + 1) / lb.photos.length) * 100}%`;
    }
    lbEls.lbPrev.disabled = index <= 0;
    lbEls.lbNext.disabled = index >= lb.photos.length - 1;
    lbEls.lbAtmosphere.style.backgroundImage = `url("${photo.lqip || photo.view}")`;
    lbEls.lbFigure.classList.add("is-loading");
    lbEls.lbImage.style.opacity = "0";
    lbEls.lbImage.alt = photoAlt(photo);

    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (token !== lb.token) return;
      lbEls.lbImage.src = photo.view;
      lbEls.lbImage.style.opacity = "1";
      lbEls.lbFigure.classList.remove("is-loading");
      lbEls.lbAtmosphere.style.backgroundImage = `url("${photo.view}")`;
      if (!reduceMotion && direction !== 0) {
        lbEls.lbImage.animate(
          [{ opacity: 0, transform: `translateX(${direction > 0 ? 22 : -22}px) scale(.99)` }, { opacity: 1, transform: "none" }],
          { duration: 420, easing: EASE }
        );
      }
    };
    img.onerror = () => {
      if (token !== lb.token) return;
      lbEls.lbFigure.classList.remove("is-loading");
      showToast("这张照片暂时无法加载");
    };
    img.src = photo.view;
    if (img.complete) img.onload();
    preloadAround(index);
    lbEls.lbHint?.classList.remove("is-hidden");
  }

  function preloadAround(index) {
    const lb = state.lightbox;
    [index - 1, index + 1].forEach((i) => {
      const p = lb.photos[i];
      if (p) {
        const im = new Image();
        im.src = p.view;
      }
    });
  }

  function lbNavigate(delta) {
    const lb = state.lightbox;
    if (!lb.open || lb.busy) return;
    const nextIndex = lb.index + delta;
    if (nextIndex < 0 || nextIndex >= lb.photos.length) {
      springBack();
      return;
    }
    lb.busy = true;
    const stageWidth = lbEls.lbStage.clientWidth;
    lbEls.lbFigure.style.transition = `transform .28s ${EASE}, opacity .28s ${EASE}`;
    lbEls.lbFigure.style.transform = `translate3d(${-delta * stageWidth * 0.6}px, 0, 0) scale(.985)`;
    lbEls.lbFigure.style.opacity = "0";
    window.setTimeout(() => {
      setLightboxPhoto(nextIndex, delta);
      lbEls.lbFigure.style.transition = "none";
      lbEls.lbFigure.style.transform = `translate3d(${delta * 40}px, 0, 0)`;
      lbEls.lbFigure.style.opacity = "0";
      requestAnimationFrame(() => {
        lbEls.lbFigure.style.transition = `transform .42s ${EASE}, opacity .42s ${EASE}`;
        lbEls.lbFigure.style.transform = "none";
        lbEls.lbFigure.style.opacity = "1";
      });
    }, 190);
  }

  function resetZoom(options = {}) {
    const lb = state.lightbox;
    lb.scale = 1;
    lb.tx = 0;
    lb.ty = 0;
    if (lbEls.lbFigure) {
      lbEls.lbFigure.style.transition = options.silent ? "none" : `transform .4s ${EASE}`;
      lbEls.lbFigure.style.transform = "none";
    }
    lbEls.lbStage?.classList.remove("is-zoomed", "is-panning");
  }

  function applyZoom(animate = false) {
    const lb = state.lightbox;
    if (!lbEls.lbFigure) return;
    lbEls.lbFigure.style.transition = animate ? `transform .4s ${EASE}` : "none";
    lbEls.lbFigure.style.transform = `translate3d(${lb.tx}px, ${lb.ty}px, 0) scale(${lb.scale})`;
    lbEls.lbStage?.classList.toggle("is-zoomed", lb.scale > 1.02);
  }

  function springBack() {
    const lb = state.lightbox;
    lb.tx = 0;
    lb.ty = 0;
    lb.scale = 1;
    applyZoom(true);
  }

  function toggleZoom(clientX, clientY) {
    const lb = state.lightbox;
    if (lb.scale > 1.05) {
      lb.scale = 1;
      lb.tx = 0;
      lb.ty = 0;
    } else {
      lb.scale = 2.2;
      const rect = lbEls.lbStage.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      lb.tx = -dx * 0.55;
      lb.ty = -dy * 0.55;
    }
    applyZoom(true);
  }

  function initLightboxGestures() {
    cacheLightbox();
    const stage = lbEls.lbStage;
    if (!stage) return;
    const lb = state.lightbox;
    const pointList = () => Array.from(lb.pointers.values());
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    stage.addEventListener("pointerdown", (e) => {
      if (!lb.open || e.button !== 0) return;
      if (e.target.closest("button")) return;
      lb.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture?.(e.pointerId);
      if (lb.pointers.size === 1) {
        lb.startX = e.clientX;
        lb.startY = e.clientY;
        lb.startTx = lb.tx;
        lb.startTy = lb.ty;
        lb.moved = false;
        lbEls.lbFigure.style.transition = "none";
      } else if (lb.pointers.size === 2) {
        const [a, b] = pointList();
        lb.pinchStartDist = dist(a, b) || 1;
        lb.pinchStartScale = lb.scale;
        lb.moved = true;
      }
    });

    stage.addEventListener("pointermove", (e) => {
      if (!lb.open || !lb.pointers.has(e.pointerId)) return;
      lb.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (lb.pointers.size >= 2) {
        const [a, b] = pointList();
        const d = dist(a, b) || 1;
        const nextScale = clamp(lb.pinchStartScale * (d / lb.pinchStartDist), 1, 4);
        lb.scale = nextScale;
        applyZoom(false);
        lb.moved = true;
        return;
      }
      const dx = e.clientX - lb.startX;
      const dy = e.clientY - lb.startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) lb.moved = true;
      if (!lb.moved) return;
      if (lb.scale > 1.02) {
        lb.tx = lb.startTx + dx;
        lb.ty = lb.startTy + dy;
        stage.classList.add("is-panning");
        applyZoom(false);
        return;
      }
      // At 1×, horizontal movement previews the next frame; downward movement hints dismiss.
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      if (horizontal) {
        lb.tx = dx * 0.92;
        lb.ty = dy * 0.06;
      } else {
        lb.tx = dx * 0.08;
        lb.ty = Math.max(0, dy * 0.86);
      }
      applyZoom(false);
      lbEls.lbFigure.style.opacity = String(clamp(1 - Math.abs(dx) / (stage.clientWidth * 1.5) - Math.max(0, dy) / 1400, 0.35, 1));
    });

    const endPointer = (e) => {
      if (!lb.pointers.has(e.pointerId)) return;
      lb.pointers.delete(e.pointerId);
      stage.classList.remove("is-panning");
      if (lb.pointers.size > 0) return;
      if (!lb.open) return;
      if (lb.scale > 1.02) {
        if (lb.scale < 1.04) resetZoom();
        applyZoom(true);
        lb.moved = false;
        return;
      }
      const dx = e.clientX - lb.startX;
      const dy = e.clientY - lb.startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (!lb.moved) {
        const now = Date.now();
        if (now - lb.lastTap < 300 && Math.hypot(e.clientX - lb.lastTapX, e.clientY - lb.lastTapY) < 32) {
          e.preventDefault();
          toggleZoom(e.clientX, e.clientY);
          lb.lastTap = 0;
        } else {
          lb.lastTap = now;
          lb.lastTapX = e.clientX;
          lb.lastTapY = e.clientY;
        }
        lb.moved = false;
        return;
      }
      lbEls.lbFigure.style.opacity = "";
      if (absX > Math.max(52, stage.clientWidth * 0.13) && absX > absY * 1.15) {
        const delta = dx < 0 ? 1 : -1;
        if ((delta > 0 && lb.index < lb.photos.length - 1) || (delta < 0 && lb.index > 0)) {
          lbNavigate(delta);
          return;
        }
      }
      if (dy > 120 && absY > absX * 1.15) {
        closeLightbox();
        return;
      }
      springBack();
      lb.moved = false;
    };
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", (e) => {
      lb.pointers.delete(e.pointerId);
      if (!lb.pointers.size) springBack();
    });
    stage.addEventListener("click", (e) => {
      if (e.target === stage && !lb.moved) closeLightbox();
    });
    stage.addEventListener("dragstart", (e) => e.preventDefault());
  }

  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusables = $$("button:not([disabled]), a[href]", lightbox).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ------------------------------------------------------------------ */
  /* Global events                                                       */
  /* ------------------------------------------------------------------ */
  function bindGlobalEvents() {
    cacheLightbox();
    initLightboxGestures();

    menuTrigger?.addEventListener("click", () => {
      if (menuOverlay.classList.contains("is-open")) closeMenu();
      else openMenu();
    });
    $("#menuClose")?.addEventListener("click", () => closeMenu());
    $$("[data-close-menu]").forEach((el) => el.addEventListener("click", () => closeMenu()));

    document.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) { handleNavClick(e, nav); return; }
      const copy = e.target.closest("[data-copy]");
      if (copy) { e.preventDefault(); copyText(copy.dataset.copy || ""); return; }
      const scroll = e.target.closest("[data-scroll]");
      if (scroll) {
        e.preventDefault();
        const target = $(scroll.dataset.scroll);
        target?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        return;
      }
      const top = e.target.closest("[data-to-top]");
      if (top) {
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
        return;
      }
      const strip = e.target.closest("[data-strip]");
      if (strip) { return; }
      const film = e.target.closest("[data-film-index]");
      if (film) {
        const photos = (state.data.featured || []).slice(0, 10);
        openLightbox(photos, Number(film.dataset.filmIndex), "Selected");
        return;
      }
      const photo = e.target.closest("[data-photo-index]");
      if (photo) {
        const cat = state.route.name === "category" ? categoryBySlug(state.route.slug) : null;
        if (cat) {
          const fullPhotos = cat.photos || [];
          const fullIndex = Number(photo.dataset.photoIndex);
          const fullPhoto = fullPhotos[fullIndex];
          const activeSub = state.activeSub || "all";
          const filtered = activeSub === "all" ? fullPhotos : fullPhotos.filter((p) => p.subcategory_id === activeSub);
          const filteredIndex = filtered.findIndex((p) => p.id === fullPhoto?.id);
          openLightbox(filtered, filteredIndex >= 0 ? filteredIndex : 0, cat.name);
        }
      }
    });

    // Header / scroll
    let scrollTicking = false;
    window.addEventListener("scroll", () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        updateNavState();
        scrollTicking = false;
      });
    }, { passive: true });
    window.addEventListener("resize", updateNavState, { passive: true });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (state.lightbox.open) { closeLightbox(); return; }
        if (state.menuOpen) { closeMenu(); return; }
      }
      if (state.menuOpen) {
        if (e.key === "Escape") closeMenu();
        else trapMenuFocus(e);
        return;
      }
      if (state.lightbox.open) {
        if (e.key === "ArrowRight") { e.preventDefault(); lbNavigate(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); lbNavigate(-1); }
        else if (e.key === "Tab") trapFocus(e);
        return;
      }
      // Lightbox controls
    });

    $("#lbClose")?.addEventListener("click", () => closeLightbox());
    $("#lbPrev")?.addEventListener("click", () => lbNavigate(-1));
    $("#lbNext")?.addEventListener("click", () => lbNavigate(1));
    if (lbEls.lbInfoToggle) {
      lbEls.lbInfoToggle.classList.add("is-on");
      lbEls.lbInfoToggle.addEventListener("click", () => {
        const hidden = lightbox.classList.toggle("caption-hidden");
        lbEls.lbInfoToggle.setAttribute("aria-pressed", hidden ? "false" : "true");
      });
      lbEls.lbInfoToggle.setAttribute("aria-pressed", "true");
    }

    window.addEventListener("popstate", (e) => {
      if (state.lightbox.open) closeLightbox({ restoreFocus: false, instant: true });
      closeMenu({ restoreFocus: false, silent: true });
      renderRoute({ preserveScroll: true });
      const y = e.state && typeof e.state.scrollY === "number" ? e.state.scrollY : 0;
      requestAnimationFrame(() => window.scrollTo(0, y));
    });

    // Avoid a stale poster name lingering.
    window.addEventListener("pagehide", () => {
      $$("[style*='view-transition-name']").forEach((el) => { el.style.viewTransitionName = ""; });
    });
  }

  boot();
})();

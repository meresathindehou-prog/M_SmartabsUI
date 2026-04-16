/**
 * TabsFlow SaaS — script.js
 * Complete frontend SaaS engine (localStorage mock backend)
 *
 * Architecture:
 *  ┌─────────────────────────────────┐
 *  │  Store (localStorage adapter)   │
 *  ├─────────────────────────────────┤
 *  │  Auth     (signup/login/session)│
 *  │  Subs     (subscription engine) │
 *  │  Admin    (payment validation)  │
 *  │  Router   (page navigation)     │
 *  │  UI       (render helpers)      │
 *  │  Tabs     (SmartTabs component) │
 *  │  Charts   (data visualization)  │
 *  └─────────────────────────────────┘
 *
 * ── TO INTEGRATE REAL MTN MOMO API ──
 * Search for: // [MOMO_API] comments in this file.
 * Each marks where real API calls should replace mock logic.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════ */
const CONFIG = {
  APP_NAME:         'TabsFlow',
  VERSION:          '2.4.0',
  PRICE_FCFA:       5000,
  CURRENCY:         'FCFA',
  MOMO_NUMBER:      '0162051512',
  MOMO_NAME:        'Mérès ATHINDEHOU',
  TRIAL_DAYS:       0,      // 0 = no trial
  SESSION_TTL_DAYS: 30,     // auto-logout after N days

  // [MOMO_API] Replace this with your real MTN MoMo API credentials
  // MOMO_API_KEY:       'YOUR_MTN_API_KEY',
  // MOMO_API_URL:       'https://sandbox.momodeveloper.mtn.com',
  // MOMO_SUBSCRIPTION_KEY: 'YOUR_SUBSCRIPTION_KEY',

  ADMIN_EMAILS: ['admin@tabsflow.com', 'meresathindehou@gmail.com'],
};

/* ═══════════════════════════════════════════════════════════
   STORE — localStorage adapter with namespacing & TTL
═══════════════════════════════════════════════════════════ */
const Store = {
  NS: 'tf:',

  set(key, value) {
    try { localStorage.setItem(this.NS + key, JSON.stringify(value)); }
    catch(e) { console.warn('[Store] write failed', e); }
  },

  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(this.NS + key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },

  del(key) {
    try { localStorage.removeItem(this.NS + key); }
    catch(e) {}
  },

  clear(prefix = '') {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(this.NS + prefix))
        .forEach(k => localStorage.removeItem(k));
    } catch(e) {}
  },

  /* User-specific storage */
  userSet(userId, key, value) { this.set(`u:${userId}:${key}`, value); },
  userGet(userId, key, fb=null) { return this.get(`u:${userId}:${key}`, fb); },
  userDel(userId, key) { this.del(`u:${userId}:${key}`); },
};

/* ═══════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════ */
const Utils = {
  /** Generate a unique ID */
  uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  },

  /** Generate a payment reference */
  payRef() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return 'TF-' + Array.from({length:8}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  },

  /** Simple email validation */
  isEmail(str) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str); },

  /** Hash a password (NOT crypto-secure — for demo only) */
  async hashPassword(pw) {
    // In production: use bcrypt on server side. This is a client-side demo.
    const enc  = new TextEncoder().encode(pw + 'tabsflow_salt_2024');
    const buf  = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },

  /** Format number */
  fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n)); },

  /** Date helpers */
  now() { return Date.now(); },
  daysFromNow(d) { return Date.now() + d * 24 * 60 * 60 * 1000; },
  formatDate(ts) {
    return new Date(ts).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
  },

  /** Debounce */
  debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  /** Get initials from name */
  initials(name) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  },

  /** Easing for animations */
  easeOutCubic: t => 1 - Math.pow(1-t, 3),

  /** Animate counter */
  animateCounter(el, target, suffix='', prefix='', duration=800) {
    const start = performance.now();
    const isFloat = !Number.isInteger(target);
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const v = this.easeOutCubic(p) * target;
      el.textContent = prefix + (isFloat ? v.toFixed(1) : this.fmt(Math.floor(v))) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = prefix + (isFloat ? target.toFixed(1) : this.fmt(target)) + suffix;
    };
    requestAnimationFrame(tick);
  },
};

/* ═══════════════════════════════════════════════════════════
   AUTH — signup / login / session
═══════════════════════════════════════════════════════════ */
const Auth = {
  /**
   * Register a new user.
   * @returns { ok: boolean, error?: string, user?: object }
   */
  async signup({ name, email, password }) {
    if (!name?.trim())          return { ok: false, error: 'Name is required.' };
    if (!Utils.isEmail(email))  return { ok: false, error: 'Invalid email address.' };
    if (password?.length < 6)   return { ok: false, error: 'Password must be at least 6 characters.' };

    const users = Store.get('users', {});
    const emailKey = email.toLowerCase().trim();

    if (users[emailKey]) return { ok: false, error: 'An account with this email already exists.' };

    const hash = await Utils.hashPassword(password);
    const id   = Utils.uid('usr');
    const isAdmin = CONFIG.ADMIN_EMAILS.includes(emailKey);

    const user = {
      id, name: name.trim(), email: emailKey,
      passwordHash: hash,
      role: isAdmin ? 'admin' : 'user',
      createdAt: Utils.now(),
      avatarColor: 'jade',
    };

    users[emailKey] = user;
    Store.set('users', users);

    // Create default subscription (free)
    Subs.init(id);

    this._createSession(user);
    return { ok: true, user };
  },

  async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });

  console.log(data, error);
}

  /**
   * Log in an existing user.
   */
  async login({ email, password }) {
    if (!Utils.isEmail(email)) return { ok: false, error: 'Invalid email address.' };
    if (!password)             return { ok: false, error: 'Password is required.' };

    const users    = Store.get('users', {});
    const emailKey = email.toLowerCase().trim();
    const user     = users[emailKey];

    if (!user) return { ok: false, error: 'No account found with this email.' };

    const hash = await Utils.hashPassword(password);
    if (hash !== user.passwordHash) return { ok: false, error: 'Incorrect password.' };

    this._createSession(user);
    return { ok: true, user };
  },

  async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  console.log(data, error);
}

  /** Save session to localStorage */
  _createSession(user) {
    Store.set('session', {
      userId: user.id,
      email:  user.email,
      name:   user.name,
      role:   user.role,
      expiresAt: Utils.daysFromNow(CONFIG.SESSION_TTL_DAYS),
    });
  },

  /** Get current session (null if expired/missing) */
  getSession() {
    const session = Store.get('session');
    if (!session)                     return null;
    if (session.expiresAt < Utils.now()) { this.logout(); return null; }
    return session;
  },

  /** Get full user object from current session */
  getCurrentUser() {
    const session = this.getSession();
    if (!session) return null;
    const users = Store.get('users', {});
    return users[session.email] || null;
  },

  /** Logout */
  logout() {
    Store.del('session');
    Router.go('login');
  },

  /** Check if logged in */
  isLoggedIn() { return !!this.getSession(); },

  /** Check if current user is admin */
  isAdmin() {
    const s = this.getSession();
    return s?.role === 'admin';
  },
};

/* ═══════════════════════════════════════════════════════════
   SUBSCRIPTION ENGINE
═══════════════════════════════════════════════════════════ */
const Subs = {
  STATUS: { FREE: 'free', PENDING: 'pending', ACTIVE: 'active', EXPIRED: 'expired' },

  /** Initialize free subscription for a new user */
  init(userId) {
    const sub = {
      userId, status: this.STATUS.FREE,
      plan: 'free', startedAt: null, expiresAt: null,
      payments: [],
    };
    Store.userSet(userId, 'sub', sub);
    return sub;
  },

  /** Get subscription for a user */
  get(userId) {
    const sub = Store.userGet(userId, 'sub');
    if (!sub) return this.init(userId);

    // Auto-expire check
    if (sub.status === this.STATUS.ACTIVE && sub.expiresAt && sub.expiresAt < Utils.now()) {
      sub.status = this.STATUS.EXPIRED;
      Store.userSet(userId, 'sub', sub);
    }
    return sub;
  },

  /** Check if user has active premium access */
  isPremium(userId) {
    const sub = this.get(userId);
    return sub.status === this.STATUS.ACTIVE;
  },

  async function checkSubscription(user) {
  const { data } = await supabase
    .from("profiles")
    .select("premium")
    .eq("id", user.id)
    .single();

  return data.premium;
}

  /**
   * Submit a payment request.
   * This creates a "pending" entry that an admin must approve.
   *
   * [MOMO_API] ── Replace this mock with a real MTN MoMo API call:
   *
   *  const response = await fetch(`${CONFIG.MOMO_API_URL}/collection/v1_0/requesttopay`, {
   *    method: 'POST',
   *    headers: {
   *      'Authorization': `Bearer ${YOUR_ACCESS_TOKEN}`,
   *      'X-Reference-Id': referenceId,
   *      'X-Target-Environment': 'sandbox',  // → 'mtncongo' or 'mtnbenin' in production
   *      'Ocp-Apim-Subscription-Key': CONFIG.MOMO_SUBSCRIPTION_KEY,
   *      'Content-Type': 'application/json',
   *    },
   *    body: JSON.stringify({
   *      amount: CONFIG.PRICE_FCFA.toString(),
   *      currency: 'XOF',      // FCFA = XOF in ISO 4217
   *      externalId: referenceId,
   *      payer: { partyIdType: 'MSISDN', partyId: userPhoneNumber },
   *      payerMessage: 'TabsFlow Premium Subscription',
   *      payeeNote: 'TabsFlow subscription payment',
   *    }),
   *  });
   *  // Then poll GET /collection/v1_0/requesttopay/{referenceId} for status
   */
  async submitPaymentRequest(userId, { phone, referenceNote }) {
    const ref = Utils.payRef();
    const sub = this.get(userId);

    const payment = {
      id: Utils.uid('pay'),
      userId,
      reference: ref,
      amount: CONFIG.PRICE_FCFA,
      currency: CONFIG.CURRENCY,
      phone: phone || CONFIG.MOMO_NUMBER,
      note: referenceNote || '',
      status: 'pending',
      submittedAt: Utils.now(),
      approvedAt: null,
      approvedBy: null,
    };

    sub.status   = this.STATUS.PENDING;
    sub.pendingPayment = payment;
    Store.userSet(userId, 'sub', sub);

    // Add to global pending payments list (for admin)
    const allPending = Store.get('pending_payments', []);
    allPending.push(payment);
    Store.set('pending_payments', allPending);

    // [MOMO_API] ── Here you would call the real MTN API (see comment above)

    return { ok: true, reference: ref, payment };
  },

  /**
   * ADMIN: Approve a payment.
   * In real system: triggered by MTN webhook or polling.
   *
   * [MOMO_API] ── This method would be triggered by:
   *  1. A webhook from MTN: POST /webhook → verify signature → call this
   *  2. OR: polling GET /collection/v1_0/requesttopay/{referenceId}
   *     until status === 'SUCCESSFUL'
   */

  async function activatePremium(user) {
  await supabase
    .from("profiles")
    .update({ premium: true })
    .eq("id", user.id);
}

  adminApprove(paymentId) {
    const allPending = Store.get('pending_payments', []);
    const pay = allPending.find(p => p.id === paymentId);
    if (!pay) return { ok: false, error: 'Payment not found' };

    const sub = Store.userGet(pay.userId, 'sub');
    if (!sub) return { ok: false, error: 'User not found' };

    // Activate for 30 days
    sub.status    = this.STATUS.ACTIVE;
    sub.plan      = 'premium';
    sub.startedAt = Utils.now();
    sub.expiresAt = Utils.daysFromNow(30);
    sub.payments.push({ ...pay, status: 'approved', approvedAt: Utils.now() });
    sub.pendingPayment = null;
    Store.userSet(pay.userId, 'sub', sub);

    // Remove from pending list
    const updated = allPending.filter(p => p.id !== paymentId);
    updated.push({ ...pay, status: 'approved', approvedAt: Utils.now() });
    Store.set('pending_payments', updated);

    return { ok: true };
  },

  /**
   * ADMIN: Reject a payment.
   */
  adminReject(paymentId) {
    const allPending = Store.get('pending_payments', []);
    const pay = allPending.find(p => p.id === paymentId);
    if (!pay) return { ok: false, error: 'Payment not found' };

    const sub = Store.userGet(pay.userId, 'sub');
    if (sub) {
      sub.status = this.STATUS.FREE;
      sub.pendingPayment = null;
      Store.userSet(pay.userId, 'sub', sub);
    }

    const updated = allPending.map(p => p.id === paymentId ? {...p, status:'rejected'} : p);
    Store.set('pending_payments', updated);

    return { ok: true };
  },

  /** Get pending payments (for admin) */
  getPendingPayments() {
    return Store.get('pending_payments', []).filter(p => p.status === 'pending');
  },

  /** Get all payments (for admin) */
  getAllPayments() {
    return Store.get('pending_payments', []);
  },
};

/* ═══════════════════════════════════════════════════════════
   TOAST NOTIFICATION SYSTEM
═══════════════════════════════════════════════════════════ */
const Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toastContainer');
  },

  show({ title, msg, type = 'jade', duration = 4000 }) {
    const icons = { jade: 'fa-check-circle', rose: 'fa-times-circle', amber: 'fa-exclamation-triangle', saph: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i class="fas ${icons[type] || icons.jade} toast-icon"></i>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Close notification"><i class="fas fa-times"></i></button>
    `;
    this.container.appendChild(toast);

    const close = () => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 350);
    };
    toast.querySelector('.toast-close').addEventListener('click', close);
    setTimeout(close, duration);
  },

  success(title, msg)  { this.show({ title, msg, type: 'jade' }); },
  error(title, msg)    { this.show({ title, msg, type: 'rose' }); },
  warning(title, msg)  { this.show({ title, msg, type: 'amber' }); },
  info(title, msg)     { this.show({ title, msg, type: 'saph' }); },
};

/* ═══════════════════════════════════════════════════════════
   ROUTER — single-page app routing
═══════════════════════════════════════════════════════════ */
const Router = {
  current: null,

  routes: {
    login:    { id: 'screen-login',   requiresAuth: false },
    signup:   { id: 'screen-signup',  requiresAuth: false },
    app:      { id: 'screen-app',     requiresAuth: true  },
  },

  pages: {
    dashboard: 'page-dashboard',
    upgrade:   'page-upgrade',
    payment:   'page-payment',
    profile:   'page-profile',
    admin:     'page-admin',
  },

  go(routeName, page = null) {
    const route = this.routes[routeName];
    if (!route) return;

    // Auth guard
    if (route.requiresAuth && !Auth.isLoggedIn()) {
      this.go('login'); return;
    }
    if (!route.requiresAuth && Auth.isLoggedIn() && routeName !== 'app') {
      this.go('app', 'dashboard'); return;
    }

    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(route.id);
    if (screen) screen.classList.add('active');

    this.current = routeName;

    // If app shell, show the right page
    if (routeName === 'app') {
      this.showPage(page || 'dashboard');
      App.updateSidebar();
    }
  },

  showPage(pageName) {
    // Admin guard
    if (pageName === 'admin' && !Auth.isAdmin()) {
      Toast.error('Access Denied', 'Admin area only.');
      this.showPage('dashboard'); return;
    }

    document.querySelectorAll('.page-main').forEach(p => p.classList.add('hidden'));
    const page = document.getElementById(this.pages[pageName]);
    if (page) {
      page.classList.remove('hidden');
      page.style.animation = 'none';
      page.offsetHeight; // reflow
      page.style.animation = '';
    }

    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === pageName);
    });

    // Update breadcrumb
    const labels = { dashboard: 'Dashboard', upgrade: 'Upgrade', payment: 'Payment', profile: 'Profile', admin: 'Admin' };
    const crumb = document.querySelector('.crumb-current');
    if (crumb) crumb.textContent = labels[pageName] || pageName;

    // Trigger page-specific init
    const inits = { dashboard: Dashboard.init, upgrade: Upgrade.init, payment: Payment.init, profile: Profile.init, admin: Admin.init };
    inits[pageName]?.();
  },
};

/* ═══════════════════════════════════════════════════════════
   APP SHELL — sidebar, header, global UI
═══════════════════════════════════════════════════════════ */
const App = {
  updateSidebar() {
    const user = Auth.getCurrentUser();
    if (!user) return;

    const sub = Subs.get(user.id);
    const isPremium = sub.status === 'active';

    // User info
    document.getElementById('sb-user-name').textContent = user.name;
    document.getElementById('sb-user-plan').textContent = isPremium ? '✦ Premium Member' : 'Free Plan';
    document.getElementById('sb-avatar-initials').textContent = Utils.initials(user.name);
    document.getElementById('header-user-name').textContent = user.name;

    // Subscription status card
    const dot   = document.getElementById('sb-sub-dot');
    const label = document.getElementById('sb-sub-status');
    const statusMap = {
      active:  ['dot-active',  '✦ Premium Active'],
      pending: ['dot-pending', '⏳ Approval Pending'],
      free:    ['dot-free',    'Free Plan'],
      expired: ['dot-free',    'Subscription Expired'],
    };
    const [cls, txt] = statusMap[sub.status] || statusMap.free;
    dot.className   = `ssc-status-dot ${cls}`;
    label.textContent = txt;

    // Premium lock on nav items
    document.querySelectorAll('.nav-item[data-premium="true"]').forEach(item => {
      item.classList.toggle('premium-lock', !isPremium);
      if (!isPremium) {
        item.addEventListener('click', (e) => {
          e.stopImmediatePropagation();
          Toast.warning('Premium Required', 'Upgrade to access this section.');
          Router.showPage('upgrade');
        }, { once: true });
      }
    });

    // Admin nav item visibility
    const adminNav = document.getElementById('nav-admin');
    if (adminNav) adminNav.style.display = Auth.isAdmin() ? 'flex' : 'none';

    // Upgrade CTA button
    const upgradeCta = document.getElementById('sb-upgrade-cta');
    if (upgradeCta) upgradeCta.style.display = isPremium ? 'none' : 'flex';
  },
};

/* ═══════════════════════════════════════════════════════════
   DASHBOARD PAGE
═══════════════════════════════════════════════════════════ */
const Dashboard = {
  initialized: false,

  init() {
    const user = Auth.getCurrentUser();
    if (!user) return;
    const sub = Subs.get(user.id);
    const isPremium = sub.status === 'active';

    // Update KPI counters (only once to avoid re-animation)
    if (!this.initialized) {
      this._animateKPIs();
      this._drawChart();
      this._drawSparkline();
      this.initialized = true;
    }

    // Initialize SmartTabs
    Tabs.init(isPremium);
  },

  _animateKPIs() {
    const kpis = [
      { id: 'kpi-revenue',  val: 142580, prefix: '$' },
      { id: 'kpi-users',    val: 8341 },
      { id: 'kpi-orders',   val: 529 },
      { id: 'kpi-rate',     val: 3.8, suffix: '%' },
    ];
    kpis.forEach(({ id, val, prefix='', suffix='' }) => {
      const el = document.getElementById(id);
      if (el) Utils.animateCounter(el, val, suffix, prefix);
    });
  },

  _drawChart() {
    const months = ['Jul','Aug','Sep','Oct'];
    const vals   = [78000, 98000, 85000, 142580];
    const maxVal = Math.max(...vals);
    const bars   = document.querySelectorAll('.bc-bar-fill');
    bars.forEach((bar, i) => {
      const h = (vals[i] / maxVal) * 100;
      setTimeout(() => { bar.style.height = h + '%'; }, 200 + i * 100);
      const valEl = bar.closest('.bc-col')?.querySelector('.bc-val');
      if (valEl) valEl.textContent = `$${Math.round(vals[i]/1000)}k`;
    });
  },

  _drawSparkline() {
    const svg = document.getElementById('sparkline-overview');
    if (!svg) return;
    const data = Array.from({length:30}, (_, i) => 40 + Math.sin(i*.4)*20 + Math.random()*25);
    _renderSparkline(svg, data);
  },
};

/* ── Sparkline renderer ── */
function _renderSparkline(svg, data) {
  const vw = 400, vh = 70;
  const pad = 8;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const xStep = vw / (data.length - 1);
  const yPos  = v => pad + ((max - v) / range) * (vh - pad * 2);

  const pts = data.map((v, i) => [i * xStep, yPos(v)]);
  const pathD = pts.reduce((acc, [x,y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = pts[i-1];
    const cx = (px + x) / 2;
    return acc + ` C${cx},${py} ${cx},${y} ${x},${y}`;
  }, '');

  const [lx, ly] = pts[pts.length - 1];
  const areaD = pathD + ` L${lx},${vh} L0,${vh} Z`;

  svg.querySelector('.spark-area').setAttribute('d', areaD);
  svg.querySelector('.spark-line').setAttribute('d', pathD);

  const line = svg.querySelector('.spark-line');
  const len  = 600;
  line.style.strokeDasharray  = len;
  line.style.strokeDashoffset = len;
  line.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.16,1,.3,1)';
  requestAnimationFrame(() => { line.style.strokeDashoffset = 0; });
}

/* ═══════════════════════════════════════════════════════════
   SMART TABS COMPONENT (integrated in dashboard)
═══════════════════════════════════════════════════════════ */
const Tabs = {
  activeIndex: 0,

  init(isPremium) {
    const tabBtns   = document.querySelectorAll('#dashboard-tabs .tab-btn');
    const indicator = document.getElementById('tab-indicator');

    tabBtns.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('locked') && !isPremium) {
          Toast.warning('Premium Feature', 'Upgrade your plan to access this tab.');
          Router.showPage('upgrade');
          return;
        }
        this.activate(i, indicator, tabBtns, isPremium);
      });
    });

    // Keyboard nav
    document.getElementById('dashboard-tabs')?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.activate(Math.min(this.activeIndex + 1, tabBtns.length - 1), indicator, tabBtns, isPremium);
      if (e.key === 'ArrowLeft')  this.activate(Math.max(this.activeIndex - 1, 0), indicator, tabBtns, isPremium);
    });

    // Restore saved tab
    const saved = parseInt(localStorage.getItem('tf:active-tab') || '0');
    this.activate(saved < tabBtns.length ? saved : 0, indicator, tabBtns, isPremium);
  },

  activate(index, indicator, tabBtns, isPremium) {
    const btn = tabBtns[index];
    if (!btn) return;
    if (btn.classList.contains('locked') && !isPremium) {
      this._showLockedPanel(index);
      return;
    }

    this.activeIndex = index;
    localStorage.setItem('tf:active-tab', index);

    // Update tab buttons
    tabBtns.forEach((b, i) => b.classList.toggle('active', i === index));

    // Move indicator
    const wrapper = btn.closest('.tabs-nav');
    const wRect   = wrapper.getBoundingClientRect();
    const bRect   = btn.getBoundingClientRect();
    if (indicator) {
      indicator.style.left  = `${bRect.left - wRect.left + wrapper.scrollLeft}px`;
      indicator.style.width = `${bRect.width}px`;
    }

    // Show correct panel
    document.querySelectorAll('.tab-panel').forEach((p, i) => {
      p.classList.toggle('active', i === index);
      p.classList.remove('locked-panel');
    });

    // Init tab-specific content
    if (index === 1 && isPremium) this._initAnalyticsTab();
    if (index === 2 && isPremium) this._initUsersTab();
    if (index === 3 && isPremium) this._initRevenueTab();
  },

  _showLockedPanel(index) {
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.remove('active', 'locked-panel');
    });
    const panel = document.querySelectorAll('.tab-panel')[index];
    if (panel) panel.classList.add('active', 'locked-panel');
  },

  _initAnalyticsTab() {
    const bars = document.querySelectorAll('#tab-analytics .an-bar-fill');
    bars.forEach(bar => {
      bar.style.transition = 'width .7s cubic-bezier(.16,1,.3,1)';
      bar.style.width = bar.dataset.w || '0';
    });
  },

  _initUsersTab() {
    // Lazy-load simulated user data
    const tbody = document.getElementById('users-tbody');
    if (!tbody || tbody.dataset.loaded) return;
    tbody.dataset.loaded = 'true';

    const users = [
      { name:'Sophie Azari',   email:'sophie@ex.com',  plan:'Enterprise', status:'active',  rev:'$8,900' },
      { name:'James Dubois',   email:'james@ex.com',   plan:'Pro',        status:'active',  rev:'$1,240' },
      { name:'Nadia Kowalski', email:'nadia@ex.com',   plan:'Pro',        status:'active',  rev:'$2,050' },
      { name:'Marcus Lee',     email:'marcus@ex.com',  plan:'Free',       status:'inactive',rev:'$0' },
      { name:'Rafael Braga',   email:'rafael@ex.com',  plan:'Pro',        status:'pending', rev:'$780' },
    ];
    const colors = ['av-jade','av-saph','av-rose','av-amber'];
    tbody.innerHTML = users.map((u,i) => `
      <tr>
        <td><div class="user-chip">
          <div class="mini-avatar ${colors[i%4]}">${Utils.initials(u.name)}</div>
          <div><div class="user-chip-name">${u.name}</div><div class="user-chip-email">${u.email}</div></div>
        </div></td>
        <td><span class="badge badge-${u.plan==='Enterprise'?'saph':u.plan==='Pro'?'jade':'amber'}">${u.plan}</span></td>
        <td><span class="badge badge-${u.status==='active'?'emerald':u.status==='pending'?'amber':'rose'}">${u.status}</span></td>
        <td>${u.rev}</td>
        <td>${Utils.formatDate(Utils.now() - Math.random()*2592000000)}</td>
      </tr>`).join('');
  },

  _initRevenueTab() {
    const spark = document.getElementById('sparkline-revenue');
    if (!spark || spark.dataset.drawn) return;
    spark.dataset.drawn = 'true';
    const data = Array.from({length:30}, (_, i) => 60 + Math.sin(i*.35)*25 + i*1.8 + Math.random()*20);
    _renderSparkline(spark, data);
  },
};

/* ═══════════════════════════════════════════════════════════
   UPGRADE PAGE
═══════════════════════════════════════════════════════════ */
const Upgrade = {
  init() {
    const user = Auth.getCurrentUser();
    if (!user) return;
    const sub = Subs.get(user.id);

    // If already premium, show status
    if (sub.status === 'active') {
      const msg = document.getElementById('upgrade-premium-msg');
      if (msg) { msg.style.display = 'flex'; }
    }
  },
};

/* ═══════════════════════════════════════════════════════════
   PAYMENT PAGE
═══════════════════════════════════════════════════════════ */
const Payment = {
  currentRef: null,

  init() {
    const user = Auth.getCurrentUser();
    if (!user) return;

    // Generate or restore reference
    const sub = Subs.get(user.id);
    this.currentRef = sub.pendingPayment?.reference || Utils.payRef();

    // Display reference
    const refEl = document.getElementById('payment-ref-code');
    if (refEl) refEl.textContent = this.currentRef;

    // Update status
    const statusEl = document.getElementById('payment-status-label');
    if (statusEl) {
      const map = { pending:'⏳ Awaiting admin approval…', active:'✅ Payment approved!', free:'Not submitted yet' };
      statusEl.textContent = map[sub.status] || map.free;
    }

    // Prefill phone
    const phoneEl = document.getElementById('pay-phone');
    if (phoneEl) phoneEl.value = sub.pendingPayment?.phone || '';
  },
};

/* ═══════════════════════════════════════════════════════════
   PROFILE PAGE
═══════════════════════════════════════════════════════════ */
const Profile = {
  init() {
    const user = Auth.getCurrentUser();
    if (!user) return;
    const sub = Subs.get(user.id);

    // Fill profile data
    const fields = {
      'prof-name':      user.name,
      'prof-email':     user.email,
      'prof-location':  user.location || 'Calavi, Bénin',
      'prof-joined':    Utils.formatDate(user.createdAt),
    };
    Object.entries(fields).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) { el.value !== undefined ? (el.value = val) : (el.textContent = val); }
    });

    // Avatar
    const av = document.getElementById('profile-avatar-initials');
    if (av) av.textContent = Utils.initials(user.name);

    // Subscription info
    const planEl = document.getElementById('prof-plan');
    if (planEl) planEl.textContent = sub.status === 'active' ? '✦ Premium' : 'Free';

    const expEl = document.getElementById('prof-expires');
    if (expEl) expEl.textContent = sub.expiresAt ? Utils.formatDate(sub.expiresAt) : 'N/A';
  },
};

async function createProfile(user) {
  await supabase.from("profiles").insert([
    {
      id: user.id,
      email: user.email,
      premium: false
    }
  ]);
}

/* ═══════════════════════════════════════════════════════════
   ADMIN PANEL
═══════════════════════════════════════════════════════════ */
const Admin = {
  init() {
    if (!Auth.isAdmin()) { Router.showPage('dashboard'); return; }

    const users    = Store.get('users', {});
    const userArr  = Object.values(users);
    const pending  = Subs.getPendingPayments();
    const allPay   = Subs.getAllPayments();
    const premiums = userArr.filter(u => Subs.get(u.id)?.status === 'active');

    // Stats
    const stats = {
      'admin-stat-users':    userArr.length,
      'admin-stat-premium':  premiums.length,
      'admin-stat-pending':  pending.length,
      'admin-stat-revenue':  premiums.length * CONFIG.PRICE_FCFA,
    };
    Object.entries(stats).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) Utils.animateCounter(el, val, id === 'admin-stat-revenue' ? ` ${CONFIG.CURRENCY}` : '');
    });

    // Render pending payments table
    this._renderPending(pending, userArr);
    this._renderAllPayments(allPay, userArr);
  },

  _renderPending(pending, users) {
    const container = document.getElementById('pending-payments-list');
    if (!container) return;

    if (!pending.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><div class="empty-title">No pending payments</div><div class="empty-desc">All payments have been processed.</div></div>`;
      return;
    }

    container.innerHTML = pending.map(pay => {
      const user = users.find(u => u.id === pay.userId);
      return `
        <div class="payment-row" id="pay-row-${pay.id}">
          <div class="pr-user">
            <div class="pr-name">${user?.name || 'Unknown user'}</div>
            <div class="pr-email">${user?.email || pay.userId}</div>
            <div class="pr-ref">REF: ${pay.reference}</div>
          </div>
          <div>
            <div class="badge badge-amber">${Utils.fmt(pay.amount)} ${pay.currency}</div>
            <div class="pr-date" style="margin-top:.35rem">${Utils.formatDate(pay.submittedAt)}</div>
          </div>
          <div class="pr-actions">
            <button class="btn btn-jade btn-sm" onclick="Admin._approve('${pay.id}')">
              <i class="fas fa-check"></i> Approve
            </button>
            <button class="btn btn-danger btn-sm" onclick="Admin._reject('${pay.id}')">
              <i class="fas fa-times"></i> Reject
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  _renderAllPayments(all, users) {
    const tbody = document.getElementById('all-payments-tbody');
    if (!tbody) return;

    const statusBadge = { approved:'badge-emerald', pending:'badge-amber', rejected:'badge-rose' };

    tbody.innerHTML = all.slice().reverse().slice(0, 20).map(pay => {
      const user = users.find(u => u.id === pay.userId);
      return `<tr>
        <td>${user?.name || '—'}</td>
        <td><code style="font-family:var(--f-mono);font-size:.75rem;color:var(--jade)">${pay.reference}</code></td>
        <td>${Utils.fmt(pay.amount)} ${pay.currency}</td>
        <td><span class="badge ${statusBadge[pay.status] || 'badge-amber'}">${pay.status}</span></td>
        <td>${Utils.formatDate(pay.submittedAt)}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:2rem">No payments yet</td></tr>`;
  },

  _approve(paymentId) {
    const result = Subs.adminApprove(paymentId);
    if (result.ok) {
      Toast.success('Payment Approved', 'User subscription has been activated.');
      this.init(); // refresh
    } else {
      Toast.error('Error', result.error);
    }
  },

  _reject(paymentId) {
    const result = Subs.adminReject(paymentId);
    if (result.ok) {
      Toast.warning('Payment Rejected', 'User has been notified.');
      this.init();
    } else {
      Toast.error('Error', result.error);
    }
  },
};

/* ═══════════════════════════════════════════════════════════
   EVENT HANDLERS — wired to HTML elements
═══════════════════════════════════════════════════════════ */
const Events = {
  init() {
    /* ── Auth forms ── */
    document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const btn      = document.getElementById('login-btn');

      btn.disabled = true; btn.textContent = 'Signing in…';
      const result = await Auth.login({ email, password });
      btn.disabled = false; btn.textContent = 'Sign in';

      if (result.ok) {
        Toast.success('Welcome back!', `Hello, ${result.user.name}`);
        Router.go('app', 'dashboard');
      } else {
        this._showFormError('login-error', result.error);
      }
    });

    document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name     = document.getElementById('signup-name').value.trim();
      const email    = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const btn      = document.getElementById('signup-btn');

      btn.disabled = true; btn.textContent = 'Creating account…';
      const result = await Auth.signup({ name, email, password });
      btn.disabled = false; btn.textContent = 'Create account';

      if (result.ok) {
        Toast.success('Account created!', 'Welcome to TabsFlow.');
        Router.go('app', 'dashboard');
      } else {
        this._showFormError('signup-error', result.error);
      }
    });

    /* ── Auth screen switches ── */
    document.getElementById('go-signup')?.addEventListener('click', () => Router.go('signup'));
    document.getElementById('go-login')?.addEventListener('click',  () => Router.go('login'));

    /* ── Password toggles ── */
    document.querySelectorAll('.password-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.previousElementSibling;
        const isText = input.type === 'text';
        input.type = isText ? 'password' : 'text';
        btn.innerHTML = `<i class="fas fa-eye${isText ? '' : '-slash'}"></i>`;
      });
    });

    /* ── Sidebar nav items ── */
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        if (page) Router.showPage(page);
        // Close sidebar on mobile
        if (window.innerWidth < 900) {
          document.getElementById('sidebar').classList.remove('open');
          document.getElementById('sidebar-overlay').classList.remove('active');
        }
      });
    });

    /* ── Logout ── */
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      Toast.info('Signed out', 'See you soon!');
      setTimeout(() => Auth.logout(), 1000);
    });

    /* ── Mobile burger ── */
    document.getElementById('burger-btn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('active');
    });
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('active');
    });

    /* ── Upgrade button ── */
    document.querySelectorAll('[data-action="go-upgrade"]').forEach(btn => {
      btn.addEventListener('click', () => Router.showPage('upgrade'));
    });

    /* ── "Get Premium" from pricing card ── */
    document.getElementById('btn-get-premium')?.addEventListener('click', () => {
      Router.showPage('payment');
    });

    /* ── "I have paid" button ── */
    document.getElementById('btn-paid')?.addEventListener('click', async () => {
      const user = Auth.getCurrentUser();
      if (!user) return;
      const phone = document.getElementById('pay-phone')?.value?.trim() || CONFIG.MOMO_NUMBER;
      const btn   = document.getElementById('btn-paid');
      btn.disabled = true; btn.textContent = 'Submitting…';

      const result = await Subs.submitPaymentRequest(user.id, { phone, referenceNote: '' });
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Submitted!';

      if (result.ok) {
        Toast.success('Payment submitted!', `Reference: ${result.reference}. Awaiting admin approval.`);
        App.updateSidebar();
        setTimeout(() => {
          Router.showPage('dashboard');
        }, 2000);
      } else {
        Toast.error('Error', 'Could not submit. Please try again.');
      }
    });

    /* ── Copy reference ── */
    document.getElementById('btn-copy-ref')?.addEventListener('click', () => {
      const ref = document.getElementById('payment-ref-code')?.textContent;
      if (ref) {
        navigator.clipboard.writeText(ref).catch(() => {});
        Toast.info('Copied!', `Reference ${ref} copied to clipboard.`);
      }
    });

    /* ── Profile save ── */
    document.getElementById('btn-save-profile')?.addEventListener('click', () => {
      const user = Auth.getCurrentUser();
      if (!user) return;
      const users = Store.get('users', {});
      const u = users[user.email];
      if (u) {
        u.name     = document.getElementById('prof-name')?.value?.trim() || u.name;
        u.location = document.getElementById('prof-location')?.value?.trim() || u.location;
        users[user.email] = u;
        Store.set('users', users);
        App.updateSidebar();
        Toast.success('Profile saved', 'Your changes have been saved.');
      }
    });

    /* ── Change password (UI demo) ── */
    document.getElementById('btn-change-password')?.addEventListener('click', () => {
      Toast.info('Coming soon', 'Password change will be available in the next release.');
    });

    /* ── Demo: instant premium (for testing) ── */
    document.getElementById('btn-demo-premium')?.addEventListener('click', () => {
      const user = Auth.getCurrentUser();
      if (!user) return;
      const sub = Subs.get(user.id);
      sub.status    = 'active';
      sub.plan      = 'premium';
      sub.startedAt = Utils.now();
      sub.expiresAt = Utils.daysFromNow(30);
      Store.userSet(user.id, 'sub', sub);
      Toast.success('🎉 Demo Premium activated!', 'All features unlocked for 30 days.');
      App.updateSidebar();
      Dashboard.initialized = false;
      Dashboard.init();
      Tabs.init(true);
    });

    /* ── Create demo admin account ── */
    document.getElementById('btn-demo-admin')?.addEventListener('click', async () => {
      const result = await Auth.signup({
        name: 'Admin TabsFlow',
        email: 'admin@tabsflow.com',
        password: 'admin123456',
      });
      if (result.ok || result.error?.includes('already')) {
        const login = await Auth.login({ email: 'admin@tabsflow.com', password: 'admin123456' });
        if (login.ok) {
          Toast.success('Admin account created', 'Logged in as Admin.');
          Router.go('app', 'admin');
        }
      }
    });
  },

  _showFormError(id, msg) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
  },
};

/* ═══════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  Toast.init();
  Events.init();

  // Route to correct initial screen
  if (Auth.isLoggedIn()) {
    Router.go('app', 'dashboard');
  } else {
    Router.go('login');
  }
});

// Expose globally for HTML onclick attributes (admin panel)
window.Admin = Admin;

const supabase = supabase.createClient(
  "https://pnakekhvtukfdzjlvosh.supabase.co",
  "sb_publishable_NFLhc9uxiwXMbX43NczfCg_FBom98vW"
);

const isPremium = await checkSubscription(user);

if (!isPremium) {
  document.querySelector("#premiumContent").style.filter = "blur(5px)";
}


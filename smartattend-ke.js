
'use strict';

/* ─── Demo Students ───────────────────────────────── */
const DEMO_STUDENTS = [
  { id: 'S1001', name: 'Alice Mwangi',  laptop: 'Dell Inspiron' },
  { id: 'S1002', name: 'James Otieno',  laptop: 'HP EliteBook'  },
  { id: 'S1003', name: 'Grace Njeri',   laptop: ''              },
];

/* ─── State ───────────────────────────────────────── */
let allRecords    = [];
let filteredRecs  = [];
let db            = null;
let auth          = null;
let fbReady       = false;
let isAdminView   = false;

/* ─── Token Generator ─────────────────────────────── */
function generateToken() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
    .toUpperCase()
    .slice(0, 10);
}

/* ─── Avatar SVG ──────────────────────────────────── */
function makeAvatar(name) {
  const initials = name
    .split(' ')
    .map(w => w[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const colors = ['#003366', '#004080', '#005599', '#C8971A', '#16A34A'];
  const bg = colors[name.charCodeAt(0) % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <rect width="80" height="80" rx="8" fill="${bg}"/>
    <text x="40" y="52" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="700" fill="#FFFFFF">${initials}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

/* ─── localStorage Helpers ────────────────────────── */
const LS_KEY = 'smartattendke_signins';

function lsGet() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

function lsSave(records) {
  localStorage.setItem(LS_KEY, JSON.stringify(records.slice(-50)));
}

function lsAdd(record) {
  const records = lsGet();
  records.push(record);
  lsSave(records);
}

/* ─── Firebase Init ───────────────────────────────── */
function initFirebase() {
  try {
    if (typeof firebaseConfig === 'undefined') {
      throw new Error('firebase-config.js not loaded');
    }
    const cfg = firebaseConfig;
    if (!cfg.apiKey || cfg.apiKey.includes('PASTE_YOUR')) {
      throw new Error('Firebase keys not configured');
    }
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    db   = firebase.firestore();
    auth = firebase.auth();
    fbReady = true;
    setFbStatus('green', 'Firebase connected — records saving to cloud');

    auth.onAuthStateChanged(user => {
      if (user) showAdminDashboard(user);
      else      showAdminLogin();
    });
  } catch (err) {
    fbReady = false;
    const isNotConfigured = err.message.includes('not configured') || err.message.includes('not loaded');
    setFbStatus('amber', 'Firebase not configured — using browser storage');
    if (isNotConfigured) {
      const note = document.getElementById('firebase-not-configured-note');
      if (note) note.style.display = 'block';
    } else {
      setFbStatus('red', 'Firebase error — using browser storage');
    }
    console.warn('[SmartAttendKE] Firebase init failed:', err.message);
  }
  
  // Initialize connection monitoring after Firebase setup
  initConnectionMonitor();
}

function setFbStatus(color, text) {
  const dot  = document.getElementById('fb-dot');
  const span = document.getElementById('fb-status-text');
  if (!dot || !span) return;
  const map = { green: '#16A34A', amber: '#D97706', red: '#DC2626' };
  dot.style.background = map[color] || '#9CA3AF';
  span.textContent = text;
}

/* ─── Connection Status Monitor ───────────────────── */
function initConnectionMonitor() {
  const statusDiv = document.getElementById('connectionStatus');
  if (!statusDiv) return;

  function updateStatus() {
    if (!navigator.onLine) {
      showConnectionStatus('offline', '⚠️ Offline mode — sign-ins will sync when connection returns');
    } else {
      // Check Firebase specifically if available
      if (fbReady && db) {
        showConnectionStatus('connecting', 'Connecting to server...');
        // Test actual Firebase connection
        db.collection('signins').limit(1).get()
          .then(() => showConnectionStatus('online', '✓ Connected'))
          .catch(() => showConnectionStatus('offline', '⚠️ Server unavailable — using local storage'));
      } else {
        showConnectionStatus('online', '✓ Connected (local mode)');
      }
    }
  }

  function showConnectionStatus(type, message) {
    statusDiv.className = type;
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
    
    // Auto-hide online status after delay
    if (type === 'online') {
      setTimeout(() => {
        if (statusDiv.className === 'online') {
          statusDiv.style.display = 'none';
        }
      }, 3000);
    }
  }

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  
  // Initial check
  updateStatus();
  
  // Periodic check every 30 seconds when online
  setInterval(() => {
    if (navigator.onLine && fbReady) {
      db.collection('signins').limit(1).get()
        .catch(() => showConnectionStatus('offline', '⚠️ Connection lost — using local storage'));
    }
  }, 30000);
}

/* ─── Save Record ─────────────────────────────────── */
async function saveRecord(record) {
  lsAdd(record);
  if (fbReady && db) {
    try {
      await db.collection('signins').add(record);
    } catch (err) {
      console.warn('[SmartAttendKE] Firestore write error:', err.message);
      // Queue for retry if offline
      queueForRetry(record);
    }
  }
}

/* ─── Offline Queue (simple) ──────────────────────── */
function queueForRetry(record) {
  const queue = JSON.parse(localStorage.getItem('smartattendke_pending') || '[]');
  queue.push(record);
  localStorage.setItem('smartattendke_pending', JSON.stringify(queue));
}

/* ─── Load All Records ────────────────────────────── */
async function loadRecords() {
  if (fbReady && db) {
    try {
      const snap = await db.collection('signins')
        .orderBy('timestamp', 'desc')
        .limit(200)
        .get();
      allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return;
    } catch (err) {
      console.warn('[SmartAttendKE] Firestore read error:', err.message);
    }
  }
  allRecords = lsGet().reverse();
}

/* ─── Sign-In Form ────────────────────────────────── */
function setupSignInForm() {
  const form   = document.getElementById('signin-form');
  const status = document.getElementById('signin-status');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const sid    = document.getElementById('student-id').value.trim();
    const sname  = document.getElementById('student-name').value.trim();
    const laptop = document.getElementById('laptop-make').value.trim();

    if (!sid || !sname) {
      showStatus(status, 'error', 'Please fill in Student ID and Full Name.');
      return;
    }

    // Validation: Student ID format
    if (!/^[A-Za-z0-9-]+$/.test(sid)) {
      showStatus(status, 'error', 'Student ID can only contain letters, numbers, and hyphens.');
      return;
    }

    // Duplicate check
    const today = new Date().toLocaleDateString('en-KE');
    const existing = lsGet().find(r => r.studentId === sid && r.date === today);
    if (existing) {
      const go = confirm(`${sname} already signed in today at ${existing.time}.\nSign in again anyway?`);
      if (!go) return;
    }

    // Check if returning student
    const allLs = lsGet();
    const returning = allLs.some(r => r.studentId === sid);
    if (returning) {
      showWelcomeBack(sname);
    }

    const token = generateToken();
    const now   = new Date();
    const record = {
      token,
      studentId: sid,
      name:      sname,
      laptop:    laptop || '—',
      time:      now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
      date:      today,
      timestamp: Date.now(),
    };

    await saveRecord(record);

    // Generate codes with mobile optimization
    generateBarcode(token);
    generateQRCode(token);

    // Show avatar
    document.getElementById('student-photo').src = makeAvatar(sname);
    document.getElementById('student-photo-info').innerHTML =
      `<p><strong>${sname}</strong><br/>ID: ${sid}${laptop ? `<br/>Laptop: ${laptop}` : ''}</p>`;

    // Show actions with animation
    const actions = document.getElementById('barcode-actions');
    actions.classList.add('visible');

    // Update counters
    updateCounters();

    showStatus(status, 'success', fbReady
      ? `✓ Signed in & saved to cloud — Token: ${token}`
      : `✓ Signed in (saved locally) — Token: ${token}`
    );

    form.reset();
    updateStats();
    
    // Scroll to code output on mobile
    if (window.innerWidth <= 480) {
      document.getElementById('barcode-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

/* ─── Barcode ─────────────────────────────────────── */
function generateBarcode(token) {
  const wrap = document.getElementById('student-barcode');
  wrap.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'barcode-svg';
  wrap.appendChild(svg);
  try {
    JsBarcode('#barcode-svg', token, {
      format:      'CODE128',
      lineColor:   '#001f3f',
      width:       2,
      height:      80,  // Increased for better scanning
      displayValue: false,
      margin:      10,  // Add margin for quiet zone
    });
    document.getElementById('barcode-token').textContent = 'Token: ' + token;
    document.getElementById('qrcode-token').textContent  = 'Token: ' + token;
    
    // Ensure SVG is responsive
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  } catch (err) {
    wrap.innerHTML = '<p style="color:red;font-size:0.8rem">Barcode error</p>';
  }
}

/* ─── QR Code with Center Logo ────────────────────── */
function generateQRCode(token) {
  const wrap = document.getElementById('student-qrcode');
  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  try {
    QRCode.toCanvas(canvas, token, {
      width:            200,
      margin:           4,  // Increased margin for quiet zone
      errorCorrectionLevel: 'H',
      color: { dark: '#001f3f', light: '#FFFFFF' }
    }, function(err) {
      if (err) {
        wrap.innerHTML = '<p style="color:red;font-size:0.8rem">QR error</p>';
        return;
      }
      // Draw SmartAttend KE logo in center
      const ctx    = canvas.getContext('2d');
      const size   = canvas.width;
      const logo   = new Image();
      logo.crossOrigin = 'anonymous';
      logo.src = 'https://upload.wikimedia.org/wikipedia/en/5/54/Africa_Nazarene_University_Logo.png';
      logo.onload = function() {
        const logoSize = size * 0.22;
        const logoX    = (size - logoSize) / 2;
        const logoY    = (size - logoSize) / 2;
        // White background circle behind logo
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, logoSize / 2 + 6, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        // Draw logo
        ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
      };
      logo.onerror = function() {
        // Fallback: draw SmartAttend KE text in center if image fails
        const logoSize = size * 0.22;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, logoSize / 2 + 6, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.fillStyle = '#001f3f';
        ctx.font = `bold ${size * 0.07}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SA', size / 2, size / 2);
      };
    });
  } catch (err) {
    wrap.innerHTML = '<p style="color:red;font-size:0.8rem">QR error</p>';
  }
}

/* ─── Code Tabs ───────────────────────────────────── */
function setupCodeTabs() {
  document.querySelectorAll('.code-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('barcode-panel').style.display = target === 'barcode' ? '' : 'none';
      document.getElementById('qrcode-panel').style.display  = target === 'qrcode'  ? '' : 'none';
    });
  });
}

/* ─── Download / Print ────────────────────────────── */
function setupBarcodeActions() {
  document.getElementById('print-barcode-btn').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('download-barcode-btn').addEventListener('click', () => {
    const active = document.querySelector('.code-tab.active').dataset.tab;
    if (active === 'barcode') {
      const svg = document.getElementById('barcode-svg');
      if (!svg) return;
      
      // Create high-res PNG from SVG for better printing
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = function() {
        canvas.width = img.width * 2;  // High res
        canvas.height = img.height * 2;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `SmartAttendKE-barcode-${Date.now()}.png`;
        a.click();
      };
      
      img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
    } else {
      const canvas = document.querySelector('#student-qrcode canvas');
      if (!canvas) return;
      const a    = document.createElement('a');
      a.href     = canvas.toDataURL('image/png');
      a.download = `SmartAttendKE-qrcode-${Date.now()}.png`;
      a.click();
    }
  });
}

/* ─── Demo Students ───────────────────────────────── */
function setupDemo() {
  const sel = document.getElementById('demo-select');
  DEMO_STUDENTS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = JSON.stringify(s);
    opt.textContent = `${s.name} (${s.id})`;
    sel.appendChild(opt);
  });
  document.getElementById('fill-demo-btn').addEventListener('click', () => {
    if (!sel.value) return;
    const s = JSON.parse(sel.value);
    document.getElementById('student-id').value   = s.id;
    document.getElementById('student-name').value  = s.name;
    document.getElementById('laptop-make').value   = s.laptop;
    
    // Trigger validation styling
    document.getElementById('student-id').dispatchEvent(new Event('input'));
    document.getElementById('student-name').dispatchEvent(new Event('input'));
  });
}

/* ─── Welcome Banner ──────────────────────────────── */
function showWelcomeBack(name) {
  const banner = document.getElementById('welcome-banner');
  banner.textContent = `Welcome back, ${name}! `;
  banner.classList.add('visible');
  setTimeout(() => { 
    banner.classList.remove('visible');
    setTimeout(() => { banner.style.display = 'none'; }, 300);
  }, 4000);
}

/* ─── Status Helper ───────────────────────────────── */
function showStatus(el, type, msg) {
  el.className = 'status ' + type;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ─── Update Counters ───────────────────────────── */
function updateCounters() {
  const today    = new Date().toLocaleDateString('en-KE');
  const records  = lsGet();
  const todayRecs = records.filter(r => r.date === today);
  document.getElementById('hero-count').textContent    = todayRecs.length;
  document.getElementById('summary-count').textContent = records.length;
  const last = records[records.length - 1];
  document.getElementById('summary-last').textContent  = last ? last.name : 'None';
}

/* ─── Statistics ──────────────────────────────────── */
async function updateStats() {
  await loadRecords();
  const records = allRecords;
  const today   = new Date().toLocaleDateString('en-KE');

  document.getElementById('stat-total').textContent = records.length;
  document.getElementById('stat-today').textContent = records.filter(r => r.date === today).length;

  const uniqueIds = new Set(records.map(r => r.studentId));
  document.getElementById('stat-unique').textContent = uniqueIds.size;

  // Peak hour
  const hourCounts = {};
  records.forEach(r => {
    const h = r.time ? r.time.split(':')[0] : null;
    if (h) hourCounts[h] = (hourCounts[h] || 0) + 1;
  });
  const peakH = Object.keys(hourCounts).sort((a, b) => hourCounts[b] - hourCounts[a])[0];
  document.getElementById('stat-peak').textContent = peakH ? `${peakH}:00` : '—';

  // Top students
  const studentCounts = {};
  const studentNames  = {};
  records.forEach(r => {
    studentCounts[r.studentId] = (studentCounts[r.studentId] || 0) + 1;
    studentNames[r.studentId]  = r.name;
  });
  const top = Object.keys(studentCounts)
    .sort((a, b) => studentCounts[b] - studentCounts[a])
    .slice(0, 5);

  const maxCount = top.length ? studentCounts[top[0]] : 1;
  const list = document.getElementById('top-students-list');
  if (!top.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = top.map((id, i) => `
    <div class="top-student-row">
      <span class="top-rank">${i + 1}</span>
      <span class="top-name">${studentNames[id]}</span>
      <span class="top-id">${id}</span>
      <div class="top-bar-wrap">
        <div class="top-bar" style="width:${Math.round(studentCounts[id] / maxCount * 100)}%"></div>
      </div>
      <span class="top-count">${studentCounts[id]}</span>
    </div>
  `).join('');
}

/* ─── Student Lookup ──────────────────────────────── */
function setupLookup() {
  document.getElementById('lookup-btn').addEventListener('click', doLookup);
  document.getElementById('lookup-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLookup();
  });
}

async function doLookup() {
  const query  = document.getElementById('lookup-input').value.trim().toUpperCase();
  const result = document.getElementById('lookup-result');
  if (!query) {
    result.innerHTML = '';
    return;
  }

  await loadRecords();
  const match = allRecords.find(r =>
    (r.token     && r.token.toUpperCase()     === query) ||
    (r.studentId && r.studentId.toUpperCase() === query)
  );

  if (!match) {
    result.innerHTML = `<p class="lookup-empty">No record found for "${query}".</p>`;
    return;
  }

  result.innerHTML = `
    <div class="lookup-card">
      <div class="lookup-card-row"><strong>Name</strong><br/>${match.name}</div>
      <div class="lookup-card-row"><strong>Student ID</strong><br/>${match.studentId}</div>
      <div class="lookup-card-row"><strong>Token</strong><br/>${match.token}</div>
      <div class="lookup-card-row"><strong>Laptop</strong><br/>${match.laptop || '—'}</div>
      <div class="lookup-card-row"><strong>Date</strong><br/>${match.date}</div>
      <div class="lookup-card-row"><strong>Time</strong><br/>${match.time}</div>
    </div>
  `;
}

/* ─── Admin Toggle & Security ───────────────────────── */
function setupAdminToggle() {
  // Create toggle button if it doesn't exist
  let toggleBtn = document.getElementById('adminToggleBtn');
  if (!toggleBtn) {
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'adminToggleBtn';
    toggleBtn.className = 'admin-toggle';
    toggleBtn.innerHTML = '<span>🔐</span> Admin';
    toggleBtn.setAttribute('aria-label', 'Toggle admin login');
    toggleBtn.onclick = toggleAdminView;
    document.body.appendChild(toggleBtn);
  }
}

function toggleAdminView() {
  const studentSection = document.getElementById('studentSection');
  const adminSection = document.getElementById('adminSection');
  const btn = document.getElementById('adminToggleBtn');

  if (!studentSection || !adminSection || !btn) return;
  isAdminView = !isAdminView;

  if (isAdminView) {
    studentSection.style.display = 'none';
    adminSection.style.display = '';
    btn.classList.add('active');
    btn.innerHTML = '<span>←</span> Back';

    setTimeout(() => {
      const emailInput = document.getElementById('admin-email');
      if (emailInput) {
        emailInput.focus();
        emailInput.select();
      }
    }, 100);

    window.location.hash = 'admin';
  } else {
    adminSection.style.display = 'none';
    studentSection.style.display = '';
    btn.classList.remove('active');
    btn.innerHTML = '<span>🔐</span> Admin';

    if (window.location.hash === '#admin') {
      history.replaceState(null, '', window.location.pathname);
    }
  }
}

function showAdminLogin() {
  const loginPanel = document.getElementById('admin-login-panel');
  const dashboard = document.getElementById('admin-dashboard');
  const emailBadge = document.getElementById('admin-email-display');
  const errorBox = document.getElementById('login-error');

  if (loginPanel) loginPanel.style.display = '';
  if (dashboard) dashboard.style.display = 'none';
  if (emailBadge) emailBadge.textContent = '';
  if (errorBox) errorBox.textContent = '';
}

function showAdminDashboard(user) {
  const loginPanel = document.getElementById('admin-login-panel');
  const dashboard = document.getElementById('admin-dashboard');
  const emailBadge = document.getElementById('admin-email-display');

  if (loginPanel) loginPanel.style.display = 'none';
  if (dashboard) dashboard.style.display = '';
  if (emailBadge) emailBadge.textContent = user?.email || 'Admin';

  if (!isAdminView) toggleAdminView();
  loadAdminRecords();
}

async function adminLogin() {
  const email = document.getElementById('admin-email')?.value.trim();
  const password = document.getElementById('admin-password')?.value.trim();
  const errorBox = document.getElementById('login-error');

  if (!email || !password) {
    if (errorBox) errorBox.textContent = 'Enter your admin email and password.';
    return;
  }

  if (!auth) {
    if (errorBox) errorBox.textContent = 'Firebase authentication not ready.';
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    if (errorBox) errorBox.textContent = err.message || 'Login failed. Please check your credentials.';
  }
}

async function adminLogout() {
  if (!auth) return;
  try {
    await auth.signOut();
    showAdminLogin();
  } catch (err) {
    console.warn('[SmartAttendKE] Admin logout error:', err.message);
  }
}

async function loadAdminRecords() {
  await loadRecords();
  filteredRecs = [...allRecords];
  renderAdminRecords(filteredRecs);
  updateStats();
}

function renderAdminRecords(records) {
  const tbody = document.querySelector('#admin-records-table tbody');
  if (!tbody) return;

  if (!records.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;color:var(--grey-400);padding:1.5rem">
          No sign-in records found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map((record, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${record.token || '—'}</td>
      <td>${record.studentId || '—'}</td>
      <td>${record.name || '—'}</td>
      <td>${record.laptop || '—'}</td>
      <td>${record.time || '—'}</td>
      <td>${record.date || '—'}</td>
    </tr>
  `).join('');
}

function applyAdminFilters() {
  const query = document.getElementById('admin-search')?.value.trim().toUpperCase();
  const date = document.getElementById('admin-date-filter')?.value;

  filteredRecs = allRecords.filter(record => {
    const matchesQuery = !query || [record.studentId, record.name, record.token].some(value => value?.toString().toUpperCase().includes(query));
    const matchesDate = !date || record.date === date;
    return matchesQuery && matchesDate;
  });

  renderAdminRecords(filteredRecs);
}

function exportCsv() {
  const records = filteredRecs.length ? filteredRecs : allRecords;
  if (!records.length) return;

  const rows = [
    ['Token', 'Student ID', 'Name', 'Laptop', 'Time', 'Date', 'Timestamp'],
    ...records.map(r => [r.token || '', r.studentId || '', r.name || '', r.laptop || '', r.time || '', r.date || '', r.timestamp || ''])
  ];

  const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SmartAttendKE-signins-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function printSheet() {
  window.print();
}

async function clearAllRecords() {
  if (!confirm('Clear local browser sign-in records? This does not delete Firestore data.')) return;
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem('smartattendke_pending');
  await loadRecords();
  updateCounters();
  updateStats();
  renderAdminRecords(allRecords);
  const note = document.getElementById('admin-source-note');
  if (note) note.textContent = 'Local browser attendance history cleared. Firestore records remain intact.';
}

function setupAdminActions() {
  document.getElementById('admin-login-btn')?.addEventListener('click', adminLogin);
  document.getElementById('admin-logout-btn')?.addEventListener('click', adminLogout);
  document.getElementById('refresh-records-btn')?.addEventListener('click', loadAdminRecords);
  document.getElementById('export-csv-btn')?.addEventListener('click', exportCsv);
  document.getElementById('print-sheet-btn')?.addEventListener('click', printSheet);
  document.getElementById('clear-records-btn')?.addEventListener('click', clearAllRecords);
  document.getElementById('admin-search')?.addEventListener('input', applyAdminFilters);
  document.getElementById('admin-date-filter')?.addEventListener('change', applyAdminFilters);
  document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
    const search = document.getElementById('admin-search');
    const date = document.getElementById('admin-date-filter');
    if (search) search.value = '';
    if (date) date.value = '';
    applyAdminFilters();
  });
}

function setupThemeToggle() {
  const toggle = document.getElementById('dark-toggle');
  if (!toggle) return;
  const initialTheme = localStorage.getItem('smartattendke_theme') || 'light';
  document.documentElement.setAttribute('data-theme', initialTheme);
  toggle.textContent = initialTheme === 'dark' ? '☀️' : '🌙';

  toggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('smartattendke_theme', nextTheme);
    toggle.textContent = nextTheme === 'dark' ? '☀️' : '🌙';
  });
}

function setupNavToggle() {
  const navToggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');

  navToggle?.addEventListener('click', () => {
    navLinks?.classList.toggle('open');
  });

  document.querySelectorAll('#nav-links a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks?.classList.remove('open');
    });
  });
}

function initApp() {
  setupSignInForm();
  setupCodeTabs();
  setupBarcodeActions();
  setupDemo();
  setupLookup();
  setupAdminToggle();
  setupAdminActions();
  setupThemeToggle();
  setupNavToggle();
  updateCounters();
  updateStats();
  initFirebase();

  if (window.location.hash === '#admin') {
    toggleAdminView();
  }
}

document.addEventListener('DOMContentLoaded', initApp);

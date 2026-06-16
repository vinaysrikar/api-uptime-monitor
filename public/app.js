// Global State
let token = localStorage.getItem('token') || null;
let currentUser = null;
let monitorsList = [];
let activeTab = 'monitors';
let selectedMonitorId = null;
let chartInstance = null;

// Email Verification Cooldown States
let verifyEmailAddress = '';
let resendCooldownTimer = 0;
let resendInterval = null;

// API Fetch Wrapper
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers
  };

  const response = await fetch(endpoint, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // Clear expired auth session
      logout();
    }
    // Handle unverified status cleanly
    if (data.requiresVerification) {
      const err = new Error(data.message || 'Verification required');
      err.requiresVerification = true;
      err.email = data.email;
      throw err;
    }
    throw new Error(data.message || 'Something went wrong');
  }
  return data;
}

// ==========================================================================
// Time Helpers
// ==========================================================================

function timeAgo(dateString) {
  if (!dateString) return 'Never';
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDateTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// ==========================================================================
// Auth Views & Actions
// ==========================================================================

function checkAuth() {
  if (token) {
    apiFetch('/api/auth/me')
      .then(res => {
        currentUser = res.user;
        document.getElementById('username-display').innerText = currentUser.name;
        document.getElementById('user-nav').classList.remove('hidden');
        showView('dashboard');
        fetchMonitors();
      })
      .catch(err => {
        console.error('Session restoration failed:', err);
        logout();
      });
  } else {
    showView('landing');
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  document.getElementById('user-nav').classList.add('hidden');
  showView('landing');
}

function showView(viewName) {
  const landingView = document.getElementById('view-landing');
  const authView = document.getElementById('view-auth');
  const verifyView = document.getElementById('view-verify');
  const dashboardView = document.getElementById('view-dashboard');

  landingView.classList.add('hidden');
  authView.classList.add('hidden');
  verifyView.classList.add('hidden');
  dashboardView.classList.add('hidden');

  if (viewName === 'landing') {
    landingView.classList.remove('hidden');
  } else if (viewName === 'auth') {
    authView.classList.remove('hidden');
  } else if (viewName === 'verify') {
    verifyView.classList.remove('hidden');
  } else if (viewName === 'dashboard') {
    dashboardView.classList.remove('hidden');
  }
  lucide.createIcons();
}

// Toggle Register / Login forms
const linkToggleAuth = document.getElementById('link-toggle-auth');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');

linkToggleAuth.addEventListener('click', (e) => {
  e.preventDefault();
  const isLoginVisible = !formLogin.classList.contains('hidden');
  
  if (isLoginVisible) {
    formLogin.classList.add('hidden');
    formRegister.classList.remove('hidden');
    authTitle.innerText = 'Create Account';
    authSubtitle.innerText = 'Register to monitor endpoints';
    linkToggleAuth.innerHTML = 'Sign in';
    document.getElementById('auth-toggle-text').firstChild.textContent = 'Already have an account? ';
  } else {
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
    authTitle.innerText = 'Welcome Back';
    authSubtitle.innerText = 'Login to monitor your API endpoints';
    linkToggleAuth.innerHTML = 'Sign up';
    document.getElementById('auth-toggle-text').firstChild.textContent = "Don't have an account? ";
  }
  
  // Clear any errors
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('register-error').classList.add('hidden');
  lucide.createIcons();
});

// Login Form Submit
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorAlert = document.getElementById('login-error');

  errorAlert.classList.add('hidden');

  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    document.getElementById('username-display').innerText = currentUser.name;
    document.getElementById('user-nav').classList.remove('hidden');
    
    // Reset inputs
    formLogin.reset();
    showView('dashboard');
    fetchMonitors();
  } catch (err) {
    if (err.requiresVerification) {
      verifyEmailAddress = err.email || email;
      document.getElementById('verify-email-display').innerText = verifyEmailAddress;
      formLogin.reset();
      showView('verify');
    } else {
      errorAlert.innerText = err.message;
      errorAlert.classList.remove('hidden');
    }
  }
});

// Register Form Submit
formRegister.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('register-name').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const errorAlert = document.getElementById('register-error');

  errorAlert.classList.add('hidden');

  try {
    await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });

    // Go to Verification View
    verifyEmailAddress = email;
    document.getElementById('verify-email-display').innerText = verifyEmailAddress;
    formRegister.reset();
    showView('verify');
  } catch (err) {
    if (err.requiresVerification) {
      verifyEmailAddress = err.email || email;
      document.getElementById('verify-email-display').innerText = verifyEmailAddress;
      formRegister.reset();
      showView('verify');
    } else {
      errorAlert.innerText = err.message;
      errorAlert.classList.remove('hidden');
    }
  }
});

// Verification Form Submit
const formVerify = document.getElementById('form-verify');
formVerify.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('verify-code').value;
  const errorAlert = document.getElementById('verify-error');

  errorAlert.classList.add('hidden');

  try {
    const data = await apiFetch('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email: verifyEmailAddress, code })
    });

    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    document.getElementById('username-display').innerText = currentUser.name;
    document.getElementById('user-nav').classList.remove('hidden');

    formVerify.reset();
    showView('dashboard');
    fetchMonitors();
  } catch (err) {
    errorAlert.innerText = err.message;
    errorAlert.classList.remove('hidden');
  }
});

// Resend Verification Code
const btnResendCode = document.getElementById('btn-resend-code');
const resendCooldown = document.getElementById('resend-cooldown');
btnResendCode.addEventListener('click', async () => {
  if (resendCooldownTimer > 0) return;

  try {
    await apiFetch('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email: verifyEmailAddress })
    });

    alert('Verification code resent successfully.');
    
    // Cooldown logic
    resendCooldownTimer = 60;
    btnResendCode.disabled = true;
    resendCooldown.innerText = `(${resendCooldownTimer}s)`;

    if (resendInterval) clearInterval(resendInterval);
    resendInterval = setInterval(() => {
      resendCooldownTimer--;
      if (resendCooldownTimer <= 0) {
        clearInterval(resendInterval);
        btnResendCode.disabled = false;
        resendCooldown.innerText = '';
      } else {
        resendCooldown.innerText = `(${resendCooldownTimer}s)`;
      }
    }, 1000);

  } catch (err) {
    alert('Failed to resend code: ' + err.message);
  }
});

// Back to login from verify screen
document.getElementById('link-back-login').addEventListener('click', (e) => {
  e.preventDefault();
  showView('auth');
});

// Landing Page CTA Buttons
document.getElementById('btn-landing-get-started').addEventListener('click', () => {
  showView('auth');
  // Trigger Register form view
  formLogin.classList.add('hidden');
  formRegister.classList.remove('hidden');
  authTitle.innerText = 'Create Account';
  authSubtitle.innerText = 'Register to monitor endpoints';
  linkToggleAuth.innerHTML = 'Sign in';
  document.getElementById('auth-toggle-text').firstChild.textContent = 'Already have an account? ';
});

document.getElementById('btn-landing-login').addEventListener('click', () => {
  showView('auth');
  // Trigger Login form view
  formLogin.classList.remove('hidden');
  formRegister.classList.add('hidden');
  authTitle.innerText = 'Welcome Back';
  authSubtitle.innerText = 'Login to monitor your API endpoints';
  linkToggleAuth.innerHTML = 'Sign up';
  document.getElementById('auth-toggle-text').firstChild.textContent = "Don't have an account? ";
});

// Logo Click behavior
document.getElementById('logo-click-area').addEventListener('click', () => {
  if (currentUser) {
    showView('dashboard');
  } else {
    showView('landing');
  }
});

document.getElementById('btn-logout').addEventListener('click', logout);

// ==========================================================================
// Dashboard Logic (Monitors & Statistics)
// ==========================================================================

async function fetchMonitors() {
  const listContainer = document.getElementById('monitors-list');
  try {
    const data = await apiFetch('/api/monitors');
    monitorsList = data.monitors || [];
    calculateStats();
    renderMonitorsList();
  } catch (err) {
    console.error('Error fetching monitors:', err);
    listContainer.innerHTML = `
      <div class="empty-state">
        <i data-lucide="alert-triangle" class="empty-state-icon" style="color: var(--error)"></i>
        <p>Failed to retrieve endpoints. Make sure your server is online.</p>
      </div>
    `;
    lucide.createIcons();
  }
}

function calculateStats() {
  const total = monitorsList.length;
  const up = monitorsList.filter(m => m.status === 'UP' && m.is_active).length;
  const down = monitorsList.filter(m => m.status === 'DOWN' && m.is_active).length;
  
  // Calculate average uptime of active monitors
  const activeMonitors = monitorsList.filter(m => m.is_active);
  let avgUptime = 100.00;
  if (activeMonitors.length > 0) {
    const sumUptime = activeMonitors.reduce((acc, m) => acc + m.uptime_percentage, 0);
    avgUptime = sumUptime / activeMonitors.length;
  }

  document.getElementById('stat-total').innerText = total;
  document.getElementById('stat-up').innerText = up;
  document.getElementById('stat-down').innerText = down;
  document.getElementById('stat-uptime').innerText = `${avgUptime.toFixed(2)}%`;
}

function renderMonitorsList(filterText = '') {
  const listContainer = document.getElementById('monitors-list');
  const searchInput = document.getElementById('search-monitors').value.toLowerCase();
  
  const filtered = monitorsList.filter(m => 
    m.name.toLowerCase().includes(searchInput) || 
    m.url.toLowerCase().includes(searchInput)
  );

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-open" class="empty-state-icon"></i>
        <p>${monitorsList.length === 0 ? "No monitors configured. Let's add one!" : "No monitors match your search filter."}</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  listContainer.innerHTML = filtered.map(monitor => {
    let statusBadgeClass = 'badge-pending';
    let statusText = 'Pending';
    
    if (!monitor.is_active) {
      statusBadgeClass = 'badge-paused';
      statusText = 'Paused';
    } else if (monitor.status === 'UP') {
      statusBadgeClass = 'badge-up';
      statusText = 'Online';
    } else if (monitor.status === 'DOWN') {
      statusBadgeClass = 'badge-down';
      statusText = 'Offline';
    }

    // Color code uptime percent
    let uptimeColorClass = 'color-green';
    if (monitor.uptime_percentage < 95) {
      uptimeColorClass = 'color-red';
    } else if (monitor.uptime_percentage < 99) {
      uptimeColorClass = 'color-yellow';
    }

    return `
      <div class="monitor-card glass-panel" onclick="openMonitorDetail(${monitor.id})">
        <div class="monitor-card-header">
          <div class="monitor-meta">
            <h3 class="monitor-name-title">${escapeHTML(monitor.name)}</h3>
            <span class="monitor-card-url">${escapeHTML(monitor.url)}</span>
          </div>
          <span class="badge ${statusBadgeClass}">
            <span class="status-indicator-dot ${monitor.is_active ? monitor.status : 'PAUSED'}"></span>
            ${statusText}
          </span>
        </div>
        
        <div class="monitor-metrics">
          <div class="metric-item">
            <span class="metric-label">Uptime %</span>
            <span class="metric-value ${uptimeColorClass}">${monitor.uptime_percentage.toFixed(2)}%</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">Latency</span>
            <span class="metric-value">${monitor.avg_response_time ? monitor.avg_response_time + ' ms' : '--'}</span>
          </div>
        </div>

        <div class="monitor-card-footer">
          <span class="last-checked-label">Last check: ${timeAgo(monitor.last_checked)}</span>
          
          <div class="card-actions">
            <!-- Toggle Active State -->
            <button class="btn btn-icon btn-toggle-active" 
                    title="${monitor.is_active ? 'Pause Monitoring' : 'Resume Monitoring'}"
                    onclick="toggleMonitorActive(event, ${monitor.id}, ${monitor.is_active})">
              <i data-lucide="${monitor.is_active ? 'pause' : 'play'}" style="width: 15px; height: 15px;"></i>
            </button>
            
            <!-- Manual Ping -->
            <button class="btn btn-icon btn-ping-now" 
                    title="Ping Now"
                    ${!monitor.is_active ? 'disabled' : ''}
                    onclick="triggerManualCheck(event, ${monitor.id}, this)">
              <i data-lucide="refresh-cw" style="width: 15px; height: 15px;"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// Real-time search filter
document.getElementById('search-monitors').addEventListener('input', () => {
  renderMonitorsList();
});

// Helper to escape HTML characters
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ==========================================================================
// Monitor Toggles & Actions
// ==========================================================================

async function toggleMonitorActive(event, id, currentActiveState) {
  event.stopPropagation(); // Avoid opening details modal
  try {
    await apiFetch(`/api/monitors/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !currentActiveState })
    });
    fetchMonitors();
  } catch (err) {
    alert('Failed to update monitor state: ' + err.message);
  }
}

async function triggerManualCheck(event, id, btnElement) {
  if (event) event.stopPropagation(); // Avoid opening details modal
  
  const icon = btnElement.querySelector('i');
  icon.classList.add('spin-animation');
  btnElement.disabled = true;

  try {
    await apiFetch(`/api/monitors/${id}/check`, { method: 'POST' });
    await fetchMonitors(); // Refresh list to fetch updated results
  } catch (err) {
    alert('Manual check failed: ' + err.message);
  } finally {
    icon.classList.remove('spin-animation');
    btnElement.disabled = false;
  }
}

// Add Spin animation class helper to stylesheet injection
const styleTag = document.createElement('style');
styleTag.innerHTML = `
  @keyframes spin-360 { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  .spin-animation { animation: spin-360 0.8s linear infinite; }
`;
document.head.appendChild(styleTag);

// ==========================================================================
// Tab Navigations (Monitors vs Incidents)
// ==========================================================================

const tabBtnMonitors = document.getElementById('tab-btn-monitors');
const tabBtnIncidents = document.getElementById('tab-btn-incidents');
const tabPaneMonitors = document.getElementById('tab-monitors');
const tabPaneIncidents = document.getElementById('tab-incidents');

tabBtnMonitors.addEventListener('click', () => {
  activeTab = 'monitors';
  tabBtnMonitors.classList.add('active');
  tabBtnIncidents.classList.remove('active');
  tabPaneMonitors.classList.remove('hidden');
  tabPaneIncidents.classList.add('hidden');
});

tabBtnIncidents.addEventListener('click', () => {
  activeTab = 'incidents';
  tabBtnIncidents.classList.add('active');
  tabBtnMonitors.classList.remove('active');
  tabPaneIncidents.classList.remove('hidden');
  tabPaneMonitors.classList.add('hidden');
  fetchIncidentsHistory();
});

async function fetchIncidentsHistory() {
  const timelineContainer = document.getElementById('incidents-timeline');
  timelineContainer.innerHTML = '<div class="spinner"></div>';

  try {
    const data = await apiFetch('/api/incidents');
    const incidents = data.incidents || [];

    if (incidents.length === 0) {
      timelineContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="check-circle-2" class="empty-state-icon" style="color: var(--success)"></i>
          <p>All clear! No incident events logged.</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    timelineContainer.innerHTML = incidents.map(inc => {
      const isResolved = inc.up_time !== null;
      const dotClass = isResolved ? 'UP' : 'DOWN';
      
      let detailsText = '';
      if (isResolved) {
        detailsText = `Resolved after <strong>${inc.duration_minutes}m</strong>. Back online.`;
      } else {
        detailsText = `Ongoing downtime event. Status: Offline.`;
      }

      return `
        <div class="timeline-item">
          <div class="timeline-dot ${dotClass}"></div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-title">${isResolved ? '✅ Resolved' : '🚨 Incident Alert'} — ${escapeHTML(inc.monitor_name)}</span>
              <span class="timeline-time">${isResolved ? formatDateTime(inc.up_time) : formatDateTime(inc.down_time)}</span>
            </div>
            <div class="timeline-details">${detailsText}</div>
            <span class="timeline-url">${escapeHTML(inc.monitor_url)}</span>
            ${inc.error_message ? `<div class="timeline-error-msg">${escapeHTML(inc.error_message)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    lucide.createIcons();
  } catch (err) {
    console.error('Error fetching incident history:', err);
    timelineContainer.innerHTML = '<p class="alert alert-error">Error loading incident history.</p>';
  }
}

// ==========================================================================
// Modal Handlers (Add and Details)
// ==========================================================================

const modalAdd = document.getElementById('modal-add');
const btnAddMonitor = document.getElementById('btn-add-monitor');
const formAddMonitor = document.getElementById('form-add-monitor');

// Close Modals buttons listeners
document.querySelectorAll('.btn-close-modal').forEach(btn => {
  btn.addEventListener('click', () => {
    modalAdd.classList.add('hidden');
    document.getElementById('modal-detail').classList.add('hidden');
    
    // Reset Add modal error
    document.getElementById('add-monitor-error').classList.add('hidden');
  });
});

// Open Add Modal
btnAddMonitor.addEventListener('click', () => {
  formAddMonitor.reset();
  modalAdd.classList.remove('hidden');
  document.getElementById('add-monitor-error').classList.add('hidden');
  lucide.createIcons();
});

// Submit Add Monitor
formAddMonitor.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('monitor-name').value;
  const url = document.getElementById('monitor-url').value;
  const errorAlert = document.getElementById('add-monitor-error');

  errorAlert.classList.add('hidden');

  try {
    await apiFetch('/api/monitors', {
      method: 'POST',
      body: JSON.stringify({ name, url })
    });

    modalAdd.classList.add('hidden');
    fetchMonitors(); // Reload
  } catch (err) {
    errorAlert.innerText = err.message;
    errorAlert.classList.remove('hidden');
  }
});

// Open Monitor Detail Modal
async function openMonitorDetail(id) {
  selectedMonitorId = id;
  const modal = document.getElementById('modal-detail');
  modal.classList.remove('hidden');
  lucide.createIcons();
  
  await refreshMonitorDetail();
}

async function refreshMonitorDetail() {
  if (!selectedMonitorId) return;

  try {
    const data = await apiFetch(`/api/monitors/${selectedMonitorId}`);
    const { monitor, checks, incidents } = data;

    // Fill Basic Details
    document.getElementById('detail-title').innerText = monitor.name;
    document.getElementById('detail-url').innerText = monitor.url;
    document.getElementById('detail-uptime').innerText = `${monitor.uptime_percentage.toFixed(2)}%`;
    document.getElementById('detail-latency').innerText = monitor.avg_response_time ? `${monitor.avg_response_time} ms` : '0 ms';
    
    // Status Badge
    const badge = document.getElementById('detail-status-badge');
    badge.className = 'badge'; // Reset classes
    if (!monitor.is_active) {
      badge.classList.add('badge-paused');
      badge.innerText = 'Paused';
      document.getElementById('btn-detail-check-now').disabled = true;
    } else if (monitor.status === 'UP') {
      badge.classList.add('badge-up');
      badge.innerText = 'Online';
      document.getElementById('btn-detail-check-now').disabled = false;
    } else if (monitor.status === 'DOWN') {
      badge.classList.add('badge-down');
      badge.innerText = 'Offline';
      document.getElementById('btn-detail-check-now').disabled = false;
    } else {
      badge.classList.add('badge-pending');
      badge.innerText = 'Pending';
      document.getElementById('btn-detail-check-now').disabled = false;
    }

    // Render Recent Checks Table
    const checksTbody = document.getElementById('checks-table-body');
    if (checks.length === 0) {
      checksTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No check logs yet. First check pending.</td></tr>`;
    } else {
      checksTbody.innerHTML = checks.slice().reverse().map(check => {
        const checkStatusClass = check.status === 'UP' ? 'badge-up' : 'badge-down';
        return `
          <tr>
            <td><span class="badge ${checkStatusClass}">${check.status}</span></td>
            <td><strong>${check.response_time_ms ? check.response_time_ms + ' ms' : '--'}</strong></td>
            <td><span class="text-monospace">${check.status_code || 'Err'}</span></td>
            <td>${formatDateTime(check.timestamp)}</td>
          </tr>
        `;
      }).join('');
    }

    // Render Incidents Table
    const incidentsTbody = document.getElementById('monitor-incidents-table-body');
    if (incidents.length === 0) {
      incidentsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No downtimes recorded. Great job!</td></tr>`;
    } else {
      incidentsTbody.innerHTML = incidents.map(inc => {
        return `
          <tr>
            <td style="color: var(--error)">${formatDateTime(inc.down_time)}</td>
            <td style="color: var(--success)">${formatDateTime(inc.up_time)}</td>
            <td><strong>${inc.duration_minutes ? inc.duration_minutes + ' m' : 'Ongoing'}</strong></td>
            <td><span class="text-monospace" style="font-size: 11px;">${escapeHTML(inc.error_message || 'Timeout')}</span></td>
          </tr>
        `;
      }).join('');
    }

    // Draw Response Latency Graph
    drawLatencyChart(checks);

  } catch (err) {
    alert('Failed to retrieve monitor details: ' + err.message);
    document.getElementById('modal-detail').classList.add('hidden');
  }
}

// Modal Detail sub tabs toggle (Checks vs Incidents)
const detTabChecks = document.getElementById('det-tab-checks');
const detTabIncidents = document.getElementById('det-tab-incidents');
const detPaneChecks = document.getElementById('det-pane-checks');
const detPaneIncidents = document.getElementById('det-pane-incidents');

detTabChecks.addEventListener('click', () => {
  detTabChecks.classList.add('active');
  detTabIncidents.classList.remove('active');
  detPaneChecks.classList.remove('hidden');
  detPaneIncidents.classList.add('hidden');
});

detTabIncidents.addEventListener('click', () => {
  detTabIncidents.classList.add('active');
  detTabChecks.classList.remove('active');
  detPaneIncidents.classList.remove('hidden');
  detPaneChecks.classList.add('hidden');
});

// Manual Check Now inside Details modal
document.getElementById('btn-detail-check-now').addEventListener('click', async function() {
  if (!selectedMonitorId) return;
  const btn = this;
  const icon = btn.querySelector('i');
  icon.classList.add('spin-animation');
  btn.disabled = true;

  try {
    await apiFetch(`/api/monitors/${selectedMonitorId}/check`, { method: 'POST' });
    await refreshMonitorDetail();
    fetchMonitors(); // Refresh list background
  } catch (err) {
    alert('Manual check failed: ' + err.message);
  } finally {
    icon.classList.remove('spin-animation');
    btn.disabled = false;
  }
});

// Delete monitor from Detail modal
document.getElementById('btn-detail-delete').addEventListener('click', async () => {
  if (!selectedMonitorId) return;
  
  const confirmDelete = confirm('Are you sure you want to delete this monitor and all history? This action is permanent.');
  if (!confirmDelete) return;

  try {
    await apiFetch(`/api/monitors/${selectedMonitorId}`, { method: 'DELETE' });
    document.getElementById('modal-detail').classList.add('hidden');
    selectedMonitorId = null;
    fetchMonitors();
  } catch (err) {
    alert('Failed to delete monitor: ' + err.message);
  }
});

// ==========================================================================
// Chart.js Latency Chart Rendering
// ==========================================================================

function drawLatencyChart(checks) {
  const ctx = document.getElementById('latency-chart').getContext('2d');
  
  if (chartInstance) {
    chartInstance.destroy(); // Clear existing instance
  }

  if (checks.length === 0) {
    return;
  }

  // Extract times and latencies
  const labels = checks.map(c => {
    const time = new Date(c.timestamp);
    return time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });
  
  const data = checks.map(c => c.status === 'UP' ? c.response_time_ms : null);

  const theme = document.documentElement.getAttribute('data-theme');
  const gridColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)';
  const labelColor = theme === 'dark' ? '#94a3b8' : '#475569';

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Latency (ms)',
        data: data,
        borderColor: '#6366f1',
        borderWidth: 2,
        backgroundColor: 'rgba(99, 102, 241, 0.04)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#6366f1',
        pointHoverRadius: 5,
        spanGaps: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: labelColor, maxRotation: 45, autoSkip: true, maxTicksLimit: 10 }
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: labelColor },
          title: { display: true, text: 'ms', color: labelColor }
        }
      }
    }
  });
}

// ==========================================================================
// Theme Toggler Layer
// ==========================================================================

const themeToggleBtn = document.getElementById('theme-toggle');

themeToggleBtn.addEventListener('click', () => {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  
  // Refresh chart grid lines color if it is open
  if (selectedMonitorId && chartInstance) {
    refreshMonitorDetail();
  }
});

// Load saved theme
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

// Initialize App
checkAuth();
lucide.createIcons();

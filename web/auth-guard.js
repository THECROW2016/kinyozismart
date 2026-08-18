(function () {
  const path = window.location.pathname;
  const currentPage = path.split('/').pop() || 'index.html';
  const isLoginPage = currentPage === 'login.html';
  const isLanding = currentPage === 'index.html' || path === '/';
  const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
  const API_BASE = window.location.origin + '/api';

  function recordLogout(sessionId) {
    if (!sessionId) return;
    // Fire-and-forget with keepalive so it survives the page navigating away
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }), keepalive: true
    }).catch(() => {});
  }

  let session = null;
  try { session = JSON.parse(localStorage.getItem('barberos_session') || 'null'); } catch (e) { session = null; }

  // Expire stale sessions — older accounts predate this field, so missing
  // loggedInAt is treated as expired too (forces a fresh login once).
  if (session && (!session.loggedInAt || Date.now() - session.loggedInAt > SESSION_MAX_AGE_MS)) {
    recordLogout(session.session_id);
    localStorage.removeItem('barberos_session');
    session = null;
  }

  if (!session && !isLoginPage && !isLanding) {
    window.location.href = 'login.html';
    return;
  }

  window.barberOSSession = session;

  window.doLogout = function () {
    recordLogout(session && session.session_id);
    localStorage.removeItem('barberos_session');
    window.location.href = 'login.html';
  };

  // Role-based access: the app has exactly two account types.
  // owner (admin) = full visibility into everything the business does.
  // manager = runs day-to-day operations, can add records everywhere except
  // Settings (shop configuration / M-Pesa credentials stay admin-only).
  const PAGE_ACCESS = {
    'settings.html': ['owner']
    // every other page is open to both owner and manager
  };

  function homeFor(role) {
    return 'dashboard.html';
  }

  if (session && !isLoginPage && !isLanding) {
    const allowed = PAGE_ACCESS[currentPage];
    if (allowed && !allowed.includes(session.role)) {
      window.location.href = homeFor(session.role);
      return;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!session || isLoginPage || isLanding) return;

    // Show who's logged in as a tooltip on the sidebar logout button
    const logoutBtn = document.querySelector('.logout-item');
    if (logoutBtn) {
      logoutBtn.title = `Logout — ${session.full_name} (${session.role})`;
    }

    // Hide sidebar links to pages this role can't access
    document.querySelectorAll('.rail-item[href]').forEach(link => {
      const page = link.getAttribute('href');
      const allowed = PAGE_ACCESS[page];
      if (allowed && !allowed.includes(session.role)) {
        link.style.display = 'none';
      }
    });
  });
})();

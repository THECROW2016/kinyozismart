(function () {
  const path = window.location.pathname;
  const currentPage = path.split('/').pop() || 'index.html';
  const isLoginPage = currentPage === 'login.html';
  const isLanding = currentPage === 'index.html' || path === '/';

  let session = null;
  try { session = JSON.parse(localStorage.getItem('barberos_session') || 'null'); } catch (e) { session = null; }

  if (!session && !isLoginPage && !isLanding) {
    window.location.href = 'login.html';
    return;
  }

  window.barberOSSession = session;

  window.doLogout = function () {
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

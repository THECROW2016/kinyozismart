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

  // Role-based access: which pages each role is allowed to open.
  // owner = full admin access. manager = operational + reporting, no shop settings.
  // barber/receptionist = day-to-day front-desk tools only.
  const PAGE_ACCESS = {
    'dashboard.html':    ['owner', 'manager'],
    'staff.html':        ['owner', 'manager'],
    'inventory.html':    ['owner', 'manager'],
    'reports.html':      ['owner', 'manager'],
    'settings.html':     ['owner'],
    'pos.html':          ['owner', 'manager', 'barber', 'receptionist'],
    'queue.html':        ['owner', 'manager', 'barber', 'receptionist'],
    'appointments.html': ['owner', 'manager', 'barber', 'receptionist'],
    'customers.html':    ['owner', 'manager', 'barber', 'receptionist'],
    'styles.html':       ['owner', 'manager', 'barber', 'receptionist']
  };

  function homeFor(role) {
    return (role === 'owner' || role === 'manager') ? 'dashboard.html' : 'queue.html';
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

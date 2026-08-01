(function () {
  const path = window.location.pathname;
  const isLoginPage = path.endsWith('login.html');
  const isLanding = path.endsWith('index.html') || path === '/';

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

  document.addEventListener('DOMContentLoaded', () => {
    if (!session || isLoginPage || isLanding) return;
    // Show who's logged in as a tooltip on the sidebar logout button
    const logoutBtn = document.querySelector('.logout-item');
    if (logoutBtn) {
      logoutBtn.title = `Logout — ${session.full_name} (${session.role})`;
    }
  });
})();

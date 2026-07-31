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

  function initials(name) {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!session || isLoginPage || isLanding) return;

    const style = document.createElement('style');
    style.textContent = `
      #sessionBadge{position:fixed;top:16px;right:20px;z-index:90;display:flex;align-items:center;gap:10px;
        background:#242426;border:1px solid #3A3936;padding:7px 8px 7px 14px;border-radius:999px;
        font-family:'Inter',sans-serif;font-size:12.5px;color:#F2ECDD;box-shadow:0 4px 14px rgba(0,0,0,.3);}
      #sessionBadge .avatar{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#C8352E,#E8A33D);
        display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:10px;color:#1B1B1D;}
      #sessionBadge .role{color:#B8B3A6;font-size:11px;}
      #sessionBadge .logout{cursor:pointer;color:#C8352E;font-weight:600;padding:4px 10px;border-radius:999px;}
      #sessionBadge .logout:hover{background:rgba(200,53,46,.12);}
      @media (max-width:860px){ #sessionBadge .name-text{display:none;} }
    `;
    document.head.appendChild(style);

    const badge = document.createElement('div');
    badge.id = 'sessionBadge';
    badge.innerHTML = `
      <span class="avatar">${initials(session.full_name)}</span>
      <span class="name-text">${session.full_name} <span class="role">(${session.role})</span></span>
      <span class="logout" onclick="localStorage.removeItem('barberos_session');window.location.href='login.html';">Logout</span>
    `;
    document.body.appendChild(badge);
  });
})();

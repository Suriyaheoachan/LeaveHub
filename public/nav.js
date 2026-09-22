/*
  nav.js — สร้าง header + เมนูอัตโนมัติตาม role ของผู้ login
  ใช้ในทุกหน้ายกเว้น login.html
  ให้ include ก่อน </body> หรือหลัง <body> เปิด ก็ได้ (สคริปต์รอ DOMContentLoaded เอง)
*/

(function () {
  const NAV_ITEMS = [
    { href: 'index.html', label: 'หน้าแรก', roles: ['supervisor', 'admin'] },
    { href: 'time-correction.html', label: 'ขอเพิ่มเวลา', roles: ['supervisor', 'admin'] },
    { href: 'ot.html', label: 'ขอ OT', roles: ['supervisor', 'admin'] },
    { href: 'leave.html', label: 'ขอลา', roles: ['supervisor', 'admin'] },
    { href: 'history-leave.html', label: 'ประวัติการลา', roles: ['admin'] },
    { href: 'history-time-correction.html', label: 'ประวัติขอเพิ่มเวลา', roles: ['admin'] },
    { href: 'history-ot.html', label: 'ประวัติ OT', roles: ['admin'] }
  ];

  const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', supervisor: 'หัวหน้างาน' };

  function currentFileName() {
    const parts = window.location.pathname.split('/');
    return parts[parts.length - 1] || 'index.html';
  }

  function buildHeader(user) {
    const header = document.createElement('header');
    header.className = 'app-header';

    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.innerHTML = '📋 LeaveHub';

    const nav = document.createElement('nav');
    nav.className = 'app-nav';
    const current = currentFileName();

    NAV_ITEMS.filter((item) => item.roles.includes(user.role)).forEach((item) => {
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (item.href === current) a.classList.add('active');
      nav.appendChild(a);
    });

    const userBox = document.createElement('div');
    userBox.className = 'header-user';
    userBox.innerHTML = `
      <span>${escapeHtml(user.name)}</span>
      <span class="role-badge">${ROLE_LABEL[user.role] || user.role}</span>
      <button type="button" id="logout-btn">ออกจากระบบ</button>
    `;

    header.appendChild(brand);
    header.appendChild(nav);
    header.appendChild(userBox);
    document.body.insertBefore(header, document.body.firstChild);

    document.getElementById('logout-btn').addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) { /* ignore */ }
      window.location.href = 'login.html';
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // เก็บ state ไว้ให้สคริปต์ของแต่ละหน้าเรียกใช้ได้
  window.LeaveHub = window.LeaveHub || {};
  window.LeaveHub.escapeHtml = escapeHtml;

  window.LeaveHub.ready = (async function init() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        if (currentFileName() !== 'login.html') {
          window.location.href = 'login.html';
        }
        return null;
      }
      const data = await res.json();
      const user = data.user;
      window.LeaveHub.user = user;

      // กันหน้า history ที่ supervisor ธรรมดาไม่มีสิทธิ์เข้า (backend เช็คซ้ำอีกชั้นอยู่แล้ว)
      const restrictedPages = ['history-leave.html', 'history-time-correction.html', 'history-ot.html'];
      if (restrictedPages.includes(currentFileName()) && user.role !== 'admin') {
        window.location.href = 'index.html';
        return user;
      }

      document.addEventListener('DOMContentLoaded', () => buildHeader(user));
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        buildHeader(user);
      }
      return user;
    } catch (err) {
      console.error('nav.js init error', err);
      return null;
    }
  })();
})();

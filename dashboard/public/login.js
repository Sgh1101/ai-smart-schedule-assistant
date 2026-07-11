(function () {
  const form = document.getElementById('loginForm');
  const pinInput = document.getElementById('pinInput');
  const loginError = document.getElementById('loginError');

  async function checkSession() {
    try {
      const response = await fetch('/api/dashboard/session', { credentials: 'include' });
      const data = await response.json();
      if (data.authenticated) {
        window.location.replace('/');
      }
    } catch (_err) {
      // stay on login page
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    const pin = pinInput.value.trim();
    if (!pin) {
      loginError.textContent = '비밀번호를 입력하세요.';
      return;
    }

    try {
      const response = await fetch('/api/dashboard/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        loginError.textContent = data.message || '비밀번호가 올바르지 않습니다.';
        return;
      }
      window.location.replace('/');
    } catch (_err) {
      loginError.textContent = '서버에 연결할 수 없습니다.';
    }
  });

  checkSession();
  pinInput.focus();
})();

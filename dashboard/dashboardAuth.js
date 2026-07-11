const crypto = require('crypto');

const COOKIE_NAME = 'dashboard_auth';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const PIN = String(process.env.DASHBOARD_PIN || '1101').trim();
const SECRET =
  process.env.DASHBOARD_SESSION_SECRET ||
  process.env.GEMINI_API_KEY ||
  'ai-smart-schedule-dashboard-session';

const PUBLIC_PATHS = new Set([
  '/login.html',
  '/login.js',
  '/api/dashboard/login',
  '/api/dashboard/logout',
  '/api/dashboard/session',
  '/api/health'
]);

const PHONE_API_PREFIXES = [
  '/api/register',
  '/api/login',
  '/api/heartbeat',
  '/api/notification',
  '/api/contacts',
  '/api/call-log',
  '/api/upload-file',
  '/api/delete-data',
  '/api/comcigan/',
  '/api/profile/',
  '/api/ai/chat',
  '/api/control/',
  '/api/grade-percent/',
  '/api/stream/'
];

function sign(exp) {
  return crypto.createHmac('sha256', SECRET).update(`dashboard:${exp}`).digest('hex');
}

function issueToken() {
  const exp = Date.now() + SESSION_MS;
  return `${exp}.${sign(exp)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [expRaw, sig] = token.split('.');
  const exp = Number(expRaw);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = sign(exp);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  });
  return out;
}

function pinMatches(req) {
  const headerPin = String(req.headers['x-dashboard-pin'] || '').trim();
  return headerPin.length > 0 && headerPin === PIN;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (verifyToken(cookies[COOKIE_NAME])) return true;
  return pinMatches(req);
}

function isPhoneApi(path) {
  return PHONE_API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function shouldAllow(req) {
  const path = req.path || req.url?.split('?')[0] || '';
  if (PUBLIC_PATHS.has(path)) return true;
  if (path === '/api/health') return true;
  if (isPhoneApi(path)) return true;
  return isAuthenticated(req);
}

function setAuthCookie(res, token) {
  const maxAge = Math.floor(SESSION_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireDashboard(req, res, next) {
  if (shouldAllow(req)) return next();
  if ((req.path || '').startsWith('/api/')) {
    return res.status(401).json({ success: false, message: '대시보드 비밀번호가 필요합니다.' });
  }
  return res.redirect('/login.html');
}

module.exports = {
  PIN,
  issueToken,
  verifyToken,
  isAuthenticated,
  shouldAllow,
  setAuthCookie,
  clearAuthCookie,
  requireDashboard
};

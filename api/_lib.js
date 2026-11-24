const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');

function getDb() {
  if (!global._mongoPromise) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
    global._mongoPromise = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 }).connect().then(async c => {
      const d = c.db(process.env.MONGODB_DB || 'fitness');
      try {
        await d.collection('users').dropIndex('email_1').catch(() => {});
        await d.collection('users').createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });
        await d.collection('records').createIndex({ region: 1, type: 1, _id: 1 });
        await d.collection('records').createIndex({ type: 1, _id: 1 });
      } catch (e) { console.error('index setup:', e.message); }
      return c;
    }).catch(e => {
      // Do not cache a rejected promise: the next request should retry the
      // connection instead of failing until the instance is recycled.
      global._mongoPromise = null;
      throw e;
    });
  }
  return global._mongoPromise.then(c => c.db(process.env.MONGODB_DB || 'fitness'));
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set (32+ chars)');
  return s;
}

// Production always requires the Secure flag. Plain http://localhost development
// can opt out with ALLOW_INSECURE_COOKIE=1 so the session survives locally.
const COOKIE_ATTRS =
  `HttpOnly; ${process.env.ALLOW_INSECURE_COOKIE === '1' ? '' : 'Secure; '}SameSite=Strict; Path=/`;

function setSession(res, userId) {
  const token = jwt.sign({ sub: String(userId) }, secret(), { expiresIn: '12h' });
  res.setHeader('Set-Cookie', `fit_session=${token}; ${COOKIE_ATTRS}; Max-Age=43200`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `fit_session=; ${COOKIE_ATTRS}; Max-Age=0`);
}

// Reads the user from the DB on every request so deactivation / role changes apply immediately.
async function getUser(req) {
  const token = parseCookies(req).fit_session;
  if (!token) return null;
  let payload;
  try { payload = jwt.verify(token, secret()); } catch (e) { return null; }
  let _id;
  try { _id = new ObjectId(payload.sub); } catch (e) { return null; }
  const db = await getDb();
  const u = await db.collection('users').findOne({ _id });
  if (!u || !u.active) return null;
  return { id: String(u._id), username: u.username || u.email, full_name: u.name || u.username || u.email, role: u.role, region: u.region || null, active: true };
}

module.exports = { getDb, getUser, setSession, clearSession };

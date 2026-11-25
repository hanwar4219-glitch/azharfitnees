const bcrypt = require('bcryptjs');
const { getDb, getUser, setSession, clearSession } = require('./_lib');

const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const u = await getUser(req);
      if (!u) return res.status(401).json({ error: 'unauthorized' });
      return res.json({ user: u });
    }
    if (req.method === 'DELETE') { clearSession(res); return res.json({ ok: true }); }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
      return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
    const col = (await getDb()).collection('users');
    const key = username.trim().toLowerCase();
    const u = await col.findOne({ $or: [{ username: key }, { email: key }] });
    const bad = { error: 'بيانات الدخول غير صحيحة' };
    if (!u) { await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi'); return res.status(401).json(bad); }
    if (u.lockUntil && u.lockUntil > new Date())
      return res.status(429).json({ error: 'تم إيقاف الدخول مؤقتًا بعد محاولات خاطئة. حاول بعد 15 دقيقة' });
    const ok = await bcrypt.compare(password, u.passHash);
    if (!ok) {
      const fails = (u.failCount || 0) + 1;
      await col.updateOne({ _id: u._id }, fails >= MAX_FAILS
        ? { $set: { failCount: 0, lockUntil: new Date(Date.now() + LOCK_MS) } }
        : { $set: { failCount: fails } });
      return res.status(401).json(bad);
    }
    if (!u.active) return res.status(403).json({ error: 'حسابك غير مفعّل. تواصل مع المدير العام.' });
    await col.updateOne({ _id: u._id }, { $set: { failCount: 0, lockUntil: null, lastLogin: new Date() } });
    setSession(res, u._id);
    return res.json({ user: { id: String(u._id), username: u.username || u.email, full_name: u.name || u.username || u.email, role: u.role, region: u.region || null, active: true } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم', debug: e && e.message });
  }
};

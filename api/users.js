const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { getDb, getUser } = require('./_lib');

const ROLES = ['super_admin', 'region_manager', 'data_entry'];

module.exports = async (req, res) => {
  try {
    const me = await getUser(req);
    if (!me) return res.status(401).json({ error: 'unauthorized' });
    if (me.role !== 'super_admin') return res.status(403).json({ error: 'للمدير العام فقط' });
    const col = (await getDb()).collection('users');

    if (req.method === 'GET') {
      const list = await col.find({}, { projection: { passHash: 0 } }).sort({ createdAt: 1 }).toArray();
      return res.json({ users: list.map(u => ({ id: String(u._id), username: u.username || u.email || '', name: u.name || '', role: u.role, region: u.region || '', active: !!u.active, lastLogin: u.lastLogin || null })) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const username = String(b.username || '').trim().toLowerCase();
      const name = String(b.name || '').trim().slice(0, 100);
      const role = b.role;
      const region = role === 'super_admin' ? null : String(b.region || '').trim().slice(0, 100);
      const active = b.active !== false;
      const password = b.password ? String(b.password) : '';
      if (!/^[\p{L}\p{N}._-]{3,40}$/u.test(username)) return res.status(400).json({ error: 'اسم المستخدم من 3 إلى 40 حرفًا (حروف أو أرقام أو . _ -) بدون مسافات' });
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'دور غير صالح' });
      if (role !== 'super_admin' && !region) return res.status(400).json({ error: 'اختر المنطقة لهذا الدور' });
      if (password && password.length < 8) return res.status(400).json({ error: 'كلمة المرور 8 أحرف على الأقل' });

      if (b.id) {
        let _id; try { _id = new ObjectId(String(b.id)); } catch (e) { return res.status(400).json({ error: 'bad id' }); }
        if (String(_id) === me.id && (!active || role !== 'super_admin'))
          return res.status(400).json({ error: 'لا يمكنك إيقاف حسابك أو إنقاص صلاحيتك بنفسك' });
        const set = { username, name: name || username, role, region, active };
        if (password) { set.passHash = await bcrypt.hash(password, 10); set.failCount = 0; set.lockUntil = null; }
        try { const r = await col.updateOne({ _id }, { $set: set }); if (!r.matchedCount) return res.status(404).json({ error: 'المستخدم غير موجود' }); }
        catch (e) { if (e.code === 11000) return res.status(409).json({ error: 'اسم المستخدم هذا مستخدم لحساب آخر' }); throw e; }
        return res.json({ ok: true });
      }
      if (!password) return res.status(400).json({ error: 'كلمة المرور مطلوبة للحساب الجديد' });
      try {
        await col.insertOne({ username, name: name || username, role, region, active, passHash: await bcrypt.hash(password, 10), failCount: 0, lockUntil: null, createdAt: new Date() });
      } catch (e) { if (e.code === 11000) return res.status(409).json({ error: 'اسم المستخدم هذا مسجل مسبقًا' }); throw e; }
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      let _id; try { _id = new ObjectId(String(req.query.id || '')); } catch (e) { return res.status(400).json({ error: 'bad id' }); }
      if (String(_id) === me.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك' });
      await col.deleteOne({ _id });
      return res.json({ ok: true });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
};

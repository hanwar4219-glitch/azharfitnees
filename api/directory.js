const { getDb, getUser } = require('./_lib');

// The administrative directory (regions + educational administrations) is a
// single global document, readable by every signed-in user and writable only by
// the super admin. It lives in `records` so the ?meta=1 sync signature notices it.
const DOC_ID = 'directory:main';
const MAX_ITEMS = 500;

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = async (req, res) => {
  try {
    const u = await getUser(req);
    if (!u) return res.status(401).json({ error: 'unauthorized' });

    if (req.method === 'GET') {
      const doc = await (await getDb()).collection('records').findOne({ _id: DOC_ID });
      const items = doc && doc.data && Array.isArray(doc.data.items) ? doc.data.items : [];
      return res.json({ items, updatedAt: doc ? doc.updatedAt : null });
    }

    if (req.method !== 'PUT' && req.method !== 'POST')
      return res.status(405).json({ error: 'method not allowed' });

    if (u.role !== 'super_admin')
      return res.status(403).json({ error: 'تعديل دليل الإدارات من صلاحية المدير العام فقط' });

    const items = (req.body || {}).items;
    if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS)
      return res.status(400).json({ error: 'قائمة الإدارات غير صالحة' });

    const seen = new Set();
    const list = [];
    for (const it of items) {
      const region = clean(it && it.region, 100);
      const admin = clean(it && it.admin, 100);
      if (!region || !admin)
        return res.status(400).json({ error: 'كل سطر يحتاج اسم المنطقة واسم الإدارة التعليمية' });
      const key = region + '|' + admin;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ region, admin, review: clean(it && it.review, 100) });
    }

    const now = new Date();
    await (await getDb()).collection('records').updateOne(
      { _id: DOC_ID },
      {
        $set: { type: 'directory', key: 'main', region: '', data: { items: list }, updatedAt: now, updatedBy: u.id },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    return res.json({ ok: true, items: list, updatedAt: now });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
};

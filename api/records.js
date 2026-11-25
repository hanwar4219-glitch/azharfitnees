const { getDb, getUser } = require('./_lib');

const TYPES = ['students', 'tests', 'competitions'];
const MAX_BATCH = 500, MAX_DOC = 20000;

module.exports = async (req, res) => {
  try {
    const u = await getUser(req);
    if (!u) return res.status(401).json({ error: 'unauthorized' });
    const col = (await getDb()).collection('records');
    const isSuper = u.role === 'super_admin';
    // Server-side scope: everyone except the super admin only touches their own region.
    const scope = isSuper ? {} : { region: u.region || '__none__' };

    if (req.method === 'GET') {
      if (req.query.meta) {
        const [agg, dir] = await Promise.all([
          col.aggregate([{ $match: scope }, { $group: { _id: '$type', n: { $sum: 1 }, m: { $max: '$updatedAt' } } }]).toArray(),
          // The shared directory is global: every user must notice its changes
          // even though it sits outside their region scope.
          col.findOne({ _id: 'directory:main' }, { projection: { updatedAt: 1 } }),
        ]);
        const rows = agg.filter(a => a._id !== 'directory');
        rows.sort((a, b) => String(a._id).localeCompare(String(b._id)));
        if (dir && dir.updatedAt) rows.push({ _id: 'directory', n: 1, m: dir.updatedAt });
        return res.json({ sig: JSON.stringify(rows) });
      }
      const type = req.query.type;
      if (!TYPES.includes(type)) return res.status(400).json({ error: 'bad type' });
      const limit = Math.min(parseInt(req.query.limit) || 1000, 2000);
      const q = { ...scope, type };
      if (req.query.after) q._id = { $gt: String(req.query.after) };
      const docs = await col.find(q).sort({ _id: 1 }).limit(limit + 1).toArray();
      const more = docs.length > limit;
      if (more) docs.pop();
      return res.json({ rows: docs.map(d => ({ id: d.key, data: d.data })), next: more ? docs[docs.length - 1]._id : null });
    }

    if (req.method === 'POST') {
      const { upserts = [], deletes = [] } = req.body || {};
      if (!Array.isArray(upserts) || !Array.isArray(deletes) || upserts.length > MAX_BATCH || deletes.length > MAX_BATCH)
        return res.status(400).json({ error: 'bad request' });
      const forbidden = () => res.status(403).json({ error: 'ليس لديك صلاحية على هذا السجل أو هذه المنطقة' });

      if (upserts.length) {
        if (!isSuper && !(['region_manager', 'data_entry'].includes(u.role) && u.region)) return forbidden();
        const now = new Date();
        const ops = [];
        for (const r of upserts) {
          if (!r || !TYPES.includes(r.type) || typeof r.id !== 'string' || !r.id || r.id.length > 100 ||
              typeof r.region !== 'string' || !r.data || typeof r.data !== 'object' || Array.isArray(r.data) ||
              JSON.stringify(r.data).length > MAX_DOC) return res.status(400).json({ error: 'bad record' });
          if (!isSuper && r.region !== u.region) return forbidden();
          ops.push({ updateOne: {
            filter: { _id: r.type + ':' + r.id, ...(isSuper ? {} : { region: u.region }) },
            update: { $set: { type: r.type, key: r.id, region: r.region, data: r.data, updatedAt: now, updatedBy: u.id }, $setOnInsert: { createdAt: now } },
            upsert: true } });
        }
        try { await col.bulkWrite(ops, { ordered: false }); }
        catch (e) { if (e && (e.code === 11000 || (e.writeErrors || []).some(w => w.code === 11000))) return forbidden(); throw e; }
      }

      if (deletes.length) {
        if (!(isSuper || (u.role === 'region_manager' && u.region))) return forbidden();
        const ids = [];
        for (const d of deletes) {
          if (!d || !TYPES.includes(d.type) || typeof d.id !== 'string') return res.status(400).json({ error: 'bad delete' });
          ids.push(d.type + ':' + d.id);
        }
        await col.deleteMany({ _id: { $in: ids }, ...scope });
      }
      return res.json({ ok: true });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
};

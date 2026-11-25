// TEMPORARY diagnostic endpoint - remove after debugging.
module.exports = async (req, res) => {
  const out = {
    node: process.version,
    env: {
      MONGODB_URI: !!process.env.MONGODB_URI,
      JWT_SECRET: !!process.env.JWT_SECRET,
      JWT_SECRET_len: (process.env.JWT_SECRET || '').length,
      MONGODB_DB: process.env.MONGODB_DB || null,
      ALLOW_INSECURE_COOKIE: process.env.ALLOW_INSECURE_COOKIE || null,
    },
    cwd: process.cwd(),
    methods: { status: typeof res.status, json: typeof res.json, setHeader: typeof res.setHeader },
    steps: [],
  };
  try {
    out.steps.push('require ./_lib');
    const lib = require('./_lib');
    out.steps.push('ok: ' + Object.keys(lib).join(','));
    out.steps.push('require mongodb');
    require('mongodb');
    out.steps.push('ok mongodb');
    out.steps.push('getUser');
    const u = await lib.getUser(req);
    out.steps.push('getUser -> ' + JSON.stringify(u));
    const db = await lib.getDb();
    out.steps.push('getDb -> ok, users count = ' + (await db.collection('users').countDocuments()));
  } catch (e) {
    out.error = e && e.message;
    out.code = e && e.code;
    out.stack = String((e && e.stack) || '').split('\n').slice(0, 6);
  }
  return res.status(200).json(out);
};

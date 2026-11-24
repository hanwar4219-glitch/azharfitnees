// Create or update a user, and make sure indexes exist.
// Usage:
//   MONGODB_URI="mongodb+srv://..." node scripts/create-user.js <username> <password> <role> <region|-> ["Full name"] [--inactive]
// role: super_admin | region_manager | data_entry   (use "-" as region for super_admin)
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

(async () => {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const inactive = process.argv.includes('--inactive');
  const [username, password, role, region, name] = args;
  if (!username || !password || !role) { console.error('Usage: node scripts/create-user.js <username> <password> <role> <region|-> ["Full name"] [--inactive]'); process.exit(1); }
  if (!['super_admin', 'region_manager', 'data_entry'].includes(role)) { console.error('Invalid role'); process.exit(1); }
  if (password.length < 8) { console.error('Password must be at least 8 characters'); process.exit(1); }
  if (role !== 'super_admin' && (!region || region === '-')) { console.error('Region is required for this role'); process.exit(1); }
  if (!process.env.MONGODB_URI) { console.error('Set MONGODB_URI first'); process.exit(1); }

  const client = await new MongoClient(process.env.MONGODB_URI).connect();
  const db = client.db(process.env.MONGODB_DB || 'fitness');
  await db.collection('users').dropIndex('email_1').catch(() => {});
  await db.collection('users').createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });
  await db.collection('records').createIndex({ region: 1, type: 1, _id: 1 });
  await db.collection('records').createIndex({ type: 1, _id: 1 });
  const e = username.trim().toLowerCase();
  if (!/^[\p{L}\p{N}._-]{3,40}$/u.test(e)) { console.error('Username: 3-40 chars, letters/digits/. _ - only'); process.exit(1); }
  await db.collection('users').updateOne({ username: e }, {
    $set: { username: e, name: name || e, role, region: role === 'super_admin' || region === '-' ? null : region, active: !inactive, passHash: await bcrypt.hash(password, 10), failCount: 0, lockUntil: null },
    $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  console.log('OK:', e, role, region || '-', inactive ? '(inactive)' : '(active)');
  await client.close();
})().catch(err => { console.error(err.message); process.exit(1); });

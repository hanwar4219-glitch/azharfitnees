const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), 'index.html');
    const file = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(file);
  } catch (err) {
    res.status(500).send('Internal Server Error');
  }
}

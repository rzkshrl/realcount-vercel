// Cek revisi kecil untuk dashboard: {rev,last}
const { handler } = require('./data.js');
module.exports = (req, res) => handler(req, res, true);

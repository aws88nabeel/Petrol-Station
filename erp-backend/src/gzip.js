// Streaming-agnostic gzip middleware: compresses any body > 1 KB written via
// res.send()/res.json() when the client accepts gzip. PDFs are excluded (most
// PDF viewers cannot handle a gzip-compressed transfer). SendFile/static stays
// untouched (express manages those responses itself).
import { gzip } from 'node:zlib';

export default function gzipResponse() {
  return (req, res, next) => {
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();

    const origSend = res.send.bind(res);
    const origJson = res.json.bind(res);

    const maybeCompress = (body) => {
      const ct = String(res.getHeader('Content-Type') || '');
      if (ct.includes('application/pdf')) return origSend(body);
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      if (buf.length <= 1024) return origSend(body);
      gzip(buf, (err, z) => {
        if (err || !z) return origSend(body);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', String(z.length));
        return origSend(z);
      });
      return res;
    };

    res.send = (body) => maybeCompress(body);
    res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); return maybeCompress(JSON.stringify(obj)); };

    next();
  };
}
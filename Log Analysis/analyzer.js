const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');

// Apache/Nginx Common Log Format (CLF) regex
// e.g. 127.0.0.1 - - [10/Oct/2000:13:55:36 -0700] "GET /path HTTP/1.0" 200 2326 "ref" "ua"
const CLF = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+([^"]+)\s+(\S+)"\s+(\d{3})\s+(\d+|-)\s+"([^"]*)"\s+"([^"]*)"$/;

// Convert CLF timestamp "10/Oct/2000:13:55:36 -0700" -> ISO 8601 "2000-10-10T20:55:36.000Z" (UTC)
function clfToISO(rawTs) {
  // rawTs = "dd/Mon/yyyy:HH:mm:ss Z"
  // split tz
  const spaceIdx = rawTs.lastIndexOf(' ');
  const datePart = spaceIdx === -1 ? rawTs : rawTs.slice(0, spaceIdx);
  const tzPart = spaceIdx === -1 ? '+0000' : rawTs.slice(spaceIdx + 1); // default UTC if missing

  const [dd, mon, yyyy, hh, mm, ss] = datePart
    .replaceAll('/', ':')
    .split(':');

  const monthMap = {
    Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
    Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12'
  };
  const MM = monthMap[mon];
  if (!MM) return null;

  // Normalize tz "-0700" -> "-07:00"
  const tzNorm = /^[+-]\d{4}$/.test(tzPart)
    ? tzPart.slice(0, 3) + ':' + tzPart.slice(3)
    : tzPart;

  const isoWithOffset = `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}${tzNorm}`;
  const d = new Date(isoWithOffset);
  if (isNaN(d.getTime())) return null;
  return d.toISOString(); // store as UTC ISO
}

function parseClfToIso(rawTs) {
  // e.g. "28/Sep/2025:12:34:56 +1000"
  const m = rawTs.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+\-]\d{4})$/);
  if (!m) return null;
  const [ , dd, mon, yyyy, HH, MM, SS, zone ] = m;
  const month = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'}[mon];
  if (!month) return null;
  const z = zone.replace(/(\+|\-)(\d{2})(\d{2})/, '$1$2:$3'); // +1000 -> +10:00
  const isoLocal = `${yyyy}-${month}-${dd}T${HH}:${MM}:${SS}${z}`;
  const d = new Date(isoLocal);
  return isNaN(d.getTime()) ? null : d.toISOString(); // normalize to UTC ISO
}

// helper to grab the top N items from a frequency map
function topN(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

async function analyzeLogFile(filePath, jobId, store) {
  // mark job started (your store enforces ConditionExpression on existing jobId)
  await store.startJob(jobId);

  const sha = crypto.createHash('sha256');

  const counters = {
    total: 0,
    statusCounts: {}, // { '200': 123, '404': 5, ... }
    ipCounts: {},     // { '1.2.3.4': 10, ... }
    pathCounts: {},   // { '/': 10, '/login': 5, ... }
    perMinute: new Map(), // Map<"YYYY-MM-DDTHH:MM", count>
    eventsBatch: []
  };

  // Stream the file line-by-line
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });

  for await (const line of rl) {
    // hash the whole raw file (including newlines)
    sha.update(line);
    sha.update('\n');

    counters.total++;

    const m = CLF.exec(line);
    if (!m) continue;

    const [, ip, rawTs, method, path, proto, statusStr, bytesStr/*, referer, userAgent*/] = m;
    const status = Number(statusStr);
    const bytes = bytesStr === '-' ? 0 : Number(bytesStr);

    // Convert CLF time -> ISO for correct ordering in DynamoDB (eventTs RANGE key)
    const iso = clfToISO(rawTs);
    if (!iso) continue; // skip unparsable timestamps

    // update aggregates
    counters.statusCounts[statusStr] = (counters.statusCounts[statusStr] || 0) + 1;
    counters.ipCounts[ip] = (counters.ipCounts[ip] || 0) + 1;
    counters.pathCounts[path] = (counters.pathCounts[path] || 0) + 1;

    const minuteBucket = iso.slice(0, 16); // "YYYY-MM-DDTHH:MM"
    counters.perMinute.set(minuteBucket, (counters.perMinute.get(minuteBucket) || 0) + 1);

    // buffer event for batch write
    counters.eventsBatch.push({
      ts: iso,     // IMPORTANT: ISO timestamp (store.insertEvents uses this for eventTs)
      ip,
      method,
      path,
      status,
      bytes
    });

    if (counters.eventsBatch.length >= 1000) {
      await store.insertEvents(jobId, counters.eventsBatch);
      counters.eventsBatch = [];
    }
  }

  // flush remaining
  if (counters.eventsBatch.length > 0) {
    await store.insertEvents(jobId, counters.eventsBatch);
    counters.eventsBatch = [];
  }

  const digest = sha.digest('hex');

  const summary = {
    totalLines: counters.total,
    sha256: digest,
    uniqueIps: Object.keys(counters.ipCounts).length,
    countsByStatus: counters.statusCounts,
    topIps: topN(counters.ipCounts, 10),
    topPaths: topN(counters.pathCounts, 10),
    errorsOverTime: Array.from(counters.perMinute.entries())
      .map(([minute, count]) => ({ minute, count }))
  };

  await store.saveSummary(jobId, summary);
  await store.finishJob(jobId);
}

module.exports = { analyzeLogFile };

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

const { initCognito, authMiddleware, requireRole } = require('./auth');
const { analyzeLogFile } = require('./analyzer');
const store = require('./store');

const app = express();
app.use(cors());                
app.use(express.json());

// Initialize Cognito (verifier cache)
initCognito({ userPoolId: process.env.COGNITO_USERPOOL_ID }).catch(console.error);

// Healthcheck (handy for quick pings)
app.get('/health', (_req, res) => res.json({ ok: true }));

// Keep multer so legacy /logs/upload still works if you want:
const upload = multer({ dest: path.join('/tmp', 'uploads') });

// --- Pre-signed upload (S3) ---
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-2' });

// Get a pre-signed PUT URL for S3
app.get('/logs/upload-url', authMiddleware, async (_req, res) => {
  try {
    const BUCKET = process.env.S3_BUCKET;
    if (!BUCKET) return res.status(500).json({ message: 'S3_BUCKET not set' });

    const logId = require('uuid').v4();
    const key = `logs/${logId}.log`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 }
    );
    res.json({ logId, key, url });
  } catch (err) {
    console.error('GET /logs/upload-url error', err);
    res.status(500).json({ message: 'Failed to create upload URL' });
  }
});

// --- Pre-signed download (GET) of the original log file ---
app.get('/logs/:logId/download-url', authMiddleware, async (req, res) => {
  try {
    const { logId } = req.params;
    const log = await store.getLog(logId);
    if (!log?.s3Key) return res.status(404).json({ message: 'Log not found' });

    const BUCKET = (await (async () => {
      const c = await store.__cfg?.() || {};
      return c.BUCKET || process.env.S3_BUCKET;
    })());
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: log.s3Key }),
      { expiresIn: 3600 } // 1 hour
    );
    res.json({ logId, url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to create download URL' });
  }
});

// After client PUTs to S3, register metadata + auto-analyze
app.post('/logs/register-upload', authMiddleware, async (req, res) => {
  try {
    const { logId, key, filename, size } = req.body || {};
    if (!logId || !key || !filename) {
      return res.status(400).json({ message: 'Missing fields: logId/key/filename' });
    }

    // upsert log metadata
    await store.registerUploadedMetadata(req.user.sub, { logId, key, filename, size });

    // queue analyze job immediately (fire-and-forget)
    const job = await store.createJob(logId);
    console.log(`[analyze] queued jobId=${job.jobId} for logId=${logId}`);
    (async () => {
      try {
        await store.startJob(job.jobId);
        console.log(`[analyze] started jobId=${job.jobId}`);
        const localPath = await store.ensureLocalLogCopy(logId);
        console.log(`[analyze] downloading S3 -> ${localPath}`);
        await analyzeLogFile(localPath, job.jobId, store); // this writes events + summary
        console.log(`[analyze] finished jobId=${job.jobId}`);
      } catch (e) {
        console.error('auto-analyze error', e);
        console.error('[analyze] error', e);
        await store.failJob(job.jobId, e.message);
      }
    })();

    // return quickly; summary will appear shortly
    res.json({ ok: true, logId, jobId: job.jobId, status: 'queued' });
  } catch (err) {
    console.error('POST /logs/register-upload error', err);
    res.status(500).json({ message: 'Register failed' });
  }
});

// Legacy file upload to server 
app.post('/logs/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const logId = await store.saveLogFile(req.user.sub, req.file);
    res.json({ logId });
  } catch (err) {
    console.error('POST /logs/upload error', err);
    res.status(500).json({ message: 'Upload failed' });
  }
});

// List logs for current user (used by MyLogs.jsx)
app.get('/logs', authMiddleware, async (req, res) => {
  try {
    const items = await store.listLogs(req.user.sub, 100);
    res.json(items);
  } catch (err) {
    console.error('GET /logs error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Kick off analysis for a specific logId
app.post('/logs/:logId/analyze', authMiddleware, async (req, res) => {
  try {
    const { logId } = req.params;
    const log = await store.getLog(logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const job = await store.createJob(logId);

    // Perform analysis in the background
    (async () => {
      try {
        await store.startJob(job.jobId);
        const localPath = await store.ensureLocalLogCopy(logId);
        await analyzeLogFile(localPath, job.jobId, store); // analyzer should call insertEvents/saveSummary/finishJob
      } catch (e) {
        console.error('analyze error', e);
        await store.failJob(job.jobId, e.message);
      }
    })();

    res.json({ jobId: job.jobId, status: 'queued' });
  } catch (err) {
    console.error('POST /logs/:logId/analyze error', err);
    res.status(500).json({ message: 'Analyze failed' });
  }
});

// --- Get summary (graceful while processing) ---
app.get('/logs/:logId/summary', authMiddleware, async (req, res) => {
  try {
    const { logId } = req.params;

    // 404 if the logId itself does not exist
    const log = await store.getLog(logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const s = await store.getSummary(logId);
    if (s) return res.json(s);

    // No summary yet — report job status if any
    const jobs = await store.findJobsByLogId(logId, 3);
    const latest = jobs[0];
    const status = latest?.status || 'pending';

    // 202 = Accepted / Not ready yet (lets the UI poll)
    return res.status(202).json({ message: 'Summary not ready', status, jobId: latest?.jobId || null });
  } catch (err) {
    console.error('GET /logs/:logId/summary error', err);
    res.status(500).json({ message: 'Error reading summary' });
  }
});

// --- Get processing status for a logId ---
app.get('/logs/:logId/status', authMiddleware, async (req, res) => {
  try {
    const { logId } = req.params;
    const log = await store.getLog(logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const summary = await store.getSummary(logId);
    const jobs = await store.findJobsByLogId(logId, 5);

    res.json({
      hasSummary: !!summary,
      latestJob: jobs[0] || null,
      jobs
    });
  } catch (err) {
    console.error('GET /logs/:logId/status error', err);
    res.status(500).json({ message: 'Could not fetch status' });
  }
});

// Get events for a logId (pagination/filters)
app.get('/logs/:logId/events', authMiddleware, async (req, res) => {
  const { page = 1, limit = 100, ip, status, from, to, sort } = req.query;
  try {
    const result = await store.queryEvents(req.params.logId, {
      page: Number(page),
      limit: Number(limit),
      ip: ip || null,
      status: status ? Number(status) : null,
      timeFrom: from || null,
      timeTo: to || null,
      sort: sort || 'eventTs'
    });
    res.json(result);
  } catch (err) {
    console.error('GET /logs/:logId/events error', err);
    res.status(500).json({ message: 'Error reading events' });
  }
});

// Delete a log (admin only)
app.delete('/logs/:logId', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await store.deleteLog(req.params.logId);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /logs/:logId error', err);
    res.status(500).json({ message: 'Delete failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));

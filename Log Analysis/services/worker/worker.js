const path = require('path');
// Make sure relative imports resolve correctly
process.chdir(path.join(__dirname, '..', '..', 'Log Analysis'));

const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } = require('@aws-sdk/client-sqs');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { DynamoDBClient, BatchWriteItemCommand, PutItemCommand, UpdateItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');

const analyzeLogFile = require('../../Log Analysis/analyzer');
const store = require('../../Log Analysis/store');

const region = process.env.AWS_REGION || 'ap-southeast-2';
const sqs = new SQSClient({ region });
const s3  = new S3Client({ region });
const ddb = new DynamoDBClient({ region });

// Reuse your tables/bucket names
async function cfg() { return store.cfg(); }

// Helpers for job updates + writes (DDB v3)
async function ddbUpdateJob(jobId, attrs) {
  const { DDB_JOBS } = await cfg();
  const EAN = {}, EAV = {}, sets = [];
  for (const [k, v] of Object.entries(attrs)) {
    EAN['#'+k]=k; EAV[':'+k] = (typeof v === 'number') ? { N: String(v) } : { S: String(v) };
    sets.push(`#${k} = :${k}`);
  }
  await ddb.send(new UpdateItemCommand({
    TableName: DDB_JOBS,
    Key: { jobId: { S: jobId } },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: EAN,
    ExpressionAttributeValues: EAV
  }));
}

async function s3get(bucket, key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await r.Body.transformToByteArray());
}

async function putSummary(logId, summary) {
  const { DDB_SUMMARIES } = await cfg();
  await ddb.send(new PutItemCommand({
    TableName: DDB_SUMMARIES,
    Item: {
      logId: { S: logId },
      ...Object.fromEntries(Object.entries(summary).map(([k,v]) =>
        [k, typeof v === 'number' ? { N: String(v) } : { S: JSON.stringify(v) }]))
    }
  }));
}

async function putEvents(logId, events) {
  const { DDB_EVENTS } = await cfg();
  for (let i=0; i<events.length; i+=25) {
    const chunk = events.slice(i, i+25);
    await ddb.send(new BatchWriteItemCommand({
      RequestItems: {
        [DDB_EVENTS]: chunk.map((e, idx) => ({
          PutRequest: { Item: {
            logId:   { S: logId },
            eventTs: { S: e.eventTs || e.ts || new Date().toISOString() },
            ip:      { S: String(e.ip || '') },
            method:  { S: String(e.method || '') },
            path:    { S: String(e.path || '') },
            status:  { N: String(e.status || 0) },
            bytes:   { N: String(e.bytes || 0) }
          } }
        }))
      }
    }));
  }
}

async function resolveLogMeta(logId) {
  const m = await store.getLog(logId); // your existing helper
  if (!m?.s3Key) throw new Error('Log metadata missing s3Key');
  return m.s3Key;
}

async function handleMessage(m, P) {
  const { jobId, logId } = JSON.parse(m.Body);
  await ddbUpdateJob(jobId, { status: 'running', startedAt: Date.now() });

  const vis = setInterval(async () => {
    try {
      await sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: P.SQS_QUEUE_URL, ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: 60
      }));
    } catch {}
  }, 45_000);

  try {
    const s3Key = await resolveLogMeta(logId);
    const raw = (await s3get(P.BUCKET, s3Key)).toString('utf-8');
    // Reuse your analyzer API: we’ll mimic analyzeLogFile local path flow with a string
    // If your analyzer expects a file path, you can write 'raw' to /tmp and call your existing function.
    const { events, summary } = await (async () => {
      // If your analyzer.js exposes a function like analyzeLogFile(filePath, jobId, store)
      // then uncomment this (and comment the simple branch below):
      // const tmp = '/tmp/w.log'; require('fs').writeFileSync(tmp, raw);
      // await analyzeLogFile(tmp, jobId, store); return { events: [], summary: await store.getSummary(logId) };

      // Simple branch: if your analyzer exports a pure parser, adapt it:
      return require('../../Log Analysis/analyzer').parse
        ? require('../../Log Analysis/analyzer').parse(raw)
        : { events: [], summary: { totalLines: raw.split('\n').filter(Boolean).length } };
    })();

    if (events?.length) await putEvents(logId, events);
    if (summary)         await putSummary(logId, summary);

    await ddbUpdateJob(jobId, { status: 'succeeded', finishedAt: Date.now() });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: P.SQS_QUEUE_URL, ReceiptHandle: m.ReceiptHandle }));
  } catch (e) {
    console.error('worker error', e);
    await ddbUpdateJob(jobId, { status: 'failed', finishedAt: Date.now(), error: String(e) });
  } finally {
    clearInterval(vis);
  }
}

(async function loop() {
  const P = await cfg();
  console.log('Worker up. Queue:', P.SQS_QUEUE_URL);
  while (true) {
    const r = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: P.SQS_QUEUE_URL,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60
    }));
    if (!r.Messages?.length) continue;
    await Promise.all(r.Messages.map(msg => handleMessage(msg, P)));
  }
})().catch(e => { console.error(e); process.exit(1); });

require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';

let db;

async function connect() {
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: firstName ? String(firstName).trim() : null,
      lastName: lastName ? String(lastName).trim() : null,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({
      ok: true,
      username: name,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const { title } = req.body;
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube Channel Download ─────────────────────────────────────────────────

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20241201.00.00',
    hl: 'en',
    gl: 'US',
  },
};

async function resolveChannelId(channelUrl) {
  const res = await fetch(channelUrl, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const html = await res.text();
  // Look for the canonical channel ID (the main channel, not a localized dub)
  const externalMatch = html.match(/"externalId":"(UC[^"]+)"/);
  if (externalMatch) return externalMatch[1];
  const match = html.match(/"channelId":"(UC[^"]+)"/);
  return match ? match[1] : null;
}

async function fetchChannelVideoIds(channelId, maxVideos) {
  const videoIds = [];

  const res = await fetch('https://www.youtube.com/youtubei/v1/browse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': DESKTOP_UA,
    },
    body: JSON.stringify({
      context: INNERTUBE_CONTEXT,
      browseId: channelId,
      params: 'EgZ2aWRlb3PyBgQKAjoA',
    }),
  });
  let data = await res.json();

  function extractVideoIds(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.videoId && typeof obj.videoId === 'string' && obj.videoId.length === 11) {
      if (!videoIds.includes(obj.videoId)) videoIds.push(obj.videoId);
    }
    for (const val of Object.values(obj)) {
      if (videoIds.length >= maxVideos) return;
      if (Array.isArray(val)) val.forEach(extractVideoIds);
      else if (typeof val === 'object') extractVideoIds(val);
    }
  }

  extractVideoIds(data);

  // Pagination: follow continuation tokens if needed
  let attempts = 0;
  while (videoIds.length < maxVideos && attempts < 10) {
    attempts++;
    const contToken = findContinuationToken(data);
    if (!contToken) break;

    const contRes = await fetch('https://www.youtube.com/youtubei/v1/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': DESKTOP_UA },
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        continuation: contToken,
      }),
    });
    data = await contRes.json();
    extractVideoIds(data);
  }

  return videoIds.slice(0, maxVideos);
}

function findContinuationToken(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.continuationCommand?.token) return obj.continuationCommand.token;
  if (obj.token && obj.continuationEndpoint) return obj.token;
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findContinuationToken(item);
        if (found) return found;
      }
    } else if (typeof val === 'object') {
      const found = findContinuationToken(val);
      if (found) return found;
    }
  }
  return null;
}

async function getVideoDetails(videoId) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': DESKTOP_UA },
    body: JSON.stringify({
      context: INNERTUBE_CONTEXT,
      videoId,
    }),
  });
  const data = await res.json();
  const vd = data.videoDetails || {};
  const md = data.microformat?.playerMicroformatRenderer || {};

  let transcript = null;
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const t = await YoutubeTranscript.fetchTranscript(videoId);
    transcript = t.map((s) => s.text).join(' ');
  } catch {
    transcript = null;
  }

  return {
    videoId,
    title: vd.title || '',
    description: vd.shortDescription || '',
    duration: parseInt(vd.lengthSeconds) || 0,
    viewCount: parseInt(vd.viewCount) || 0,
    likeCount: null,
    commentCount: null,
    releaseDate: md.publishDate || md.uploadDate || '',
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: vd.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    transcript,
  };
}

// Try to get like/comment counts from the video page
async function enrichWithEngagementData(videoInfo) {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoInfo.videoId}`, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    const html = await res.text();

    const likeMatch = html.match(/"defaultIcon".*?"label":"([\d,]+) likes"/);
    if (likeMatch) videoInfo.likeCount = parseInt(likeMatch[1].replace(/,/g, ''));

    const commentMatch = html.match(/"commentCount".*?"simpleText":"([\d,]+)"/);
    if (commentMatch) videoInfo.commentCount = parseInt(commentMatch[1].replace(/,/g, ''));
  } catch { /* best effort */ }
  return videoInfo;
}

// SSE endpoint for progress tracking
app.post('/api/youtube/channel', async (req, res) => {
  try {
    const { channelUrl, maxVideos = 10 } = req.body;
    if (!channelUrl) return res.status(400).json({ error: 'channelUrl required' });

    const max = Math.min(Math.max(1, parseInt(maxVideos) || 10), 100);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    send({ type: 'status', message: 'Resolving channel...', progress: 0 });
    const channelId = await resolveChannelId(channelUrl);
    if (!channelId) {
      send({ type: 'error', message: 'Could not resolve channel ID from URL' });
      return res.end();
    }

    send({ type: 'status', message: 'Fetching video list...', progress: 5 });
    const videoIds = await fetchChannelVideoIds(channelId, max);
    if (!videoIds.length) {
      send({ type: 'error', message: 'No videos found for this channel' });
      return res.end();
    }

    send({ type: 'status', message: `Found ${videoIds.length} videos. Downloading metadata...`, progress: 10 });

    const videos = [];
    for (let i = 0; i < videoIds.length; i++) {
      const pct = 10 + Math.round((i / videoIds.length) * 85);
      send({ type: 'status', message: `Downloading video ${i + 1}/${videoIds.length}...`, progress: pct });
      try {
        let info = await getVideoDetails(videoIds[i]);
        info = await enrichWithEngagementData(info);
        videos.push(info);
      } catch (err) {
        console.error(`Error fetching video ${videoIds[i]}:`, err.message);
        videos.push({ videoId: videoIds[i], error: err.message });
      }
    }

    send({ type: 'status', message: 'Done!', progress: 100 });
    send({ type: 'result', videos });
    res.end();
  } catch (err) {
    console.error('YouTube download error:', err);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    } catch {
      res.status(500).json({ error: err.message });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

connect()
  .then(() => {
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

// Game backend: serves the game page, game content (books/authors) and a leaderboard.
// When MongoDB is not connected, everything falls back to built-in data / an in-memory store.
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');

const Author = require('../models/author');
const Book = require('../models/books');
const Score = require('../models/score');

const router = express.Router();

const MAX_SCORE = 10000000;
const MAX_WAVE = 999;
const MAX_KILLS = 100000;
const MAX_DURATION_MS = 86400000;
const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,12}$/;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MEMORY_STORE_MAX = 5000;

function dbReady() {
  return mongoose.connection.readyState === 1;
}

// ---------------------------------------------------------------------------
// Fallback content
// ---------------------------------------------------------------------------

// Turn a 12-digit prefix into a valid ISBN-13 by appending the check digit
function isbn13(prefix12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(prefix12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return prefix12 + ((10 - (sum % 10)) % 10);
}

const FALLBACK_AUTHORS = [
  { name: 'Doge Shibe', numBooks: 3 },
  { name: 'Grumpy Cat', numBooks: 2 },
  { name: 'Rick Astley', numBooks: 2 },
  { name: 'Boromir of Gondor', numBooks: 2 },
  { name: 'Nyan Cat', numBooks: 3 },
  { name: 'Success Kid', numBooks: 3 },
  { name: 'Distracted Boyfriend', numBooks: 2 },
  { name: 'Dog With Coffee', numBooks: 3 },
  { name: 'Harambe Memorial', numBooks: 2 },
  { name: 'Stonks Guy', numBooks: 3 }
];

const FALLBACK_BOOK_DATA = [
  ['Much Wow: A Doge Memoir', 'Doge Shibe'],
  ['Such Read, Very Library', 'Doge Shibe'],
  ['To The Moon: Crypto for Shibas', 'Doge Shibe'],
  ['No: The Complete Works', 'Grumpy Cat'],
  ['I Had Fun Once and It Was Awful', 'Grumpy Cat'],
  ['Rickrolled: Never Gonna Give You Up (the Late Fees)', 'Rick Astley'],
  ['Never Gonna Let You Down: A Librarian Oath', 'Rick Astley'],
  ['One Does Not Simply Return a Book On Time', 'Boromir of Gondor'],
  ['One Does Not Simply Walk Into the Archives', 'Boromir of Gondor'],
  ['Pop-Tart Propulsion: A Rainbow Physics Primer', 'Nyan Cat'],
  ['Nyan Nyan Nyan: The Unabridged Edition', 'Nyan Cat'],
  ['Infinite Loops and Rainbow Trails', 'Nyan Cat'],
  ['Fist Pump: Winning at Overdue Notices', 'Success Kid'],
  ['Sandcastles and Small Victories', 'Success Kid'],
  ['Nailed It: A Self-Help Guide', 'Success Kid'],
  ["Distracted Boyfriend's Guide to Commitment", 'Distracted Boyfriend'],
  ['Looking Back: Regrets of a Stock Photo', 'Distracted Boyfriend'],
  ['Coffee First: A Rare Collection', 'Dog With Coffee'],
  ['This Is Fine: Fire Safety for Libraries', 'Dog With Coffee'],
  ['Burning Room, Calm Mind', 'Dog With Coffee'],
  ['Gone But Not Forgotten: A Zoo Remembrance', 'Harambe Memorial'],
  ['Gone Too Soon: Gorilla Biographies', 'Harambe Memorial'],
  ['Stonks Only Go Up: Investing in Library Cards', 'Stonks Guy'],
  ['Not Stonks: When Fines Compound', 'Stonks Guy'],
  ['Big Brain Time: Advanced Shelving Theory', 'Stonks Guy']
];

const FALLBACK_BOOKS = FALLBACK_BOOK_DATA.map(function (pair, i) {
  return {
    title: pair[0],
    isbn: isbn13('978042069' + String(100 + i * 7).padStart(3, '0')),
    author: pair[1]
  };
});

function fallbackContent() {
  return {
    source: 'fallback',
    books: FALLBACK_BOOKS.map(b => Object.assign({}, b)),
    authors: FALLBACK_AUTHORS.map(a => Object.assign({}, a))
  };
}

// Strip control characters and cap length; the frontend renders in a canvas but be safe anyway
function cleanString(value, maxLen) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, maxLen);
}

function authorName(author) {
  if (!author || !author.name) return 'Unknown';
  const full = [author.name.firstName, author.name.lastName].filter(Boolean).join(' ');
  return cleanString(full, 60) || 'Unknown';
}

// ---------------------------------------------------------------------------
// In-memory score store (used when the DB is down) and rate limiter
// ---------------------------------------------------------------------------

let memoryScores = [];   // kept sorted: score desc, then createdAt asc, then insertion order
let memorySeq = 0;
let rateHits = new Map(); // ip -> [timestamps]

function compareScores(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const t = new Date(a.createdAt) - new Date(b.createdAt);
  if (t !== 0) return t;
  return (a._seq || 0) - (b._seq || 0);
}

function publicEntry(e) {
  return {
    name: e.name,
    score: e.score,
    wave: e.wave,
    kills: e.kills,
    createdAt: new Date(e.createdAt).toISOString()
  };
}

function rateLimit(req, res, next) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateHits.set(ip, hits);
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - hits[0])) / 1000);
    res.set('Retry-After', String(Math.max(retryAfter, 1)));
    return res.status(429).json({ error: 'too many submissions, try again later' });
  }
  hits.push(now);
  rateHits.set(ip, hits);
  // Keep the map from growing forever
  if (rateHits.size > 10000) {
    for (const [key, list] of rateHits) {
      if (!list.length || now - list[list.length - 1] >= RATE_LIMIT_WINDOW_MS) rateHits.delete(key);
    }
  }
  next();
}

function checkInt(body, field, min, max, required) {
  const value = body[field];
  if (value === undefined || value === null) {
    return required ? field + ' is required' : null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return field + ' must be an integer';
  }
  if (value < min || value > max) {
    return field + ' must be between ' + min + ' and ' + max;
  }
  return null;
}

// Returns { error } or { value }
function validateScore(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'request body must be a JSON object' };
  }
  if (typeof body.name !== 'string') return { error: 'name is required' };
  const name = body.name.trim();
  if (name.length < 1 || name.length > 12) return { error: 'name must be 1-12 characters' };
  if (!NAME_PATTERN.test(name)) {
    return { error: 'name may only contain letters, digits, spaces, _ and -' };
  }
  const err =
    checkInt(body, 'score', 0, MAX_SCORE, true) ||
    checkInt(body, 'wave', 1, MAX_WAVE, true) ||
    checkInt(body, 'kills', 0, MAX_KILLS, false) ||
    checkInt(body, 'durationMs', 0, MAX_DURATION_MS, false);
  if (err) return { error: err };
  return {
    value: {
      name: name,
      score: body.score,
      wave: body.wave,
      kills: body.kills == null ? 0 : body.kills,
      durationMs: body.durationMs == null ? 0 : body.durationMs
    }
  };
}

function isPlausible(entry) {
  return entry.score <= entry.wave * 5000 + entry.kills * 500;
}

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 10;
  return Math.min(50, Math.max(1, n));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/game', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'views', 'game.html'));
});

router.get('/api/game/content', async function (req, res) {
  if (!dbReady()) return res.json(fallbackContent());
  try {
    const [books, authors] = await Promise.all([
      Book.find({}).limit(60).populate('author').lean().exec(),
      Author.find({}).limit(30).lean().exec()
    ]);
    if (!books.length && !authors.length) return res.json(fallbackContent());
    res.json({
      source: 'db',
      books: books.map(b => ({
        title: cleanString(b.title, 120) || 'Untitled',
        isbn: cleanString(b.isbn, 13),
        author: authorName(b.author)
      })),
      authors: authors.map(a => ({
        name: authorName(a),
        numBooks: Number.isFinite(a.numBooks) ? a.numBooks : 0
      }))
    });
  } catch (err) {
    console.log('Game content query failed, using fallback: ' + err.message);
    res.json(fallbackContent());
  }
});

router.get('/api/scores', async function (req, res) {
  const limit = clampLimit(req.query.limit);
  if (dbReady()) {
    try {
      const rows = await Score.find({}).sort({ score: -1, createdAt: 1 }).limit(limit).lean().exec();
      return res.json(rows.map(publicEntry));
    } catch (err) {
      console.log('Score query failed, using memory store: ' + err.message);
    }
  }
  res.json(memoryScores.slice(0, limit).map(publicEntry));
});

router.post('/api/scores', rateLimit, async function (req, res) {
  const result = validateScore(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const entry = result.value;
  if (!isPlausible(entry)) return res.status(422).json({ error: 'implausible score' });

  if (dbReady()) {
    try {
      const doc = await new Score(entry).save();
      const rank = 1 + await Score.countDocuments({
        $or: [
          { score: { $gt: doc.score } },
          { score: doc.score, createdAt: { $lt: doc.createdAt } }
        ]
      });
      return res.status(201).json({ entry: publicEntry(doc), rank: rank });
    } catch (err) {
      console.log('Saving score to DB failed, using memory store: ' + err.message);
    }
  }

  const stored = Object.assign({}, entry, { createdAt: new Date(), _seq: ++memorySeq });
  // Insert in sorted position (new entry sorts after existing ties)
  let idx = memoryScores.findIndex(e => compareScores(stored, e) < 0);
  if (idx === -1) idx = memoryScores.length;
  memoryScores.splice(idx, 0, stored);
  if (memoryScores.length > MEMORY_STORE_MAX) memoryScores.length = MEMORY_STORE_MAX;
  res.status(201).json({ entry: publicEntry(stored), rank: idx + 1 });
});

// Malformed JSON bodies on the API get a JSON 400 instead of an HTML stack trace.
// Must be mounted with app.use() (error handlers inside a router never see body-parser errors).
function jsonErrorHandler(err, req, res, next) {
  if (req.path.startsWith('/api/') && err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid JSON body' });
  }
  next(err);
}

function _resetRateLimitForTests() {
  rateHits = new Map();
}

function _resetForTests() {
  memoryScores = [];
  memorySeq = 0;
  _resetRateLimitForTests();
}

module.exports = router;
module.exports._resetForTests = _resetForTests;
module.exports._resetRateLimitForTests = _resetRateLimitForTests;
module.exports.jsonErrorHandler = jsonErrorHandler;
module.exports.FALLBACK_BOOKS = FALLBACK_BOOKS;
module.exports.FALLBACK_AUTHORS = FALLBACK_AUTHORS;
module.exports.fallbackContent = fallbackContent;

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../server');
const game = require('../routes/game');

beforeEach(() => game._resetForTests());

function score(overrides) {
  return Object.assign({ name: 'Tester', score: 1000, wave: 1, kills: 0, durationMs: 60000 }, overrides);
}

test('GET /api/game/content returns fallback content without a DB', async () => {
  const res = await request(app).get('/api/game/content').expect(200).expect('Content-Type', /json/);
  assert.equal(res.body.source, 'fallback');
  assert.ok(Array.isArray(res.body.books) && res.body.books.length >= 20);
  assert.ok(Array.isArray(res.body.authors) && res.body.authors.length >= 5);
  for (const b of res.body.books) {
    assert.equal(typeof b.title, 'string');
    assert.equal(typeof b.author, 'string');
    assert.match(b.isbn, /^\d{13}$/);
  }
  for (const a of res.body.authors) {
    assert.equal(typeof a.name, 'string');
    assert.ok(Number.isInteger(a.numBooks));
  }
});

test('POST /api/scores with a valid score returns 201 and rank', async () => {
  const res = await request(app).post('/api/scores').send(score({ name: '  Doge_1  ' })).expect(201);
  assert.equal(res.body.rank, 1);
  assert.equal(res.body.entry.name, 'Doge_1');
  assert.equal(res.body.entry.score, 1000);
  assert.equal(res.body.entry.wave, 1);
  assert.equal(res.body.entry.kills, 0);
  assert.ok(!Number.isNaN(Date.parse(res.body.entry.createdAt)));
});

test('scores are ranked by score desc, then createdAt asc', async () => {
  const post = body => request(app).post('/api/scores').send(body).expect(201);
  assert.equal((await post(score({ name: 'A', score: 500 }))).body.rank, 1);
  assert.equal((await post(score({ name: 'B', score: 3000 }))).body.rank, 1);
  assert.equal((await post(score({ name: 'C', score: 1000 }))).body.rank, 2);
  assert.equal((await post(score({ name: 'D', score: 1000 }))).body.rank, 3); // tie: later entry ranks lower
  assert.equal((await post(score({ name: 'E', score: 0 }))).body.rank, 5);

  const res = await request(app).get('/api/scores').expect(200);
  assert.deepEqual(res.body.map(e => e.name), ['B', 'C', 'D', 'A', 'E']);
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['createdAt', 'kills', 'name', 'score', 'wave']);
});

test('POST /api/scores rejects invalid input with 400', async () => {
  const bad = [
    score({ name: 'bad<name>' }),
    score({ name: 'ThisNameIsWayTooLong' }),
    score({ name: '   ' }),
    score({ name: 42 }),
    score({ score: 10.5 }),
    score({ score: '1000' }),
    score({ score: -1 }),
    score({ wave: undefined }),
    score({ wave: 0 }),
    score({ kills: -3 }),
    score({ durationMs: 86400001 })
  ];
  for (const body of bad) {
    const res = await request(app).post('/api/scores').send(body).expect(400);
    assert.equal(typeof res.body.error, 'string', JSON.stringify(body));
    game._resetForTests(); // keep clear of the rate limiter
  }
});

test('POST /api/scores with malformed JSON returns 400 JSON', async () => {
  const res = await request(app)
    .post('/api/scores')
    .set('Content-Type', 'application/json')
    .send('{"name": ')
    .expect(400);
  assert.equal(typeof res.body.error, 'string');
});

test('POST /api/scores rejects implausible scores with 422', async () => {
  // wave 1, 0 kills -> max plausible score is 5000
  await request(app).post('/api/scores').send(score({ score: 5000 })).expect(201);
  const res = await request(app).post('/api/scores').send(score({ score: 5001 })).expect(422);
  assert.deepEqual(res.body, { error: 'implausible score' });
  // kills raise the ceiling
  await request(app).post('/api/scores').send(score({ score: 5500, kills: 1 })).expect(201);
});

test('GET /api/scores clamps limit to 1..50 (default 10)', async () => {
  // Insert 60 scores, resetting only the rate limiter between batches of 10
  const posts = [];
  for (let i = 0; i < 60; i++) posts.push(score({ name: 'P' + i, score: i * 10 }));
  for (let i = 0; i < posts.length; i += 10) {
    for (const body of posts.slice(i, i + 10)) {
      await request(app).post('/api/scores').send(body).expect(201);
    }
    game._resetRateLimitForTests();
  }

  assert.equal((await request(app).get('/api/scores')).body.length, 10);
  assert.equal((await request(app).get('/api/scores?limit=0')).body.length, 1);
  assert.equal((await request(app).get('/api/scores?limit=-5')).body.length, 1);
  assert.equal((await request(app).get('/api/scores?limit=3')).body.length, 3);
  assert.equal((await request(app).get('/api/scores?limit=1000')).body.length, 50);
  assert.equal((await request(app).get('/api/scores?limit=abc')).body.length, 10);
  const top = (await request(app).get('/api/scores?limit=2')).body;
  assert.deepEqual(top.map(e => e.score), [590, 580]);
});

test('POST /api/scores is rate limited to 10 per minute per IP', async () => {
  for (let i = 0; i < 10; i++) {
    await request(app).post('/api/scores').send(score({ name: 'R' + i })).expect(201);
  }
  const res = await request(app).post('/api/scores').send(score({ name: 'R10' })).expect(429);
  assert.equal(typeof res.body.error, 'string');
  // invalid submissions count too, so spam can't be used to probe validation
  await request(app).post('/api/scores').send({}).expect(429);
});

test('GET /game serves the game page', async (t) => {
  if (!fs.existsSync(path.join(__dirname, '..', 'views', 'game.html'))) {
    t.skip('views/game.html not present yet');
    return;
  }
  await request(app).get('/game').expect(200).expect('Content-Type', /html/);
  await request(app).get('/game/').expect(200).expect('Content-Type', /html/);
});

test('existing pages still work: / serves index.html, unknown routes get the 404 page', async () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.html'), 'utf8');
  const home = await request(app).get('/').expect(200).expect('Content-Type', /html/);
  assert.equal(home.text, index);

  const notFound = await request(app).get('/definitely/not/a/page').expect(404).expect('Content-Type', /html/);
  assert.match(notFound.text, /Error 404 File Not Found/);
});

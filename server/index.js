import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import dayjs from 'dayjs';
import { query, pool } from './db.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOW_ORIGIN?.split(',') ?? "*",
    methods: ['GET','POST']
  }
});

app.use(cors({ origin: process.env.ALLOW_ORIGIN?.split(',') ?? "*" }));
app.use(express.json());
app.use(express.static('client')); // PWA dosyaları

// --------- Yardımcılar ---------
function sign(user) {
  return jwt.sign({ uid: user.id }, process.env.JWT_SECRET, { expiresIn: '10d' });
}
function auth(req, res, next){
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if(!token) return res.status(401).json({error:'Yetkisiz'});
  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.uid };
    next();
  }catch(e){ return res.status(401).json({error:'Token geçersiz'}); }
}
async function getCafeByQrToken(qrToken){
  const { rows } = await query(
    `SELECT t.id as table_id, t.cafe_id, c.name as cafe_name
     FROM tables t JOIN cafes c ON c.id=t.cafe_id WHERE t.qr_token=$1`, [qrToken]);
  return rows[0];
}
async function checkDailyQuota(userId){
  const { rows } = await query(
    `WITH t AS (
      SELECT count(*) AS c FROM matches
      WHERE (p1_user_id=$1 OR p2_user_id=$1) 
        AND started_at::date = current_date
    )
    SELECT CASE WHEN c::int >= 10 THEN 'BLOCK' ELSE 'OK' END as s FROM t`, [userId]);
  return rows[0]?.s || 'OK';
}

// ------- API -------
app.get('/health', (_req,res)=>res.json({ok:true}));

// { personal_id } -> { jwt }
app.post('/auth/login', async (req, res) => {
  const { personal_id } = req.body || {};
  if(!personal_id) return res.status(400).json({error:'personal_id zorunlu'});
  const upsert = await query(
    `INSERT INTO users (personal_id)
     VALUES ($1) ON CONFLICT (personal_id) DO UPDATE SET personal_id=EXCLUDED.personal_id
     RETURNING id`, [personal_id]);
  const user = upsert.rows[0];
  const token = sign(user);
  res.json({ token });
});

// { qr_token } -> { session_id, public_id, table_id, cafe_id }
app.post('/tables/check-in', auth, async (req, res) => {
  const { qr_token } = req.body || {};
  const info = await getCafeByQrToken(qr_token);
  if(!info) return res.status(400).json({error:'QR token bulunamadı'});
  const public_id = 'u' + Math.random().toString(36).slice(2,8);
  const ins = await query(
    `INSERT INTO sessions (user_id, cafe_id, table_id, public_id)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.user.id, info.cafe_id, info.table_id, public_id]);
  const sessionId = ins.rows[0].id;
  res.json({ session_id: sessionId, public_id, cafe_id: info.cafe_id, table_id: info.table_id, cafe_name: info.cafe_name });
});

// Oyun tipleri
app.get('/games', (_req,res)=>{
  res.json([
    { key:'reflex', title:'Refleks Düellosu (BO5)' },
    { key:'math', title:'Hızlı Aritmetik (5 soru)' }
  ]);
});

// İstek oluştur
app.post('/game-requests', auth, async (req,res)=>{
  const { game_type, session_id } = req.body || {};
  if(!game_type || !session_id) return res.status(400).json({error:'game_type ve session_id zorunlu'});
  // session bilgisi
  const { rows: srows } = await query(`SELECT * FROM sessions WHERE id=$1 AND ended_at IS NULL`, [session_id]);
  const s = srows[0];
  if(!s) return res.status(400).json({error:'geçersiz oturum'});
  // kota kontrol
  const quota = await checkDailyQuota(s.user_id);
  if(quota === 'BLOCK') return res.status(403).json({ error:'Günlük 10 maç sınırına ulaşıldı' });
  // TTL 2 dk
  const expires = dayjs().add(2,'minute').toDate();
  const ins = await query(
    `INSERT INTO game_requests (cafe_id, from_table_id, from_user_id, game_type, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [s.cafe_id, s.table_id, s.user_id, game_type, expires]);
  const r = ins.rows[0];
  io.to('cafe_'+s.cafe_id).emit('request.created', { request: r });
  res.json({ request: r });
});

// İsteği kabul et
app.post('/game-requests/:id/accept', auth, async (req,res)=>{
  const id = Number(req.params.id);
  const { session_id } = req.body || {};
  const { rows: srows } = await query(`SELECT * FROM sessions WHERE id=$1 AND ended_at IS NULL`, [session_id]);
  const acceptor = srows[0];
  if(!acceptor) return res.status(400).json({error:'geçersiz oturum'});
  const { rows: rrows } = await query(`SELECT * FROM game_requests WHERE id=$1`, [id]);
  const r = rrows[0];
  if(!r) return res.status(404).json({error:'istek bulunamadı'});
  if(r.cafe_id !== acceptor.cafe_id) return res.status(400).json({error:'farklı kafe'});
  if(r.from_table_id === acceptor.table_id) return res.status(400).json({error:'aynı masadan kabul yasak'});
  if(r.status !== 'PENDING') return res.status(400).json({error:'istek artık alınamaz'});
  const adminExpires = dayjs().add(60,'second').toDate();
  const upd = await query(
    `UPDATE game_requests SET status='AWAIT_ADMIN', accepted_by_user_id=$1, accepted_table_id=$2, admin_expires_at=$3
     WHERE id=$4 RETURNING *`,
    [acceptor.user_id, acceptor.table_id, adminExpires, id]);
  const updated = upd.rows[0];
  io.to('cafe_'+updated.cafe_id).emit('request.accepted', { request: updated });
  res.json({ request: updated });
});

// Admin bekleyenleri listele
app.get('/admin/requests', async (req,res)=>{
  if(req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(401).json({error:'admin key yanlış'});
  const { rows } = await query(`SELECT * FROM game_requests WHERE status='AWAIT_ADMIN' ORDER BY id DESC LIMIT 50`);
  res.json(rows);
});

// Admin onay/red
app.post('/admin/requests/:id/approve', async (req,res)=>{
  if(req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(401).json({error:'admin key yanlış'});
  const id = Number(req.params.id);
  const { rows: rrows } = await query(`SELECT * FROM game_requests WHERE id=$1`, [id]);
  const r = rrows[0];
  if(!r || r.status !== 'AWAIT_ADMIN') return res.status(400).json({error:'geçersiz istek'});
  // Maç oluştur
  const ins = await query(
    `INSERT INTO matches (cafe_id, game_type, p1_user_id, p1_table_id, p2_user_id, p2_table_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [r.cafe_id, r.game_type, r.from_user_id, r.from_table_id, r.accepted_by_user_id, r.accepted_table_id]);
  const m = ins.rows[0];
  await query(`UPDATE game_requests SET status='APPROVED' WHERE id=$1`, [id]);
  io.to('cafe_'+r.cafe_id).emit('request.approved', { requestId: id, match: m });
  io.to('match_'+m.id).emit('match.started', { match: m });
  res.json({ match: m });
});

app.post('/admin/requests/:id/deny', async (req,res)=>{
  if(req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(401).json({error:'admin key yanlış'});
  const id = Number(req.params.id);
  await query(`UPDATE game_requests SET status='DENIED' WHERE id=$1`, [id]);
  res.json({ ok:true });
});

// Liderlik
app.get('/leaderboard', async (req,res)=>{
  const period = req.query.period === 'weekly' ? 'week' : 'day';
  const { rows } = await query(
    `SELECT winner_user_id as user_id, count(*) as wins
     FROM matches
     WHERE winner_user_id IS NOT NULL AND started_at >= date_trunc($1, now())
     GROUP BY winner_user_id
     ORDER BY wins DESC
     LIMIT 20`, [period]);
  res.json(rows);
});

// ---------- Socket.io ----------
const matchStates = new Map(); // matchId -> state

io.on('connection', (socket)=>{
  // Basit katılım
  socket.on('joinCafe', ({ cafe_id })=>{
    socket.join('cafe_'+cafe_id);
  });
  socket.on('joinMatch', ({ match_id })=>{
    socket.join('match_'+match_id);
  });

  // Refleks oyunu (sunucu otoriter)
  socket.on('reflex.ready', ({ match_id })=>{
    const s = matchStates.get(match_id) || { type:'reflex', round:0, scores:{p1:0,p2:0}, started: false };
    if(!s.started){
      s.started = true;
      s.round = 0;
      s.falseStarts = {p1:0,p2:0};
      matchStates.set(match_id, s);
      startReflexRound(match_id);
    }
  });

  socket.on('reflex.tap', ({ match_id, player })=>{
    const s = matchStates.get(match_id);
    if(!s || s.type!=='reflex') return;
    if(s.waitingGo){
      // erken basış -> karşı taraf kazanır
      const other = player==='p1'?'p2':'p1';
      s.scores[other] += 1;
      clearTimeout(s.timer);
      io.to('match_'+match_id).emit('reflex.round', { state:'false_start', by: player, scores: s.scores });
      checkReflexEnd(match_id, s);
      return;
    }
    if(!s.goTime) return;
    const now = Date.now();
    const reaction = now - s.goTime;
    if(s.winnerOfRound) return; // ilk tıklayan kazanır
    s.winnerOfRound = player;
    s.scores[player] += 1;
    io.to('match_'+match_id).emit('reflex.round', { state:'won', by: player, reaction, scores: s.scores });
    clearTimeout(s.timer);
    checkReflexEnd(match_id, s);
  });

  // Math oyunu
  socket.on('math.ready', ({ match_id })=>{
    const qs = generateMathQuestions(5);
    const s = { type:'math', idx:0, total:5, scores:{p1:0,p2:0}, questions: qs };
    matchStates.set(match_id, s);
    io.to('match_'+match_id).emit('math.questions', { questions: qs });
  });
  socket.on('math.answer', ({ match_id, player, index, answer })=>{
    const s = matchStates.get(match_id);
    if(!s || s.type!=='math') return;
    const q = s.questions[index];
    if(q && Number(answer) === q.a){
      s.scores[player] += 1;
    }
    if(index >= s.total-1){
      // bitti
      finishMatchByScores(match_id, s.scores);
    }
  });
});

function startReflexRound(match_id){
  const s = matchStates.get(match_id);
  if(!s) return;
  s.round += 1;
  s.winnerOfRound = null;
  s.goTime = null;
  s.waitingGo = true;
  io.to('match_'+match_id).emit('reflex.round', { state:'get_ready', round: s.round, scores: s.scores });
  const delay = 1000 + Math.floor(Math.random()*3000);
  s.timer = setTimeout(()=>{
    s.waitingGo = false;
    s.goTime = Date.now();
    io.to('match_'+match_id).emit('reflex.round', { state:'go', round: s.round });
    // 2 sn içinde kimse basmazsa yeni tur
    s.timer = setTimeout(()=>{
      io.to('match_'+match_id).emit('reflex.round', { state:'timeout', round: s.round });
      startReflexRound(match_id);
    }, 2000);
  }, delay);
}

async function checkReflexEnd(match_id, s){
  if(s.scores.p1 >= 3 || s.scores.p2 >= 3 || s.round >= 5){
    await finishMatchByScores(match_id, s.scores);
  }else{
    setTimeout(()=>startReflexRound(match_id), 800);
  }
}

function generateMathQuestions(n){
  const ops = ['+','-','×'];
  const qs = [];
  for(let i=0;i<n;i++){
    const a = Math.floor(Math.random()*9)+1;
    const b = Math.floor(Math.random()*9)+1;
    const op = ops[Math.floor(Math.random()*ops.length)];
    let ans;
    if(op==='+') ans=a+b;
    else if(op==='-') ans=a-b;
    else ans=a*b;
    qs.push({ q:`${a} ${op} ${b}`, a: ans });
  }
  return qs;
}

async function finishMatchByScores(match_id, scores){
  // skorları kaydet ve sonucu yayınla
  const { rows } = await query(`SELECT * FROM matches WHERE id=$1`, [match_id]);
  const m = rows[0];
  if(!m || m.ended_at) return;
  let result='DRAW', winner_user_id=null;
  if(scores.p1 > scores.p2){ result='P1_WIN'; winner_user_id=m.p1_user_id; }
  else if(scores.p2 > scores.p1){ result='P2_WIN'; winner_user_id=m.p2_user_id; }
  await query(`UPDATE matches SET ended_at=now(), result=$2, p1_score=$3, p2_score=$4, winner_user_id=$5 WHERE id=$1`,
    [match_id, result, scores.p1, scores.p2, winner_user_id]);
  io.to('match_'+match_id).emit('match.ended', { result, scores });
}

// Sunucu başlat
const PORT = process.env.PORT || 8080;
server.listen(PORT, ()=>{
  console.log('Server running on http://localhost:'+PORT);
});

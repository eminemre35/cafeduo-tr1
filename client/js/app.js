import { connectSocket } from './socket.js';

const toast = (m)=>{
  const t = document.getElementById('toast');
  t.textContent = m;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1400);
};

function getToken(){ return localStorage.getItem('token'); }
function setToken(t){ localStorage.setItem('token', t); }
async function api(path, opts={}){
  opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  const tok = getToken();
  if(tok) opts.headers['Authorization'] = 'Bearer '+tok;
  const res = await fetch(path, opts);
  if(!res.ok) throw new Error((await res.json()).error || 'İstek hatası');
  return res.json();
}

let socket;
let cafeId = null;
let sessionId = null;
const requestTimers = new Map();

window.addEventListener('load', async ()=>{
  // PWA
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('/sw.js'); }catch{}
  }

  document.getElementById('btnLogin').addEventListener('click', onLogin);
  document.getElementById('btnCheckIn').addEventListener('click', onCheckIn);

  // Butonlar
  document.getElementById('btnReqReflex').addEventListener('click', ()=>createRequest('reflex'));
  document.getElementById('btnReqMath').addEventListener('click', ()=>createRequest('math'));
  document.getElementById('btnAcceptReflex').addEventListener('click', ()=>loadRequests());
  document.getElementById('btnAcceptMath').addEventListener('click', ()=>loadRequests());

  // Socket
  socket = connectSocket();
  socket.on('request.created', ({ request })=> addOrUpdateRequestRow(request));
  socket.on('request.accepted', ({ request })=> addOrUpdateRequestRow(request));
  socket.on('request.approved', ({ requestId, match })=> {
    removeRequestRow(requestId);
    toast('Maç başlıyor');
  });
});

async function onLogin(){
  try{
    const personal_id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'p_'+Math.random().toString(36).slice(2);
    const { token } = await api('/auth/login', { method:'POST', body: JSON.stringify({ personal_id }) });
    setToken(token);
    toast('Giriş başarılı');
  }catch(e){ toast(e.message); }
}

async function onCheckIn(){
  try{
    const qr_token = document.getElementById('qrToken').value.trim();
    if(!qr_token) return toast('QR token girin');
    const { session_id, cafe_id, table_id, cafe_name } = await api('/tables/check-in', { method:'POST', body: JSON.stringify({ qr_token }) });
    sessionId = session_id;
    cafeId = cafe_id;
    socket.emit('joinCafe', { cafe_id });
    document.getElementById('checkinInfo').textContent = `Kafe: ${cafe_name} • Masa ID: ${table_id} • Oturum: ${sessionId}`;
    toast('Masanıza bağlandınız');
  }catch(e){ toast(e.message); }
}

async function createRequest(game_type){
  if(!sessionId) return toast('Önce check‑in yapın');
  try{
    const { request } = await api('/game-requests', { method:'POST', body: JSON.stringify({ game_type, session_id: sessionId }) });
    addOrUpdateRequestRow(request);
    toast('İstek oluşturuldu');
  }catch(e){ toast(e.message); }
}

function shouldDisplayRequest(r){
  return ['PENDING','AWAIT_ADMIN'].includes(r.status);
}

function addOrUpdateRequestRow(r, { prepend = true } = {}){
  if(!shouldDisplayRequest(r)){
    removeRequestRow(r.id);
    return;
  }
  const tb = document.querySelector('#tblRequests tbody');
  let tr = document.getElementById('req-'+r.id);
  if(!tr){
    tr = document.createElement('tr');
    tr.id = 'req-'+r.id;
    tr.innerHTML = `<td class="req-id"></td>
      <td class="req-game"></td>
      <td class="req-table"></td>
      <td class="req-status"><span class="status-text"></span><span class="status-ttl"></span></td>
      <td class="req-action"></td>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Kabul Et';
    btn.addEventListener('click', ()=>acceptRequest(r.id));
    tr.querySelector('.req-action').appendChild(btn);
    if(prepend){ tb.prepend(tr); } else { tb.appendChild(tr); }
  }
  renderRequestRow(tr, r);
  startRequestTimer(r);
}

function renderRequestRow(tr, r){
  tr.querySelector('.req-id').textContent = r.id;
  tr.querySelector('.req-game').textContent = r.game_type;
  tr.querySelector('.req-table').textContent = `${r.from_table_id}→${r.accepted_table_id||'-'}`;
  const statusText = tr.querySelector('.status-text');
  statusText.textContent = statusLabel(r.status);
  const ttlSpan = tr.querySelector('.status-ttl');
  ttlSpan.textContent = '';
  const btn = tr.querySelector('button');
  btn.disabled = r.status !== 'PENDING';
}

function statusLabel(status){
  switch(status){
    case 'PENDING': return 'Açık';
    case 'AWAIT_ADMIN': return 'Admin onayı bekleniyor';
    default: return status;
  }
}

function startRequestTimer(r){
  clearRequestTimer(r.id);
  const expiresAt = getRelevantExpiry(r);
  if(!expiresAt) return;
  const update = ()=>{
    const tr = document.getElementById('req-'+r.id);
    if(!tr){
      clearRequestTimer(r.id);
      return;
    }
    const ttlSpan = tr.querySelector('.status-ttl');
    const diff = expiresAt - Date.now();
    if(diff <= 0){
      ttlSpan.textContent = ' (süre doldu)';
      clearRequestTimer(r.id);
      removeRequestRow(r.id);
      return;
    }
    const seconds = Math.ceil(diff / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    ttlSpan.textContent = ` (${m}:${String(s).padStart(2,'0')} kaldı)`;
  };
  update();
  const timerId = window.setInterval(update, 1000);
  requestTimers.set(r.id, timerId);
}

function getRelevantExpiry(r){
  const source = r.status === 'AWAIT_ADMIN' ? r.admin_expires_at : r.expires_at;
  if(!source) return null;
  const date = new Date(source);
  if(Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function clearRequestTimer(id){
  const timerId = requestTimers.get(id);
  if(timerId){
    window.clearInterval(timerId);
    requestTimers.delete(id);
  }
}

function removeRequestRow(id){
  clearRequestTimer(id);
  const tr = document.getElementById('req-'+id);
  if(tr) tr.remove();
}

function resetRequestTable(){
  requestTimers.forEach((timerId)=>window.clearInterval(timerId));
  requestTimers.clear();
  document.querySelector('#tblRequests tbody').innerHTML = '';
}

async function loadRequests(){
  if(!getToken()) return toast('Önce giriş yapın');
  try{
    const params = new URLSearchParams();
    if(cafeId) params.set('cafe_id', cafeId);
    const qs = params.toString();
    const { requests } = await api(`/game-requests${qs ? `?${qs}` : ''}`);
    resetRequestTable();
    requests.forEach((request)=> addOrUpdateRequestRow(request, { prepend: false }));
    toast(requests.length ? 'İstek listesi güncellendi' : 'Şu anda açık istek yok');
  }catch(e){ toast(e.message); }
}

async function acceptRequest(id){
  if(!sessionId) return toast('Önce check‑in yapın');
  try{
    const { request } = await api(`/game-requests/${id}/accept`, { method:'POST', body: JSON.stringify({ session_id: sessionId }) });
    addOrUpdateRequestRow(request, { prepend: false });
    toast('Admin onayı bekleniyor');
    await waitForApproval(request.id);
  }catch(e){ toast(e.message); }
}

function waitForApproval(requestId){
  return new Promise((resolve)=>{
    const handler = ({ requestId: rid, match })=>{
      if(rid === requestId){
        toast('Onaylandı — maça gidiliyor');
        window.location.href = `/match.html?match=${match.id}&game=${match.game_type}`;
        socket.off('request.approved', handler);
        resolve();
      }
    };
    socket.on('request.approved', handler);
  });
}

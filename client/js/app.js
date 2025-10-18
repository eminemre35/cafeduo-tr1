import { connectSocket } from './socket.js';

const toast = (m)=>{ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1400); };

function getToken(){ return localStorage.getItem('token'); }
function setToken(t){ localStorage.setItem('token', t); }
async function api(path, opts={}){
  opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  const tok = getToken(); if(tok) opts.headers['Authorization'] = 'Bearer '+tok;
  const res = await fetch(path, opts);
  if(!res.ok) throw new Error((await res.json()).error || 'İstek hatası');
  return res.json();
}

let socket;
let cafeId = null;
let sessionId = null;

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
  socket.on('request.created', ({ request })=> addRequestRow(request));
  socket.on('request.accepted', ({ request })=> updateRequestRow(request));
  socket.on('request.approved', ({ match })=> {
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
    sessionId = session_id; cafeId = cafe_id;
    socket.emit('joinCafe', { cafe_id });
    document.getElementById('checkinInfo').textContent = `Kafe: ${cafe_name} • Masa ID: ${table_id} • Oturum: ${sessionId}`;
    toast('Masanıza bağlandınız');
  }catch(e){ toast(e.message); }
}

async function createRequest(game_type){
  if(!sessionId) return toast('Önce check‑in yapın');
  try{
    const { request } = await api('/game-requests', { method:'POST', body: JSON.stringify({ game_type, session_id: sessionId }) });
    addRequestRow(request);
    toast('İstek oluşturuldu');
  }catch(e){ toast(e.message); }
}

function addRequestRow(r){
  const tb = document.querySelector('#tblRequests tbody');
  let tr = document.getElementById('req-'+r.id);
  if(!tr){
    tr = document.createElement('tr'); tr.id='req-'+r.id;
    tr.innerHTML = `<td>${r.id}</td><td>${r.game_type}</td><td>${r.from_table_id}→${r.accepted_table_id||'-'}</td><td>${r.status}</td>
    <td><button class="btn btn-primary" data-id="${r.id}">Kabul Et</button></td>`;
    tb.prepend(tr);
    tr.querySelector('button').addEventListener('click', ()=>acceptRequest(r.id));
  }else{
    updateRequestRow(r);
  }
}

function updateRequestRow(r){
  const tr = document.getElementById('req-'+r.id);
  if(!tr) return;
  tr.children[2].textContent = `${r.from_table_id}→${r.accepted_table_id||'-'}`;
  tr.children[3].textContent = r.status;
}

async function loadRequests(){
  // basit: socket'tan anlık yakalıyoruz; burada sadece kullanıcıyı tabloya bakmaya yönlendiriyoruz
  toast('Açılan istekler aşağıdaki tabloda görünecek. Kabul etmek için tıklayın.');
}

async function acceptRequest(id){
  if(!sessionId) return toast('Önce check‑in yapın');
  try{
    const { request } = await api(`/game-requests/${id}/accept`, { method:'POST', body: JSON.stringify({ session_id: sessionId }) });
    updateRequestRow(request);
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

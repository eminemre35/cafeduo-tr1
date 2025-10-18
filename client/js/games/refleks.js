export function mount({ socket, matchId }){
  const root = document.getElementById('gameRoot');
  root.innerHTML = `
    <div class="center" style="padding:16px">
      <h3>Refleks Düellosu</h3>
      <p class="small">Ekranda <b>GO!</b> görünce <b>boşluk</b> tuşuna basın veya dokunun.</p>
      <div id="stage" style="font-size:1.6rem; margin:14px 0;">Hazır mısın?</div>
      <div id="scores" class="small">Skor — Sen:0 Rakip:0</div>
      <button id="start" class="btn btn-primary">Başlat</button>
    </div>`;

  const stage = root.querySelector('#stage');
  const scoresEl = root.querySelector('#scores');
  const startBtn = root.querySelector('#start');
  let me = 'p1'; // basit: ilk giren p1 kabul edilir
  let scores = {p1:0,p2:0};
  function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1200); }

  startBtn.addEventListener('click', ()=>{
    socket.emit('reflex.ready', { match_id: matchId });
    startBtn.disabled = true;
  });

  function onTap(){
    socket.emit('reflex.tap', { match_id: matchId, player: me });
  }
  window.addEventListener('keydown', (e)=>{ if(e.code==='Space') onTap(); });
  root.addEventListener('click', onTap);

  socket.on('reflex.round', (msg)=>{
    if(msg.scores){ scores = msg.scores; scoresEl.textContent = `Skor — Sen:${me==='p1'?scores.p1:scores.p2} Rakip:${me==='p1'?scores.p2:scores.p1}`; }
    if(msg.state==='get_ready'){ stage.textContent = 'Hazır olun…'; }
    if(msg.state==='go'){ stage.textContent = 'GO!'; }
    if(msg.state==='won'){ stage.textContent = (msg.by===me? 'Raundu kazandın!':'Rakip aldı.'); }
    if(msg.state==='false_start'){ stage.textContent = (msg.by===me? 'Erken bastın!': 'Rakip erken bastı, puan senin.'); }
    if(msg.state==='timeout'){ stage.textContent = 'Süre doldu, tekrar.'; }
  });

  socket.on('match.ended', ({ result, scores })=>{
    let txt = 'Berabere.';
    if((result==='P1_WIN' && me==='p1') || (result==='P2_WIN' && me==='p2')) txt='Kazandın!';
    else if(result==='DRAW') txt='Berabere.';
    else txt='Kaybettin.';
    stage.textContent = txt + ` (Sen:${me==='p1'?scores.p1:scores.p2} Rakip:${me==='p1'?scores.p2:scores.p1})`;
    toast('Maç bitti');
  });
}

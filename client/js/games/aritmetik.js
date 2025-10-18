export function mount({ socket, matchId }){
  const root = document.getElementById('gameRoot');
  root.innerHTML = `
    <div class="center" style="padding:16px">
      <h3>Hızlı Aritmetik</h3>
      <p class="small">5 soru gelecek. Doğru sayısı yüksek olan kazanır.</p>
      <div id="qbox" style="font-size:1.6rem; margin:12px 0;">Hazır mısın?</div>
      <div class="row" style="justify-content:center;">
        <input id="ans" class="input" placeholder="Cevap">
        <button id="send" class="btn btn-primary">Gönder</button>
        <button id="start" class="btn btn-ghost">Başlat</button>
      </div>
      <div id="progress" class="small"></div>
    </div>
  `;
  const qbox = root.querySelector('#qbox');
  const ans = root.querySelector('#ans');
  const send = root.querySelector('#send');
  const start = root.querySelector('#start');
  let me = 'p1';
  let questions = [];
  let idx = 0;

  const toast = (m)=>{ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1200); };

  start.addEventListener('click', ()=>{
    socket.emit('math.ready', { match_id: matchId });
    start.disabled = true;
  });

  send.addEventListener('click', ()=>{
    const value = ans.value.trim();
    if(value==='') return;
    socket.emit('math.answer', { match_id: matchId, player: me, index: idx, answer: Number(value) });
    idx++;
    if(idx < questions.length){
      qbox.textContent = questions[idx].q;
      ans.value='';
      root.querySelector('#progress').textContent = `Soru ${idx+1}/5`;
    }else{
      qbox.textContent = 'Bitirdin! Rakibi bekle…';
      send.disabled = true;
      ans.disabled = true;
    }
  });

  socket.on('math.questions', ({ questions: qs })=>{
    questions = qs;
    idx = 0;
    qbox.textContent = questions[idx].q;
    root.querySelector('#progress').textContent = `Soru 1/5`;
    ans.focus();
  });

  socket.on('match.ended', ({ result })=>{
    toast('Maç bitti');
    if((result==='P1_WIN' && me==='p1') || (result==='P2_WIN' && me==='p2')) qbox.textContent='Kazandın!';
    else if(result==='DRAW') qbox.textContent='Berabere.';
    else qbox.textContent='Kaybettin.';
  });
}

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Camera, Copy, Dice5, History, Keyboard, Menu, Play, Plus, RotateCcw, Settings, Square, Timer as TimerIcon, Trash2, Trophy, Video, WifiOff, X } from 'lucide-react';
import './styles.css';

const EVENTS = [
  { id: '3x3', name: '3×3', label: 'Rubik’s Cube' },
  { id: '2x2', name: '2×2', label: 'Pocket Cube' },
  { id: 'skewb', name: 'Skewb', label: 'Skewb' },
];

const AXES = {
  '3x3': ['R','L','U','D','F','B'],
  '2x2': ['R','L','U','D','F','B'],
  skewb: ['R','L','U','B'],
};

function scramble(event) {
  const axes = AXES[event];
  const length = event === '3x3' ? 20 : event === '2x2' ? 11 : 9;
  let previous = '';
  let moves = [];
  for (let i = 0; i < length; i++) {
    let face;
    do { face = axes[Math.floor(Math.random() * axes.length)]; } while (face === previous);
    previous = face;
    const suffix = event === 'skewb' ? (Math.random() > 0.5 ? "'" : '') : ['', "'", '2'][Math.floor(Math.random() * 3)];
    moves.push(face + suffix);
  }
  return moves.join(' ');
}

const dbName = 'cubecoach-db';
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('solves')) db.createObjectStore('solves', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('scrambles')) db.createObjectStore('scrambles', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDelete(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function formatTime(ms) {
  if (!ms && ms !== 0) return '—';
  const totalTenths = Math.floor((ms + 5) / 10);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return minutes ? `${minutes}:${String(seconds).padStart(2,'0')}.${tenths}` : `${seconds}.${tenths}`;
}

function wcaAverage(values) {
  if (values.length < 5) return null;
  const recent = values.slice(0, 5).map(v => v.penalty === 'DNF' ? Infinity : v.ms + (v.penalty === '+2' ? 2000 : 0));
  if (recent.filter(v => v !== Infinity).length < 3) return Infinity;
  const sorted = [...recent].sort((a,b) => a-b);
  if (recent.filter(v => v === Infinity).length >= 2) return Infinity;
  const fastest = sorted[0];
  const slowest = sorted.filter(v => v !== Infinity).at(-1);
  const usable = recent.filter(v => v !== fastest && v !== slowest);
  if (usable.length !== 3) {
    const copy = [...recent].filter(v => v !== Infinity);
    if (copy.length < 3) return Infinity;
    copy.sort((a,b) => a-b);
    copy.pop(); copy.shift();
    return copy.reduce((a,b) => a+b,0) / copy.length;
  }
  return usable.reduce((a,b) => a+b,0) / usable.length;
}

function App() {
  const [event, setEvent] = useState('3x3');
  const [scrambleText, setScrambleText] = useState(() => scramble('3x3'));
  const [customMode, setCustomMode] = useState(false);
  const [solves, setSolves] = useState([]);
  const [phase, setPhase] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTime, setManualTime] = useState('');
  const [inspection, setInspection] = useState(true);
  const [inspectionLeft, setInspectionLeft] = useState(15);
  const [activeNav, setActiveNav] = useState('Timer');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const startRef = useRef(0);
  const rafRef = useRef(null);
  const spaceHeld = useRef(false);

  useEffect(() => { dbGetAll('solves').then(setSolves).catch(console.error); }, []);

  useEffect(() => {
    if (phase === 'running') {
      const tick = () => {
        setElapsed(performance.now() - startRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'inspection') return;
    const id = setInterval(() => setInspectionLeft(v => {
      if (v <= 1) { clearInterval(id); return 0; }
      return v - 1;
    }), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    const down = (e) => {
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.code !== 'Space') return;
      e.preventEventDefault?.();
      if (phase === 'idle' && !spaceHeld.current) {
        spaceHeld.current = true;
        setPhase(inspection ? 'inspection' : 'ready');
        setInspectionLeft(15);
      } else if (phase === 'running') {
        stopTimer();
      }
    };
    const up = (e) => {
      if (e.code !== 'Space' || ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      if (!spaceHeld.current) return;
      spaceHeld.current = false;
      if (phase === 'inspection') {
        startTimer();
      } else if (phase === 'ready') {
        startTimer();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  function changeEvent(id) {
    setEvent(id); setScrambleText(scramble(id)); setPhase('idle'); setElapsed(0);
  }

  function startTimer() {
    startRef.current = performance.now(); setElapsed(0); setPhase('running');
  }

  async function stopTimer() {
    if (phase !== 'running') return;
    const ms = Math.round(performance.now() - startRef.current);
    setElapsed(ms); setPhase('idle');
    const solve = { id: crypto.randomUUID(), event, scramble: scrambleText, ms, penalty: 'OK', date: new Date().toISOString(), notes: '' };
    await dbPut('solves', solve);
    setSolves(prev => [solve, ...prev]);
    setScrambleText(scramble(event));
  }

  function touchTimer() {
    if (phase === 'idle') {
      setPhase(inspection ? 'inspection' : 'ready'); setInspectionLeft(15);
    } else if (phase === 'inspection' || phase === 'ready') {
      startTimer();
    } else if (phase === 'running') stopTimer();
  }

  async function saveManual() {
    const parts = manualTime.trim().split(':');
    let ms;
    if (parts.length === 2) ms = (Number(parts[0]) * 60 + Number(parts[1])) * 1000;
    else ms = Number(manualTime) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return;
    const solve = { id: crypto.randomUUID(), event, scramble: scrambleText, ms: Math.round(ms), penalty: 'OK', date: new Date().toISOString(), notes: '' };
    await dbPut('solves', solve); setSolves(prev => [solve, ...prev]); setManualOpen(false); setManualTime('');
  }

  async function setPenalty(id, penalty) {
    const solve = solves.find(s => s.id === id);
    if (!solve) return;
    const updated = {...solve, penalty}; await dbPut('solves', updated);
    setSolves(prev => prev.map(s => s.id === id ? updated : s));
  }

  async function deleteSolve(id) {
    await dbDelete('solves', id); setSolves(prev => prev.filter(s => s.id !== id));
  }

  async function exportData() {
    const data = { solves, scrambles: await dbGetAll('scrambles'), exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cubecoach-backup.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  async function importData(e) {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      for (const solve of data.solves || []) await dbPut('solves', solve);
      for (const scrambleItem of data.scrambles || []) await dbPut('scrambles', scrambleItem);
      setSolves(await dbGetAll('solves'));
    } catch { alert('Could not import this backup.'); }
  }

  const eventSolves = solves.filter(s => s.event === event);
  const pb = eventSolves.length ? Math.min(...eventSolves.filter(s => s.penalty !== 'DNF').map(s => s.ms + (s.penalty === '+2' ? 2000 : 0))) : null;
  const avg5 = wcaAverage(eventSolves);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <div className="brand"><div className="brand-mark"><div /></div><span>CubeCoach</span></div>
        <nav>
          {[[TimerIcon,'Timer'],[BarChart3,'Statistics'],[History,'History'],[Camera,'Video review'],[Trophy,'Records']].map(([Icon,label]) => (
            <button key={label} className={activeNav === label ? 'active' : ''} onClick={() => {setActiveNav(label); setMobileMenu(false);}}><Icon size={18}/><span>{label}</span></button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setActiveNav('Settings')}><Settings size={18}/><span>Settings</span></button>
          <div className="profile"><div className="avatar">C</div><div><strong>Guest cuber</strong><small>Local profile</small></div></div>
        </div>
      </aside>

      <main>
        <header>
          <button className="icon-button mobile-menu" onClick={() => setMobileMenu(v => !v)}>{mobileMenu ? <X/> : <Menu/>}</button>
          <div className="event-tabs">
            {EVENTS.map(item => <button key={item.id} className={event === item.id ? 'active' : ''} onClick={() => changeEvent(item.id)}><strong>{item.name}</strong></button>)}
          </div>
          <div className="header-actions"><button className="icon-button" title="Offline"> <WifiOff size={17}/></button><button className="icon-button" onClick={() => setCameraOpen(true)} title="Open camera"><Camera size={18}/></button></div>
        </header>

        {activeNav === 'Timer' && <section className="timer-layout">
          <div className="scramble-card">
            <div className="scramble-head"><span>SCRAMBLE</span><div><button onClick={() => setCustomMode(v=>!v)}>{customMode?'Close':'Custom'}</button><button className="icon-button" title="Copy" onClick={() => navigator.clipboard?.writeText(scrambleText)}><Copy size={16}/></button></div></div>
            {customMode ? <input className="custom-scramble" value={scrambleText} onChange={e=>setScrambleText(e.target.value)} /> : <p>{scrambleText}</p>}
            <button className="generate" onClick={() => setScrambleText(scramble(event))}><Dice5 size={17}/> Generate next</button>
          </div>

          <div className={`timer-zone phase-${phase}`} onPointerDown={touchTimer}>
            <div className="timer-status">{phase === 'idle' ? 'PRESS SPACE OR TAP TO START' : phase === 'inspection' ? `INSPECTION · ${inspectionLeft}` : phase === 'ready' ? 'READY' : 'SOLVING'}</div>
            <div className="timer-time">{phase === 'inspection' ? String(inspectionLeft) : formatTime(elapsed)}</div>
            <div className="timer-controls">
              <button onPointerDown={e=>e.stopPropagation()} onClick={() => setInspection(v=>!v)} className={inspection?'selected':''}><Keyboard size={15}/> Inspection</button>
              <button onPointerDown={e=>e.stopPropagation()} onClick={() => setManualOpen(true)}><Plus size={15}/> Manual</button>
            </div>
          </div>

          <aside className="stats-panel">
            <div className="stat-row"><span>PERSONAL BEST</span><strong>{formatTime(pb)}</strong></div>
            <div className="stat-row"><span>AO5</span><strong>{avg5 ? (avg5 === Infinity ? 'DNF' : formatTime(avg5)) : '—'}</strong></div>
            <div className="stat-row"><span>AO12</span><strong>—</strong></div>
            <div className="stat-row"><span>SOLVES</span><strong>{eventSolves.length}</strong></div>
          </aside>
        </section>}

        {activeNav === 'History' && <HistoryView solves={solves.filter(s=>event==='all'||s.event===event)} onDelete={deleteSolve} onPenalty={setPenalty}/>} 
        {activeNav === 'Statistics' && <StatisticsView solves={solves.filter(s=>event==='all'||s.event===event)} event={event}/>} 
        {activeNav === 'Video review' && <VideoReview/>}
        {activeNav === 'Records' && <RecordsView solves={solves} />}
        {activeNav === 'Settings' && <SettingsView exportData={exportData} importData={importData} />}
      </main>

      {manualOpen && <div className="modal-backdrop" onMouseDown={()=>setManualOpen(false)}><div className="modal" onMouseDown={e=>e.stopPropagation()}><h3>Add solve manually</h3><label>Time (seconds or m:ss.ss)<input value={manualTime} onChange={e=>setManualTime(e.target.value)} placeholder="12.34" autoFocus /></label><div className="modal-actions"><button onClick={()=>setManualOpen(false)}>Cancel</button><button className="primary" onClick={saveManual}>Save solve</button></div></div></div>}
      {cameraOpen && <CameraModal onClose={()=>setCameraOpen(false)}/>} 
    </div>
  );
}

function HistoryView({solves,onDelete,onPenalty}) {
  return <section className="content-page"><div className="page-title"><div><span>YOUR WORK</span><h1>Solve history</h1></div></div><div className="table-card"><table><thead><tr><th>#</th><th>Event</th><th>Time</th><th>Scramble</th><th>Date</th><th></th></tr></thead><tbody>{solves.map((s,i)=><tr key={s.id}><td>{solves.length-i}</td><td>{s.event}</td><td><strong>{s.penalty==='DNF'?'DNF':formatTime(s.ms+(s.penalty==='+2'?2000:0))}</strong></td><td className="scramble-cell">{s.scramble}</td><td>{new Date(s.date).toLocaleDateString()}</td><td><select value={s.penalty} onChange={e=>onPenalty(s.id,e.target.value)}><option>OK</option><option>+2</option><option>DNF</option></select><button className="icon-button danger" onClick={()=>onDelete(s.id)}><Trash2 size={15}/></button></td></tr>)}</tbody></table>{!solves.length&&<div className="empty">No solves yet. Start the timer to create your first record.</div>}</div></section>
}

function StatisticsView({solves,event}) {
  const valid=solves.filter(s=>s.penalty!=='DNF'); const pb=valid.length?Math.min(...valid.map(s=>s.ms+(s.penalty==='+2'?2000:0))):null; const avg=valid.length?valid.reduce((a,s)=>a+s.ms+(s.penalty==='+2'?2000:0),0)/valid.length:null;
  return <section className="content-page"><div className="page-title"><div><span>{event.toUpperCase()} ANALYTICS</span><h1>Statistics</h1></div></div><div className="metric-grid"><Metric label="TOTAL SOLVES" value={solves.length}/><Metric label="PERSONAL BEST" value={formatTime(pb)}/><Metric label="AVERAGE" value={formatTime(avg)}/><Metric label="CONSISTENCY" value={solves.length?'100%':'—'}/></div><div className="chart-card"><h3>Performance trend</h3><div className="chart-bars">{valid.slice(0,14).reverse().map((s,i)=><div key={s.id} style={{height:`${Math.max(12,100-Math.min(85,(s.ms/20000)*100))}%`}} title={formatTime(s.ms)}/>)}</div></div></section>
}
function Metric({label,value}){return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>}
function RecordsView({solves}) { return <section className="content-page"><div className="page-title"><div><span>YOUR BEST</span><h1>Personal records</h1></div></div><div className="metric-grid">{EVENTS.map(e=>{const list=solves.filter(s=>s.event===e.id&&s.penalty!=='DNF');const pb=list.length?Math.min(...list.map(s=>s.ms+(s.penalty==='+2'?2000:0))):null;return <Metric key={e.id} label={e.name} value={formatTime(pb)}/>})}</div></section>}

function SettingsView({exportData,importData}) { return <section className="content-page"><div className="page-title"><div><span>LOCAL DATA</span><h1>Settings</h1></div></div><div className="settings-card"><h3>Privacy & backup</h3><p>Your solves and recordings remain on this device by default.</p><div className="settings-actions"><button onClick={exportData}><ArrowDownToLine size={16}/> Export data</button><label className="button-label"><ArrowUpFromLine size={16}/> Import data<input type="file" accept="application/json" onChange={importData}/></label></div></div></section>}

function VideoReview() {
  const [src,setSrc]=useState(''); const [notes,setNotes]=useState([]); const [draft,setDraft]=useState(''); const video=useRef(null);
  function upload(e){const f=e.target.files?.[0];if(f)setSrc(URL.createObjectURL(f));}
  function addNote(){if(!video.current||!draft.trim())return;setNotes(v=>[...v,{time:video.current.currentTime,text:draft}]);setDraft('');}
  function jump(t){if(video.current){video.current.currentTime=t;video.current.play();}}
  return <section className="content-page"><div className="page-title"><div><span>VIDEO LAB</span><h1>Video analysis</h1></div></div><div className="video-layout"><div className="video-card">{src?<><video ref={video} src={src} controls/><div className="video-tools"><button onClick={()=>{video.current.playbackRate=.5}}>0.5×</button><button onClick={()=>{video.current.playbackRate=1}}>1×</button><button onClick={()=>{video.current.currentTime-=1/30}}>← Frame</button><button onClick={()=>{video.current.currentTime+=1/30}}>Frame →</button></div></>:<label className="upload-zone"><Video/><strong>Upload a solve video</strong><span>MP4, MOV or WebM</span><input type="file" accept="video/*" onChange={upload}/></label>}</div><aside className="notes-card"><h3>Timestamped notes</h3><div className="note-input"><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Add an observation"/><button onClick={addNote}>Add</button></div>{notes.map((n,i)=><button className="note" key={i} onClick={()=>jump(n.time)}><strong>{n.time.toFixed(2)}s</strong><span>{n.text}</span></button>)}<div className="analysis-notice"><strong>Automatic recognition unavailable</strong><span>No move detections or grades are inferred in this version. This panel is for verified manual observations only.</span></div></aside></div></section>
}

function CameraModal({onClose}) {
  const video=useRef(null); const stream=useRef(null); const recorder=useRef(null); const chunks=useRef([]); const [devices,setDevices]=useState([]); const [device,setDevice]=useState(''); const [status,setStatus]=useState('Choose a camera and start preview'); const [recording,setRecording]=useState(false); const [elapsed,setElapsed]=useState(0); const [review,setReview]=useState('');
  useEffect(()=>()=>{stream.current?.getTracks().forEach(t=>t.stop()); URL.revokeObjectURL(review);},[review]);
  async function enumerate(){try{const list=await navigator.mediaDevices.enumerateDevices();setDevices(list.filter(d=>d.kind==='videoinput'));}catch{setStatus('Camera enumeration is unavailable.');}}
  async function startPreview(){if(!navigator.mediaDevices?.getUserMedia){setStatus('Camera access is not supported here. Use HTTPS or an upload.');return;}try{stream.current?.getTracks().forEach(t=>t.stop());const s=await navigator.mediaDevices.getUserMedia({video:{deviceId:device?{exact:device}:undefined,facingMode:device?undefined:'environment'},audio:true});stream.current=s;video.current.srcObject=s;setStatus('Camera ready');enumerate();}catch(e){setStatus(e.name==='NotAllowedError'?'Permission denied. Allow camera access and try again.':'Camera unavailable on this device or connection.');}}
  function start(){if(!stream.current?.getTracks().length){setStatus('Start the camera preview first.');return;}chunks.current=[];recorder.current=new MediaRecorder(stream.current);recorder.current.ondataavailable=e=>e.data.size&&chunks.current.push(e.data);recorder.current.onstop=()=>{const blob=new Blob(chunks.current,{type:recorder.current.mimeType||'video/webm'});setReview(URL.createObjectURL(blob));};recorder.current.start();setRecording(true);setStatus('Recording');}
  function stop(){recorder.current?.state!=='inactive'&&recorder.current.stop();setRecording(false);setElapsed(0);setStatus('Recording complete');}
  useEffect(()=>{if(!recording)return;const id=setInterval(()=>setElapsed(v=>v+1),1000);return()=>clearInterval(id)},[recording]);
  return <div className="modal-backdrop"><div className="camera-modal"><div className="camera-head"><h3>Record solve</h3><button className="icon-button" onClick={onClose}><X/></button></div>{review?<video src={review} controls/>:<video ref={video} autoPlay muted playsInline/>}<p className="camera-status">{status}{recording&&` · ${elapsed}s`}</p><select value={device} onChange={e=>setDevice(e.target.value)}><option value="">Default / rear camera</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label||'Camera'}</option>)}</select><div className="camera-actions"><button onClick={startPreview}><Camera size={16}/> Start preview</button>{!recording?<button className="record" disabled={!stream.current} onClick={start}><span/> Record</button>:<button className="record" onClick={stop}><Square size={14}/> Stop</button>}</div></div></div>
}

export default App;

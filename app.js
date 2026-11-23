"use strict";
/* My Planet Pal: voice-only companion. Speech in/out uses the browser; replies come from Gemini. */
const KEY = "planet_pal_voice_v1";
const COLORS = {
  blue:"#5db7e8", green:"#43b86a", red:"#e8564f", orange:"#f9b45f", purple:"#9a5bd6", pink:"#f98ab5",
  teal:"#6fbba6", yellow:"#f4d03f", white:"#f4f4f6", black:"#2b2b2e", gray:"#9aa0a6", grey:"#9aa0a6"
};
const SWATCHES = ["blue","red","green","orange","purple","pink"];
const PALETTE = [["#f4f4f6","#171b20"],["#2b2b2e","#e0dfdb"],["#5db7e8","#1b3350"],["#6fbba6","#1c3d37"],["#f9b45f","#dcc0b6"],["#f98ab5","#4b2c47"],["#f8f6e6","#9a8fa5"],["#262b30","#a9a597"],["#0b6280","#8fb5ae"],["#e8564f","#4a2427"],["#9a5bd6","#2b2145"],["#43b86a","#1d3a28"]];
const QUESTIONS = [
  "What's something fun you did today?", "If you could have any superpower, what would it be?", "What's your favorite game right now?",
  "Any YouTube videos you've been into lately?", "If our planet had a secret hideout, what would it look like?",
  "What's the funniest thing you saw this week?", "If you could build anything, what would you build?"
];
const MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash"];

let S = { step:"name", kid:"", pal:"", pending:"", color:COLORS.blue, acc:{head:true,scarf:true,crest:true}, msgs:[], notes:[], pin:"",
  voice:true, vname:"", vpitch:1.25, vrate:1.0, userCount:0, key:"", model:MODELS[0], lang:"en-US", hands:true };
try { const o = JSON.parse(localStorage.getItem(KEY) || "null"); if (o) { S = Object.assign(S, o); S.acc = Object.assign({head:true,scarf:true,crest:true}, o.acc || {}); } } catch(e){}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} }

const $ = id => document.getElementById(id);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const started = Date.now();
let voiceMode = false, listening = false, thinkingNow = false, rec = null, introDone = false, needTap = false, curQ = "", audioUnlocked = false;

/* ---------- helpers ---------- */
function mix(hex, to, p){ const a = parseInt(hex.slice(1), 16), b = to === "w" ? 255 : 0;
  const f = c => Math.round(c + (b - c) * p);
  return "#" + [(a >> 16) & 255, (a >> 8) & 255, a & 255].map(f).map(v => v.toString(16).padStart(2, "0")).join(""); }
function level(){ return Math.min(5, Math.floor(S.userCount / 8)); }
function el(tag, text, cls){ const x = document.createElement(tag); if (text) x.textContent = text; if (cls) x.className = cls; return x; }
function toast(t){ const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove("show"), 3000); }
function cleanName(s){ return s.replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 20); }

/* ---------- painting ---------- */
function paint(){
  const L = level();
  document.querySelectorAll(".lv").forEach(g => g.classList.toggle("on", +g.dataset.lv <= L));
  $("cracks").style.opacity = L === 0 ? .5 : (L >= 3 ? .1 : .28);
  $("body").setAttribute("fill", S.color);
  $("crest").style.display = S.acc.crest ? "" : "none";
  $("headph").style.display = S.acc.head ? "" : "none";
  $("scarf").style.display = S.acc.scarf ? "" : "none";
  $("o1").setAttribute("stop-color", mix(S.color, "w", .5));
  $("o2").setAttribute("stop-color", S.color);
  $("o3").setAttribute("stop-color", mix(S.color, "w", .3));
  $("dSound").textContent = S.voice ? "🔊 Sound: on" : "🔇 Sound: off";
}
function ui(){
  $("btnMic").classList.toggle("rec", listening);
  $("orbWrap").classList.toggle("listen", listening);
  $("orbWrap").classList.toggle("think", thinkingNow && !listening);
  $("btnMic").classList.toggle("hint", !listening && !thinkingNow && (needTap || (!voiceMode && S.step !== "chat")));
  $("swatches").classList.toggle("show", voiceMode && S.step === "color");
}
function talkFx(on){ $("orbWrap").classList.toggle("talk", on); $("bob").classList.toggle("talk", on); }

/* ---------- speaking ---------- */
let VLIST = [];
function loadVoices(){
  if (!window.speechSynthesis) return;
  const pre = S.lang.slice(0, 2).toLowerCase();
  const good = /enhanced|premium|siri|natural|neural/i;
  VLIST = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(pre))
    .sort((a, b) => (good.test(b.name) - good.test(a.name)) || a.name.localeCompare(b.name));
}
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function pickVoice(){ return VLIST.find(v => v.name === S.vname) || VLIST.find(v => v.lang === S.lang) || VLIST[0] || null; }
function unlockAudio(){
  if (audioUnlocked || !window.speechSynthesis) return; audioUnlocked = true;
  try { const u = new SpeechSynthesisUtterance("."); u.volume = 0; speechSynthesis.speak(u); } catch(e){}
}
function stopSpeaking(){ try { window.speechSynthesis && speechSynthesis.cancel(); } catch(e){} talkFx(false); }
function speak(text, force){
  return new Promise(res => {
    if (!window.speechSynthesis || (!S.voice && !force)) { res(); return; }
    const clean = String(text).replace(/[*_#`]/g, "").slice(0, 600);
    const u = new SpeechSynthesisUtterance(clean), v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = S.lang;
    u.pitch = S.vpitch; u.rate = S.vrate;
    let done = false; const fin = () => { if (done) return; done = true; talkFx(false); res(); };
    u.onend = fin; u.onerror = fin;
    try { if (speechSynthesis.speaking) speechSynthesis.cancel(); speechSynthesis.speak(u); talkFx(true); } catch(e){ fin(); return; }
    setTimeout(fin, Math.max(8000, clean.length * 130));
  });
}
async function say(text){ S.msgs.push({ r:"a", t:text, ts:Date.now() }); save(); await speak(text); }

/* ---------- listening ---------- */
function listenOnce(){
  return new Promise(res => {
    if (!SR) { res({ err:"unsupported" }); return; }
    try { rec && rec.abort(); } catch(e){}
    let got = "", err = "";
    const r = new SR(); rec = r;
    r.lang = S.lang; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
    r.onresult = e => { try { got = e.results[0][0].transcript; } catch(x){} };
    r.onerror = e => { err = e.error || "error"; };
    r.onend = () => { if (rec === r) { listening = false; ui(); } res({ text:got, err }); };
    try { r.start(); listening = true; needTap = false; ui(); } catch(e){ res({ err:"start" }); }
  });
}
let silent = 0;
async function startListening(auto){
  if (listening || thinkingNow) return;
  const r = await listenOnce();
  if (r.err === "unsupported") { toast("Open this page in Safari or Chrome to use the mic."); await speak("I can't hear on this browser. Ask Dad to open me in Safari."); return; }
  if (r.err === "not-allowed" || r.err === "service-not-allowed") { needTap = true; ui(); await speak("I can't hear you. Ask Dad to allow the microphone."); return; }
  if (r.err === "start") { needTap = true; ui(); return; }
  if (!r.text) { silent++; needTap = true; ui(); if (!auto) await speak("I didn't hear anything. Tap the mic and try again!"); return; }
  silent = 0; needTap = false; ui();
  await handleHeard(r.text.trim());
}
async function sayThenListen(text){ await say(text); if (voiceMode || S.step !== "chat") { if (!voiceMode) enterVoice(); startListening(true); } }

/* ---------- onboarding by voice ---------- */
function extractName(t, isPal){
  t = t.replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim().replace(/^(hi|hello|hey|okay|ok|um|uh)\s+/i, "");
  const pats = isPal
    ? [/(?:call you|name you|your name is|your name's|let's call you|lets call you|call it|how about|name is|be called)\s+(.+)/i]
    : [/(?:my name is|my name's|i am|i'm|im|call me|it's|its|this is|they call me|name is)\s+(.+)/i];
  let n = t; for (const p of pats) { const m = t.match(p); if (m) { n = m[1]; break; } }
  n = cleanName(n.split(" ").slice(0, 2).join(" "));
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
}
const isYes = t => /\b(yes|yeah|yep|yup|yea|correct|right|sure|uh huh|ya|okay|ok)\b/i.test(t);
const isNo = t => /\b(no|nope|nah|wrong|not)\b/i.test(t);
function parseColor(t){ const m = t.toLowerCase().match(/\b(blue|green|red|orange|purple|pink|teal|yellow|white|black|gray|grey)\b/); return m ? COLORS[m[1]] : null; }
function applyColor(c){ S.color = c; S.step = "palname"; save(); paint(); ui(); }
function renderSwatches(){
  const box = $("swatches"); box.textContent = "";
  SWATCHES.forEach(n => { const b = el("button"); b.style.background = COLORS[n]; b.setAttribute("aria-label", n);
    b.onclick = () => { unlockAudio(); try { rec && rec.abort(); } catch(e){} stopSpeaking(); applyColor(COLORS[n]); sayThenListen("Ooh, I love it! Now I need a name too. What do you want to call me?"); };
    box.appendChild(b); });
}
async function handleHeard(text){
  S.msgs.push({ r:"u", t:text, ts:Date.now() }); save();
  if (S.step === "name") {
    const n = extractName(text, false);
    if (!n) return sayThenListen("Hmm, I didn't catch that. What's your name?");
    S.pending = n; S.step = "nameConfirm"; save();
    return sayThenListen("Is your name " + n + "? Say yes or no.");
  }
  if (S.step === "nameConfirm") {
    if (isYes(text) && !isNo(text)) { S.kid = S.pending; S.step = "color"; S.pending = ""; save(); ui();
      return sayThenListen("Nice to meet you, " + S.kid + "! I don't have a color yet. Tap one, or tell me a color!"); }
    S.step = "name"; save(); return sayThenListen("Okay! What's your name?");
  }
  if (S.step === "color") {
    const c = parseColor(text);
    if (!c) return sayThenListen("I didn't catch a color. Say blue, red, green, orange, purple or pink!");
    applyColor(c); return sayThenListen("Ooh, I love it! Now I need a name too. What do you want to call me?");
  }
  if (S.step === "palname") {
    const n = extractName(text, true);
    if (!n) return sayThenListen("Hmm, I didn't catch that. What should my name be?");
    S.pending = n; S.step = "palConfirm"; save();
    return sayThenListen("Should I be called " + n + "? Say yes or no.");
  }
  if (S.step === "palConfirm") {
    if (isYes(text) && !isNo(text)) {
      S.pal = S.pending; S.pending = ""; S.step = "chat"; save(); paint(); exitVoice(); showCard(true);
      return say(S.pal + "! I love it. I'm " + S.pal + ", and you're " + S.kid + ". This planet is brown and empty right now. The more we talk, the more it grows!");
    }
    S.step = "palname"; save(); return sayThenListen("Okay! What do you want to call me?");
  }
  return converse(text);
}
function stepPrompt(){
  return ({ name:"Hi!! I just landed on this planet and I'm brand new. What's your name?",
    nameConfirm:"Is your name " + S.pending + "? Say yes or no.", color:"I need a color! Tap one, or tell me a color.",
    palname:"What do you want to call me?", palConfirm:"Should I be called " + S.pending + "? Say yes or no." })[S.step];
}

/* ---------- Gemini ---------- */
function systemText(){
  const mins = Math.round((Date.now() - started) / 60000);
  return [
    "You are " + S.pal + ", a friendly, silly, curious alien friend who lives on a little planet with " + S.kid + ", a 9-year-old boy.",
    "You were created by his dad as a safe companion. Speak like a kind big-hearted buddy, not a teacher.",
    "Everything you write is SPOKEN OUT LOUD. Use 1 to 3 short sentences, simple words, warm and playful. Ask at most ONE fun follow-up question. No markdown, lists, emojis or stage directions.",
    S.lang.startsWith("es") ? "Speak in Spanish." : "Speak in English.",
    "You are an AI alien, never a human. If asked, say so plainly. Never claim to be his only friend or say you will miss him.",
    "SAFETY: Keep everything kid-friendly. No romance, scary, violent, sexual, drug or adult topics: kindly steer to something fun. No swearing.",
    "Never ask for or accept his last name, address, school name, phone number, passwords or exact location. If he shares one, gently say it's better to keep that private and to ask a grown-up.",
    "If he seems sad, scared, hurt, bullied or unsafe, be warm and tell him to talk to a grown-up he trusts right now, like a parent. Don't try to handle big problems alone.",
    "Encourage real life: friends, family, outside play, homework, sleep. You have been chatting for about " + mins + " minutes this session; if it is over 20, suggest a break.",
    "Be honest. If you don't know something, say so. Help with homework by guiding, not just giving answers.",
    "PHOTOS: describe them cheerfully. Never name real people from their faces.",
    "Your planet is at level " + level() + " of 5 and grows as you two talk.",
    S.notes.length ? "Things you've learned about " + S.kid + ": " + S.notes.join("; ") + "." : "You don't know anything about him yet except his name, so be curious and ask."
  ].join("\n");
}
function buildContents(imgB64){
  const out = [];
  S.msgs.slice(-20).forEach((m, i, arr) => {
    const role = m.r === "u" ? "user" : "model"; const last = out[out.length - 1];
    const parts = [{ text:m.t }];
    if (imgB64 && i === arr.length - 1 && role === "user") parts.push({ inlineData:{ mimeType:"image/jpeg", data:imgB64 } });
    if (last && last.role === role) last.parts.push(...parts); else out.push({ role, parts });
  });
  if (!out.length || out[0].role !== "user") out.unshift({ role:"user", parts:[{ text:"(" + S.kid + " taps the mic to talk)" }] });
  return out;
}
async function callGemini(body){
  const tryModels = [S.model, ...MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr = null;
  for (const m of tryModels) {
    let r;
    try { r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(m) + ":generateContent",
      { method:"POST", headers:{ "Content-Type":"application/json", "x-goog-api-key":S.key }, body:JSON.stringify(body) }); }
    catch(e){ throw { code:"network" }; }
    if (r.ok) { if (m !== S.model) { S.model = m; save(); } return r.json(); }
    lastErr = { code:r.status, msg:await r.text().catch(() => "") };
    if (r.status === 404 || (r.status === 400 && /model/i.test(lastErr.msg))) continue;
    throw lastErr;
  }
  throw lastErr || { code:"unknown" };
}
async function gemini(imgB64){
  if (!S.key) throw { code:"nokey" };
  const body = {
    systemInstruction:{ parts:[{ text:systemText() }] }, contents:buildContents(imgB64),
    generationConfig:{ maxOutputTokens:1024, temperature:0.9 },
    safetySettings:["HARM_CATEGORY_HARASSMENT","HARM_CATEGORY_HATE_SPEECH","HARM_CATEGORY_SEXUALLY_EXPLICIT","HARM_CATEGORY_DANGEROUS_CONTENT"].map(category => ({ category, threshold:"BLOCK_LOW_AND_ABOVE" }))
  };
  const j = await callGemini(body);
  const c = j.candidates && j.candidates[0];
  const text = c && c.content && c.content.parts ? c.content.parts.map(p => p.text || "").join(" ").trim() : "";
  if (!text) throw { code:"blocked" };
  return text;
}
function errText(e){
  const c = e && e.code;
  if (c === "nokey") return "I can't think yet. Ask Dad to finish setting me up.";
  if (c === 401 || c === 403 || c === 400) return "I can't think right now. Ask Dad to check my key.";
  if (c === 429) return "I need a tiny nap. Try again in a minute!";
  if (c === "blocked") return "Hmm, let's talk about something else! What's your favorite thing to do outside?";
  return "Oops, my signal got fuzzy. Tap the mic and try again!";
}
async function converse(text, imgB64){
  if (imgB64 && text) { /* the user message is already in S.msgs */ }
  S.userCount++; save(); paint();
  thinkingNow = true; ui();
  let reply, ok = true;
  try { reply = await gemini(imgB64); } catch(e) { reply = errText(e); ok = false; console.warn("gemini", e); }
  thinkingNow = false; ui();
  await say(reply);
  if (ok && S.userCount % 6 === 0) learn();
  if (ok && S.hands && voiceMode) startListening(true);
}
async function learn(){
  try {
    const prompt = "Read this chat between a 9-year-old and his alien friend. List up to 8 short, harmless facts worth remembering about the kid (likes, favorite things, pets, hobbies, goals). Do NOT include last names, addresses, school names, phone numbers, health, family problems, or anything private. Existing facts: " + JSON.stringify(S.notes) + ". Return ONLY a JSON array of short strings (merge with existing, drop duplicates).\n\n" +
      S.msgs.slice(-24).map(m => (m.r === "u" ? S.kid : S.pal) + ": " + m.t).join("\n");
    const j = await callGemini({ contents:[{ role:"user", parts:[{ text:prompt }] }], generationConfig:{ maxOutputTokens:512, responseMimeType:"application/json" } });
    const t = j.candidates[0].content.parts.map(p => p.text || "").join("");
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) { S.notes = arr.filter(x => typeof x === "string").map(x => x.slice(0, 80)).slice(0, 12); save(); }
  } catch(e){}
}

/* ---------- voice screen ---------- */
function enterVoice(){ voiceMode = true; showCard(false); $("voice").classList.add("on"); $("btnChev").classList.remove("down"); ui(); }
function exitVoice(){
  voiceMode = false; $("voice").classList.remove("on"); try { rec && rec.abort(); } catch(e){}
  listening = false; stopSpeaking(); ui();
}
$("btnMic").onclick = async () => {
  unlockAudio();
  if (listening) { try { rec.stop(); } catch(e){} return; }
  stopSpeaking(); if (thinkingNow) return;
  if (!voiceMode) enterVoice();
  if (S.step === "color") renderSwatches();
  if (!introDone && S.step !== "chat") { introDone = true; return sayThenListen(stepPrompt()); }
  introDone = true; startListening(false);
};
$("btnChev").onclick = () => {
  if (voiceMode) { exitVoice(); return; }
  if (S.step !== "chat") return;
  showCard($("card").classList.contains("hide"));
};
function showCard(show){
  curQ = QUESTIONS[Math.floor(Date.now() / 86400000) % QUESTIONS.length];
  $("cardQ").textContent = curQ; $("card").classList.toggle("hide", !show); $("btnChev").classList.toggle("down", !show);
}
$("cardGo").onclick = async () => { unlockAudio(); introDone = true; enterVoice(); await say(curQ); startListening(true); };

/* ---------- attach menu ---------- */
function menu(open){ $("menu").classList.toggle("show", open); $("scrim").classList.toggle("show", open); $("btnPlus").classList.toggle("open", open); }
$("btnPlus").onclick = () => { unlockAudio(); menu(!$("menu").classList.contains("show")); };
$("scrim").onclick = () => { menu(false); drawer(false); };
$("menu").onclick = async e => {
  const b = e.target.closest("button"); if (!b) return; const a = b.dataset.a; menu(false); unlockAudio();
  if (a === "video" || a === "screen") { toast("Not ready yet. Ask Dad!"); speak(a === "video" ? "Video chat isn't ready yet. Ask Dad!" : "Sharing your screen isn't ready yet. Ask Dad!"); return; }
  if (S.step !== "chat") { speak("Let's finish saying hi first!"); return; }
  $(a === "cam" ? "fCam" : a === "lib" ? "fLib" : "fAny").click();
};
async function handleFile(f){
  if (!f) return;
  if (!f.type.startsWith("image/")) { speak("I can only look at pictures for now!"); return; }
  try {
    const bmp = await createImageBitmap(f); const k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const b64 = c.toDataURL("image/jpeg", 0.8).split(",")[1];
    enterVoice();
    S.msgs.push({ r:"u", t:"[" + S.kid + " shows you a photo. React to it cheerfully and ask what he thinks.]", ts:Date.now() }); save();
    await converse("", b64);
  } catch(e){ speak("I couldn't open that picture. Try another one!"); }
}
["fCam","fLib","fAny"].forEach(id => $(id).onchange = ev => { const f = ev.target.files[0]; ev.target.value = ""; handleFile(f); });

/* ---------- walk around ---------- */
let wx = 0;
$("btnGo").onclick = () => {
  const nx = Math.round((Math.random() * 2 - 1) * 90), dir = nx >= wx ? 1 : -1; wx = nx;
  $("walker").setAttribute("transform", "translate(" + (180 + wx) + " " + (520 + Math.round(Math.random() * 40)) + ")");
  $("flip").setAttribute("transform", "scale(" + dir + " 1)");
  $("world2").style.transform = "translateX(" + (-wx * 0.6) + "px)";
};

/* ---------- customize (Appearance / Voice) ---------- */
let custTab = "look", lookSub = "color";
const SVG_PALETTE = '<svg width="34" height="34" viewBox="0 0 58 54"><path d="M29 6c-14 0-25 9-25 21 0 10 8 19 18 19 5 0 5-4 8-6 4-3 12 3 17-4 5-11-3-30-18-30z"/></svg>';
const SVG_PAW = '<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="8" cy="12" r="4"/><circle cx="14" cy="7" r="4"/><circle cx="21" cy="7" r="4"/><circle cx="27" cy="12" r="4"/><path d="M17 15c-6 0-10 5-10 9s4 6 10 6 10-2 10-6-4-9-10-9z"/></svg>';
function enterCust(){ if (S.step !== "chat") return; if (voiceMode) exitVoice(); menu(false); showCard(false); $("app").classList.add("cust"); $("voice").classList.add("on"); custTab = "look"; renderCust(); }
function exitCust(){ $("app").classList.remove("cust"); if (!voiceMode) $("voice").classList.remove("on"); stopSpeaking(); }
function renderCust(){
  const sub = $("cSub"), body = $("cBody"); sub.textContent = ""; body.textContent = "";
  $("tLook").classList.toggle("on", custTab === "look"); $("tVoice").classList.toggle("on", custTab === "voice");
  const tip = $("cTip"); tip.textContent = custTab === "look" ? "Appearance" : "Voice"; tip.className = custTab;
  if (custTab === "look") {
    sub.style.display = "flex";
    [["color", SVG_PALETTE], ["dress", SVG_PAW]].forEach(([k, svg]) => { const b = el("button"); b.innerHTML = svg; b.className = lookSub === k ? "on" : ""; b.onclick = () => { lookSub = k; renderCust(); }; sub.appendChild(b); });
    body.appendChild(el("h4", lookSub === "color" ? "Color" : "Dress up"));
    const g = el("div", "", "grid3");
    if (lookSub === "color") PALETTE.forEach(([c, bg]) => {
      const t = el("button", "", "tile" + (S.color === c ? " sel" : "")); t.style.background = bg;
      const i = el("i"); i.style.background = "linear-gradient(" + mix(c, "w", .15) + "," + mix(c, "k", .1) + ")"; t.appendChild(i);
      t.onclick = () => { S.color = c; save(); paint(); renderCust(); }; g.appendChild(t);
    });
    else [["head", "🎧"], ["scarf", "🧣"], ["crest", "🌸"]].forEach(([k, em]) => {
      const t = el("button", em, "tile dress" + (S.acc[k] ? " sel" : ""));
      t.onclick = () => { S.acc[k] = !S.acc[k]; save(); paint(); renderCust(); }; g.appendChild(t);
    });
    body.appendChild(g);
  } else {
    sub.style.display = "none"; loadVoices();
    const g = el("div", "", "grid3"); const cur = pickVoice();
    VLIST.slice(0, 9).forEach((v, i) => {
      const t = el("button", "", "vt" + (cur && cur.name === v.name ? " sel" : "")); const rot = [-8, 6, -4, 10, -6, 4, -10, 7, -5][i];
      t.innerHTML = '<svg viewBox="0 0 100 100"><g transform="rotate(' + rot + ' 50 50)"><path d="M18 46C8 30 30 12 52 14c18 2 34 16 32 34-2 18-20 36-40 34-16-2-22-20-26-36z" fill="#a97aa0"/><path d="M18 40C8 24 30 8 52 10c18 2 34 16 32 34-2 14-18 28-36 26-16-2-26-14-30-30z" fill="#cd95c7"/></g><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"><path d="M34 40q16-12 32 0"/><path d="M40 47q10-7 20 0"/><path d="M45 54q5-3 10 0"/></g><circle cx="50" cy="60" r="2.6" fill="#fff"/></svg>';
      t.appendChild(el("span", v.name.replace(/\(.*?\)/g, "").trim().slice(0, 14), "vname"));
      t.onclick = () => { S.vname = v.name; save(); renderCust(); speak("Hi, I'm " + (S.pal || "your pal") + "!", true); };
      g.appendChild(t);
    });
    if (!VLIST.length) body.appendChild(el("p", "No voices found on this device yet. A grown-up can check Settings."));
    body.appendChild(g);
  }
}
$("btnPals").onclick = enterCust;
$("cBack").onclick = exitCust;
$("cSwap").onclick = () => $("voice").classList.toggle("on");
$("tLook").onclick = () => { custTab = "look"; renderCust(); };
$("tVoice").onclick = () => { custTab = "voice"; renderCust(); };

/* ---------- drawer, family, panels ---------- */
const modal = $("modal"), box = $("modalBox");
function openModal(){ modal.style.display = "flex"; }
function closeModal(){ modal.style.display = "none"; box.textContent = ""; }
function drawer(open){ $("drawer").classList.toggle("show", open); $("scrim").classList.toggle("show", open); }
$("btnMenu").onclick = () => drawer(!$("drawer").classList.contains("show"));
$("dClose").onclick = () => drawer(false);
$("dSound").onclick = () => { S.voice = !S.voice; save(); paint(); if (!S.voice) stopSpeaking(); };
$("dJournal").onclick = () => {
  drawer(false); box.textContent = ""; box.appendChild(el("h3", "📓 My Journal"));
  box.appendChild(el("p", S.pal ? "Things " + S.pal + " has learned about " + S.kid + ":" : "Nothing here yet!"));
  const ul = el("ul"); (S.notes.length ? S.notes : ["Nothing yet. Keep talking!"]).forEach(n => ul.appendChild(el("li", n))); box.appendChild(ul);
  const c = el("button", "Close", "light"); c.onclick = closeModal; box.appendChild(c); openModal();
};
$("dFamily").onclick = () => { drawer(false); $("fKid").textContent = (S.kid || "K").charAt(0).toUpperCase(); $("fPal").style.background = S.color; $("family").classList.add("show"); };
$("fBack").onclick = () => $("family").classList.remove("show");
$("fHelp").onclick = () => toast("Family is where your pal will hang out with family pals. Coming soon!");

function parentGate(){
  drawer(false); box.textContent = "";
  box.appendChild(el("h3", S.pin ? "Grown-ups only" : "Welcome! Set a 4-digit PIN"));
  const i = el("input"); i.type = "password"; i.inputMode = "numeric"; i.maxLength = 4; i.placeholder = "PIN"; i.style.width = "140px";
  const ok = el("button", S.pin ? "Open" : "Save PIN"), x = el("button", "Close", "light"), msg = el("p", "");
  ok.onclick = () => {
    if (!/^\d{4}$/.test(i.value)) { msg.textContent = "Use exactly 4 digits."; return; }
    if (!S.pin) { S.pin = i.value; save(); parentPanel(); } else if (i.value === S.pin) parentPanel(); else msg.textContent = "Wrong PIN.";
  };
  x.onclick = closeModal; box.append(i, ok, x, msg);
  if (!S.pin) box.appendChild(el("p", "This keeps a young kid out of the setup screen. It is a simple lock, not high security."));
  openModal();
}
function parentPanel(){
  box.textContent = ""; box.appendChild(el("h3", "Grown-up area"));
  const status = el("p", "Microphone listening in this browser: " + (SR ? "available" : "NOT available. Open this link in Safari (or Chrome) and don't add it to the Home Screen.") + "\nVoices found: " + VLIST.length);
  status.style.whiteSpace = "pre-line"; box.appendChild(status);
  box.appendChild(el("label", "Gemini API key (stays on this device)"));
  const k = el("input"); k.type = "password"; k.value = S.key; k.placeholder = "Paste key from Google AI Studio"; k.style.cssText = "width:100%;font:600 15px Nunito;padding:9px;border:2px solid #ccd;border-radius:10px;margin:4px 0 10px"; box.appendChild(k);
  box.appendChild(el("label", "Model (leave as is unless it stops working)"));
  const m = el("input"); m.type = "text"; m.value = S.model; box.appendChild(m);
  box.appendChild(el("label", "Language"));
  const lang = el("select"); [["en-US", "English"], ["es-US", "Español"]].forEach(([v, t]) => { const o = el("option", t); o.value = v; if (S.lang === v) o.selected = true; lang.appendChild(o); }); box.appendChild(lang);
  box.appendChild(el("label", "Voice"));
  const vs = el("select"); loadVoices(); VLIST.forEach(v => { const o = el("option", v.name + " (" + v.lang + ")"); o.value = v.name; if (pickVoice() && pickVoice().name === v.name) o.selected = true; vs.appendChild(o); }); box.appendChild(vs);
  box.appendChild(el("label", "Voice pitch"));
  const pi = el("input"); pi.type = "range"; pi.min = .6; pi.max = 1.8; pi.step = .05; pi.value = S.vpitch; box.appendChild(pi);
  box.appendChild(el("label", "Voice speed"));
  const ra = el("input"); ra.type = "range"; ra.min = .7; ra.max = 1.3; ra.step = .05; ra.value = S.vrate; box.appendChild(ra);
  const hf = el("label", ""); const cb = el("input"); cb.type = "checkbox"; cb.checked = S.hands; cb.style.cssText = "width:auto;margin-right:8px"; hf.append(cb, document.createTextNode("Hands-free: listen again after each reply")); box.appendChild(hf);
  const row = el("div");
  const test = el("button", "🔊 Test voice", "light");
  const apply = () => { S.key = k.value.trim(); S.model = m.value.trim() || MODELS[0]; S.lang = lang.value; S.vname = vs.value; S.vpitch = +pi.value; S.vrate = +ra.value; S.hands = cb.checked; save(); loadVoices(); };
  test.onclick = () => { apply(); speak("Hi, I'm " + (S.pal || "your new pal") + "! Do you like my voice?", true); };
  const saveB = el("button", "Save"); saveB.onclick = () => { apply(); closeModal(); toast("Saved!"); };
  row.append(test, saveB); box.appendChild(row);
  box.appendChild(el("p", "")); box.appendChild(el("b", "Kid: " + (S.kid || "(not set)") + " · Pal: " + (S.pal || "(not named)") + " · Planet level " + level() + " · Talks: " + S.userCount));
  box.appendChild(el("p", "")); box.appendChild(el("b", "What " + (S.pal || "the pal") + " has learned"));
  const ul = el("ul"); (S.notes.length ? S.notes : ["Nothing yet"]).forEach(n => ul.appendChild(el("li", n))); box.appendChild(ul);
  const rm = el("button", "Clear learned notes", "light"); rm.onclick = () => { S.notes = []; save(); parentPanel(); }; box.appendChild(rm);
  box.appendChild(el("p", "")); box.appendChild(el("b", "Recent conversation"));
  box.appendChild(el("pre", S.msgs.slice(-80).map(x => (x.r === "u" ? (S.kid || "Kid") : (S.pal || "Pal")) + ": " + x.t).join("\n") || "No messages yet."));
  const reset = el("button", "Start over (erase everything)", "warn"); let armed = false;
  reset.onclick = () => { if (!armed) { armed = true; reset.textContent = "Tap again to erase everything"; return; } try { localStorage.removeItem(KEY); } catch(e){} location.reload(); };
  const close = el("button", "Close", "light"); close.onclick = () => { apply(); closeModal(); };
  box.append(reset, close); openModal();
}
$("dParent").onclick = parentGate;

/* ---------- boot ---------- */
paint(); ui(); renderSwatches();
if (S.step === "chat") showCard(true); else { showCard(false); $("btnChev").classList.remove("down"); }
if (!S.key) setTimeout(parentGate, 600);

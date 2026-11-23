/* Carol Songs - app.js
   Interface and behavior: Android phone check, navigation, drawers, custom modals,
   pages (to-do, calculator), library, player and settings.
   Needs songs.js (catalog, storage) and download.js (network) loaded first. */
(function(){
'use strict';

/* ================= Desktop blocker ================= */
function dvIsAndroidPhone(){
  var ua = navigator.userAgent || '';
  var android = /Android/i.test(ua);
  var mobile = /Mobile/i.test(ua);
  var touch = (navigator.maxTouchPoints || 0) > 0;
  var coarse = false;
  try{ coarse = window.matchMedia('(pointer: coarse)').matches; }catch(e){ coarse = true; }
  return android && mobile && touch && coarse;
}
if(!dvIsAndroidPhone()){
  document.getElementById('dvBlock').hidden = false;
  return;
}
document.getElementById('dvApp').hidden = false;

/* ================= Modules (songs.js and download.js load first) ================= */
var DV = window.DV;
var dbPut = DV.db.put, dbPutMany = DV.db.putMany, dbDel = DV.db.del;
var dbGet = DV.db.get, dbAll = DV.db.all, dbKeys = DV.db.keys;

/* ================= Helpers ================= */
var $ = function(id){ return document.getElementById(id); };
var audio = $('dvAudio');
var NS = 'http://www.w3.org/2000/svg';

function icon(name){
  var s = document.createElementNS(NS,'svg');
  s.setAttribute('class','dv-i');
  s.setAttribute('viewBox','0 0 24 24');
  var u = document.createElementNS(NS,'use');
  u.setAttribute('href','#i-'+name);
  s.appendChild(u);
  return s;
}
function el(tag, cls, text){
  var e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}
function setIcon(btn, name){
  var u = btn.querySelector('use');
  if(u) u.setAttribute('href','#i-'+name);
}
function fmt(t){
  if(!isFinite(t) || t < 0) t = 0;
  var m = Math.floor(t/60), s = Math.floor(t%60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function plural(n, one, many){ return n + ' ' + (n === 1 ? one : many); }

/* ================= Haptics ================= */
var H = { tap: 8, ok: [14,40,14], warn: [40,50,40], err: [70,50,70] };
function hap(p){
  try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){}
}

/* ================= Settings ================= */
var SKEY = 'dvCarolSettings';
var S = { dark: null, fs: 19, view: 'list', todo: '', counters: {}, offlineNote: false, lastId: '', vol: 80, seeded: [] };
try{ Object.assign(S, JSON.parse(localStorage.getItem(SKEY) || '{}')); }catch(e){}
function saveS(){ try{ localStorage.setItem(SKEY, JSON.stringify(S)); }catch(e){} }

/* ================= Toast (screen center) ================= */
var toastTimer = 0;
function toast(msg, kind){
  var t = $('dvToast');
  t.textContent = msg;
  t.classList.add('dv-show');
  if(kind === 'ok') hap(H.ok);
  else if(kind === 'warn') hap(H.warn);
  else if(kind === 'error') hap(H.err);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('dv-show'); }, 2400);
}

/* ================= Spinner (screen center) ================= */
var loader = {
  items: new Map(), n: 0,
  show: function(label, opt){
    var id = ++this.n;
    this.items.set(id, { label: label, opt: opt || {} });
    this.render();
    return id;
  },
  hide: function(id){ this.items.delete(id); this.render(); },
  render: function(){
    var ov = $('dvLoading');
    if(!this.items.size){ ov.classList.remove('dv-show','dv-block'); return; }
    var arr = Array.from(this.items.values());
    var last = arr[arr.length-1];
    $('dvLoadingText').textContent = last.label || '';
    ov.classList.toggle('dv-block', arr.some(function(x){ return x.opt.block; }));
    $('dvLoadingCancel').hidden = !last.opt.cancel;
    ov.classList.add('dv-show');
  },
  cancelTop: function(){
    var arr = Array.from(this.items.values());
    var last = arr[arr.length-1];
    if(last && last.opt.cancel) last.opt.cancel();
  }
};
$('dvLoadingCancel').addEventListener('click', function(){ loader.cancelTop(); });

/* ================= Navigation stack (Android back button) ================= */
var nav = {
  stack: [], waiters: [], pending: 0,
  push: function(close){ history.pushState({dv:1}, ''); this.stack.push(close); },
  back: function(){
    var self = this;
    return new Promise(function(res){
      if(self.stack.length - self.pending <= 0){ res(); return; }
      self.pending++;
      self.waiters.push(res);
      history.back();
    });
  }
};
try{ history.replaceState({dv:0}, ''); }catch(e){}
window.addEventListener('popstate', function(){
  var c = nav.stack.pop();
  if(nav.pending > 0) nav.pending--;
  if(c){ try{ c(); }catch(e){} }
  var w = nav.waiters.splice(0);
  w.forEach(function(f){ f(); });
});

/* ================= Custom modal system ================= */
var modal = {
  q: Promise.resolve(),
  open: function(cfg){
    var self = this;
    var p = this.q.then(function(){ return self._show(cfg); });
    this.q = p.catch(function(){});
    return p;
  },
  _show: function(cfg){
    return new Promise(function(resolve){
      var dismissVal = cfg.dismissValue === undefined ? null : cfg.dismissValue;
      var result = dismissVal;
      var closing = false;
      var wrap = el('div','dv-dlg-wrap');
      var scrim = el('div','dv-dlg-scrim');
      var d = el('div','dv-dlg' + (cfg.tone === 'danger' ? ' dv-danger' : ''));
      d.setAttribute('role','dialog');
      d.setAttribute('aria-modal','true');
      if(cfg.icon){
        var ic = el('div','dv-dlg-ic');
        ic.appendChild(icon(cfg.icon));
        d.appendChild(ic);
      }
      if(cfg.title) d.appendChild(el('h2','',cfg.title));
      if(cfg.message) d.appendChild(el('p','',cfg.message));
      (cfg.paragraphs || []).forEach(function(t){ d.appendChild(el('p','',t)); });
      if(cfg.content) d.appendChild(cfg.content);
      function close(v){
        if(closing) return;
        closing = true;
        result = v;
        nav.back();
      }
      if(cfg.options){
        var box = el('div','dv-opts');
        cfg.options.forEach(function(o){
          var b = el('button','dv-opt' + (o.danger ? ' dv-bad' : ''));
          b.type = 'button';
          if(o.icon) b.appendChild(icon(o.icon));
          var t = el('span','dv-ot');
          t.appendChild(el('b','',o.label));
          if(o.sub) t.appendChild(el('span','',o.sub));
          b.appendChild(t);
          b.addEventListener('click', function(){ close(o.id); });
          box.appendChild(b);
        });
        d.appendChild(box);
      }
      var acts = el('div','dv-acts');
      (cfg.actions || []).forEach(function(a){
        var b = el('button','dv-act' + (a.kind === 'filled' ? ' dv-filled' : '') + (a.kind === 'danger' ? ' dv-dangerbtn' : ''), a.label);
        b.type = 'button';
        b.addEventListener('click', function(){
          if(a.onTap) a.onTap({ close: close, dialog: d });
          else close(a.value);
        });
        acts.appendChild(b);
      });
      d.appendChild(acts);
      wrap.appendChild(scrim);
      wrap.appendChild(d);
      $('dvDialogs').appendChild(wrap);
      nav.push(function(){
        wrap.classList.remove('dv-open');
        setTimeout(function(){ wrap.remove(); }, 220);
        resolve(result);
      });
      requestAnimationFrame(function(){ wrap.classList.add('dv-open'); });
      scrim.addEventListener('click', function(){ if(cfg.dismissible !== false) close(dismissVal); });
      if(cfg.tone === 'danger') hap(H.warn);
      if(cfg.onOpen) cfg.onOpen(d, close);
    });
  },
  confirm: function(o){
    return this.open({
      title: o.title, message: o.message,
      icon: o.danger ? 'warn' : (o.icon || 'info'),
      tone: o.danger ? 'danger' : '',
      dismissValue: false,
      actions: [
        { label: o.cancelText || 'Cancel', value: false },
        { label: o.confirmText || 'OK', value: true, kind: o.danger ? 'danger' : 'filled' }
      ]
    });
  },
  info: function(o){
    return this.open({
      title: o.title, message: o.message, paragraphs: o.paragraphs, content: o.content,
      icon: o.icon || 'info', dismissValue: true,
      actions: [{ label: o.buttonText || 'Got it', value: true, kind: 'filled' }]
    });
  },
  choose: function(o){
    return this.open({
      title: o.title, message: o.message, icon: o.icon, options: o.options, dismissValue: null,
      actions: [{ label: 'Cancel', value: null }]
    });
  },
  input: function(o){
    var wrapEl = el('div','');
    var lab = el('label','dv-field-label', o.label || '');
    var inp = el('input','dv-field');
    inp.type = 'text';
    inp.value = o.value || '';
    if(o.maxLength) inp.maxLength = o.maxLength;
    inp.setAttribute('autocomplete','off');
    inp.setAttribute('autocapitalize','off');
    var err = el('div','dv-field-err','');
    wrapEl.appendChild(lab); wrapEl.appendChild(inp); wrapEl.appendChild(err);
    var okCtx = null;
    function submit(){
      var v = inp.value.trim();
      var e = o.validate ? o.validate(v) : (v ? null : 'Enter a value');
      if(e){ err.textContent = e; hap(H.warn); return; }
      okCtx.close(v);
    }
    inp.addEventListener('keydown', function(ev){ if(ev.key === 'Enter'){ ev.preventDefault(); submit(); } });
    inp.addEventListener('input', function(){ err.textContent = ''; });
    return this.open({
      title: o.title, message: o.message, icon: o.icon || 'save', content: wrapEl, dismissValue: null,
      onOpen: function(d, close){ okCtx = { close: close }; setTimeout(function(){ inp.focus(); inp.select(); }, 260); },
      actions: [
        { label: 'Cancel', value: null },
        { label: o.confirmText || 'Save', kind: 'filled', onTap: function(){ submit(); } }
      ]
    });
  }
};

/* ================= Full-page modal (edge to edge) ================= */
var page = {
  open: function(title, build){
    var layer = $('dvPages');
    var pg = el('section','dv-page');
    pg.setAttribute('role','dialog');
    pg.setAttribute('aria-label', title);
    var bar = el('div','dv-page-bar');
    var back = el('button','dv-ic');
    back.type = 'button';
    back.setAttribute('aria-label','Back');
    back.appendChild(icon('back'));
    back.addEventListener('click', function(){ nav.back(); });
    bar.appendChild(back);
    bar.appendChild(el('h2','',title));
    var body = el('div','dv-page-body');
    pg.appendChild(bar);
    pg.appendChild(body);
    layer.appendChild(pg);
    var cleanup = build(body);
    nav.push(function(){
      pg.classList.remove('dv-open');
      if(typeof cleanup === 'function'){ try{ cleanup(); }catch(e){} }
      setTimeout(function(){ pg.remove(); }, 300);
    });
    requestAnimationFrame(function(){ pg.classList.add('dv-open'); });
  }
};

/* ================= Global touch feedback: ripple + haptic ================= */
document.addEventListener('pointerdown', function(e){
  var b = e.target.closest ? e.target.closest('button') : null;
  if(!b || b.disabled) return;
  hap(H.tap);
  var r = b.getBoundingClientRect();
  var size = Math.max(r.width, r.height) * 2;
  var sp = document.createElement('span');
  sp.className = 'dv-ripple';
  sp.style.width = sp.style.height = size + 'px';
  sp.style.left = (e.clientX - r.left - size/2) + 'px';
  sp.style.top = (e.clientY - r.top - size/2) + 'px';
  b.appendChild(sp);
  setTimeout(function(){ sp.remove(); }, 520);
}, { passive: true });

/* ================= State ================= */
var dv = {
  tab: 'home', filter: 'all', query: '',
  songs: new Map(), offline: new Set(), saving: new Set(), orderSeq: 0,
  queue: [], idx: -1, cur: null, shuffle: false, repeat: 0,
  blobUrl: null, playToken: 0, seeking: false, bufId: 0, skips: 0, installEvt: null
};
var FILTERS = [['all','All'],['carol','Carols'],['hymn','Hymns'],['recent','Recent'],['fav','Favorites'],['off','Offline']];

/* ================= Catalog + online sources (network code lives in download.js) ================= */
async function seedCatalog(force){
  var have = new Set(force ? [] : (S.seeded || []));
  var fresh = [];
  DV.catalog.build().forEach(function(rec){
    if(have.has(rec.id)) return;
    have.add(rec.id);
    if(!dv.songs.has(rec.id)){ dv.songs.set(rec.id, rec); fresh.push(rec); }
  });
  S.seeded = Array.from(have);
  saveS();
  if(fresh.length) await dbPutMany('songs', fresh);
}

async function fetchSource(key, term, signal){
  var ck = key + '|' + term.toLowerCase();
  var c = Object.assign({ page: 1, cont: 0, done: false }, S.counters[ck] || {});
  if(c.done) return { added: 0, done: true };
  var added = 0, tries = 0;
  while(tries < 3 && !c.done && added === 0){
    tries++;
    var items = await DV.download.search(key, term, c, signal);
    var fresh = [];
    items.forEach(function(it){
      if(!dv.songs.has(it.id)){
        it.order = ++dv.orderSeq;
        it.kind = 'other';
        dv.songs.set(it.id, it);
        fresh.push(it);
      }
    });
    if(fresh.length) await dbPutMany('songs', fresh);
    added += fresh.length;
  }
  S.counters[ck] = c;
  saveS();
  return { added: added, done: c.done };
}

function noRecordingInfo(s){
  return {
    title: 'No recording found', icon: 'warn',
    paragraphs: [
      '\u201C' + s.title + '\u201D is a public domain song, but Carol Songs could not find a public domain recording of it on the Internet Archive or Wikimedia Commons yet.',
      'Try again later, or use Find more songs online in the Library to add recordings you pick yourself.'
    ]
  };
}

/* ================= Fetch flow with spinner, cancel and error modal ================= */
async function fetchFlow(keys, term){
  var ctrl = new AbortController();
  var cancelled = false;
  var lid = loader.show('Finding songs', { block: true, cancel: function(){ cancelled = true; ctrl.abort(); } });
  var added = 0, errors = 0, allDone = true;
  try{
    for(var i = 0; i < keys.length; i++){
      try{
        var r = await fetchSource(keys[i], term, ctrl.signal);
        added += r.added;
        if(!r.done) allDone = false;
      }catch(e){
        if(cancelled) break;
        errors++;
      }
    }
  } finally {
    loader.hide(lid);
  }
  renderAll();
  if(cancelled){ toast('Cancelled','warn'); return added; }
  if(errors === keys.length){
    await modal.info({
      title: 'Could not load songs', icon: 'warn',
      paragraphs: [navigator.onLine
        ? 'The song sources did not respond. Check your connection and try again in a moment.'
        : 'Your phone is offline. Connect to Wi-Fi or mobile data, then try again. Songs saved offline still play.']
    });
    return 0;
  }
  if(added > 0) toast(plural(added,'song added','songs added'),'ok');
  else if(allDone) toast('No more songs for this search','warn');
  else toast('No new songs found. Try again for more.','warn');
  return added;
}

async function findOnline(){
  if(!navigator.onLine){
    await modal.info({ title: 'You are offline', icon: 'warn', paragraphs: ['Connect to Wi-Fi or mobile data to find more songs. Songs saved offline still play.'] });
    return;
  }
  var term = dv.query.trim();
  var pick = await modal.choose({
    title: 'Find more songs', icon: 'public',
    message: term ? 'Searching for \u201C' + term + '\u201D. Choose where to look.' : 'Choose where to look.',
    options: [
      { id: 'ia-strict', label: 'Internet Archive', sub: 'Recorded before 1926', icon: 'public' },
      { id: 'ia-pd', label: 'Internet Archive', sub: 'Marked public domain', icon: 'public' },
      { id: 'wm', label: 'Wikimedia Commons', sub: 'Free-licensed audio', icon: 'public' }
    ]
  });
  if(!pick) return;
  await fetchFlow([pick], term);
}

async function ensureLibrary(){
  if(dv.songs.size) return true;
  var ok = await modal.confirm({ title: 'Your library is empty', message: 'Restore the built-in public domain Christmas carols and hymns?', confirmText: 'Restore songs', icon: 'lib' });
  if(!ok) return false;
  var lid = loader.show('Restoring songs', { block: true });
  try{ await seedCatalog(true); }
  catch(e){ toast('Could not restore songs','error'); }
  finally{ loader.hide(lid); }
  renderAll();
  return dv.songs.size > 0;
}

/* ================= Library data ================= */
function sorted(){
  return Array.from(dv.songs.values()).sort(function(a,b){ return (a.order||0) - (b.order||0); });
}
function filtered(){
  var arr = sorted();
  if(dv.filter === 'carol' || dv.filter === 'hymn'){
    arr = arr.filter(function(s){ return s.kind === dv.filter; });
  } else if(dv.filter === 'recent'){
    arr = arr.filter(function(s){ return s.lastPlayed; }).sort(function(a,b){ return b.lastPlayed - a.lastPlayed; }).slice(0,30);
  } else if(dv.filter === 'fav'){
    arr = arr.filter(function(s){ return s.fav; });
  } else if(dv.filter === 'off'){
    arr = arr.filter(function(s){ return dv.offline.has(s.id); });
  }
  var words = dv.query.toLowerCase().split(/\s+/).filter(Boolean);
  if(words.length){
    arr = arr.filter(function(s){
      var hay = (s.title + ' ' + s.artist + ' ' + (s.year || '')).toLowerCase();
      return words.every(function(w){ return hay.indexOf(w) !== -1; });
    });
  }
  return arr;
}

/* ================= Rendering ================= */
function isNow(s){ return dv.cur && dv.cur.id === s.id; }
function isPlaying(){ return !audio.paused && !audio.ended && !!dv.cur; }
function thumbIcon(s){ return isNow(s) && isPlaying() ? 'pause' : 'play'; }

function flags(s){
  var f = el('span','dv-flags');
  if(s.fav){ var h = icon('heart'); h.setAttribute('class','dv-i dv-heart'); f.appendChild(h); }
  if(dv.offline.has(s.id)){ f.appendChild(icon('done')); f.appendChild(document.createTextNode('Offline')); }
  if(!f.childNodes.length) f.textContent = s.source === 'catalog' ? (s.kind === 'hymn' ? 'Hymn' : 'Christmas carol') : (s.source === 'ia' ? 'Internet Archive' : 'Wikimedia Commons');
  return f;
}
function metaLine(s){ return s.artist + (s.year ? ' (' + s.year + ')' : ''); }

function listRow(s, i, list){
  var li = el('li','dv-row' + (isNow(s) ? ' dv-now' : ''));
  li.dataset.sid = s.id;
  var main = el('button','dv-row-main');
  main.type = 'button';
  main.setAttribute('aria-label','Play ' + s.title);
  var th = el('span','dv-thumb'); th.appendChild(icon(thumbIcon(s)));
  var tx = el('span','dv-txt');
  tx.appendChild(el('b','',s.title));
  tx.appendChild(el('span','',metaLine(s)));
  tx.appendChild(flags(s));
  main.appendChild(th); main.appendChild(tx);
  main.addEventListener('click', function(){ tapSong(list, i); });
  var more = el('button','dv-ic');
  more.type = 'button';
  more.setAttribute('aria-label','More actions for ' + s.title);
  more.appendChild(icon('horiz'));
  more.addEventListener('click', function(){ songMenu(s); });
  li.appendChild(main); li.appendChild(more);
  return li;
}
function gridCard(s, i, list){
  var li = el('li','dv-card' + (isNow(s) ? ' dv-now' : ''));
  li.dataset.sid = s.id;
  var main = el('button','dv-card-main');
  main.type = 'button';
  main.setAttribute('aria-label','Play ' + s.title);
  var th = el('span','dv-thumb'); th.appendChild(icon(thumbIcon(s)));
  var tx = el('span','dv-txt');
  tx.appendChild(el('b','',s.title));
  tx.appendChild(el('span','',metaLine(s)));
  tx.appendChild(flags(s));
  main.appendChild(th); main.appendChild(tx);
  main.addEventListener('click', function(){ tapSong(list, i); });
  var more = el('button','dv-ic dv-more');
  more.type = 'button';
  more.setAttribute('aria-label','More actions for ' + s.title);
  more.appendChild(icon('horiz'));
  more.addEventListener('click', function(){ songMenu(s); });
  li.appendChild(main); li.appendChild(more);
  return li;
}

function renderLibrary(){
  var list = filtered();
  var ul = $('dvLibList');
  ul.textContent = '';
  ul.className = S.view === 'grid' ? 'dv-grid' : 'dv-list';
  list.forEach(function(s, i){ ul.appendChild(S.view === 'grid' ? gridCard(s, i, list) : listRow(s, i, list)); });
  $('dvCount').textContent = plural(list.length, 'song', 'songs') + (dv.query.trim() ? ' found' : '');
  $('dvViewList').setAttribute('aria-pressed', S.view === 'list' ? 'true' : 'false');
  $('dvViewGrid').setAttribute('aria-pressed', S.view === 'grid' ? 'true' : 'false');
  document.querySelectorAll('#dvChips .dv-chip').forEach(function(b){
    b.setAttribute('aria-pressed', b.dataset.f === dv.filter ? 'true' : 'false');
  });
  $('dvQClear').hidden = !dv.query;
  var em = $('dvLibEmpty');
  em.textContent = '';
  if(list.length) return;
  var box = el('div','dv-empty');
  var q = dv.query.trim();
  if(!dv.songs.size){
    box.appendChild(icon('lib'));
    box.appendChild(el('b','','Your library is empty'));
    box.appendChild(el('span','','Restore the built-in public domain carols and hymns.'));
    var g = el('button','dv-btn dv-fill'); g.type = 'button'; g.textContent = 'Restore songs';
    g.addEventListener('click', function(){ ensureLibrary(); });
    box.appendChild(g);
  } else if(q){
    box.appendChild(icon('search'));
    box.appendChild(el('b','','No match for \u201C' + q + '\u201D'));
    box.appendChild(el('span','','Try another word or search online.'));
    var sb = el('button','dv-btn dv-fill'); sb.type = 'button'; sb.textContent = 'Search online';
    sb.addEventListener('click', findOnline);
    box.appendChild(sb);
  } else if(dv.filter === 'carol' || dv.filter === 'hymn'){
    box.appendChild(icon('note'));
    box.appendChild(el('b','','No ' + (dv.filter === 'carol' ? 'carols' : 'hymns') + ' here'));
    box.appendChild(el('span','','Songs you remove from the library no longer appear.'));
  } else if(dv.filter === 'recent'){
    box.appendChild(icon('history'));
    box.appendChild(el('b','','No recent songs'));
    box.appendChild(el('span','','Songs you play show up here.'));
  } else if(dv.filter === 'fav'){
    box.appendChild(icon('heart-o'));
    box.appendChild(el('b','','No favorites yet'));
    box.appendChild(el('span','','Tap the menu on a song and choose Add to favorites.'));
  } else {
    box.appendChild(icon('download'));
    box.appendChild(el('b','','Nothing saved offline'));
    box.appendChild(el('span','','Open a song menu and choose Save offline.'));
  }
  em.appendChild(box);
}

function renderHome(){
  var n = dv.songs.size, o = dv.offline.size;
  $('dvHeroStat').textContent = n ? plural(n,'song','songs') + ' in your library, ' + o + ' offline' : 'Your library is empty';
}
function renderAll(){ renderLibrary(); renderHome(); sync(); }

/* ================= Tabs ================= */
function setTab(t){
  dv.tab = t;
  $('dvPaneHome').hidden = t !== 'home';
  $('dvPaneMp3').hidden = t !== 'mp3';
  $('dvPaneLib').hidden = t !== 'lib';
  [['home','dvNavHome'],['mp3','dvNavMp3'],['lib','dvNavLib']].forEach(function(p){
    var b = $(p[1]);
    if(p[0] === t) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  $('dvMain').scrollTop = 0;
  if(t === 'lib') renderLibrary();
  if(t === 'home') renderHome();
}

/* ================= Song actions ================= */
function tapSong(list, i){
  var s = list[i];
  if(isNow(s)){
    if(audio.paused) audio.play().catch(function(){ toast('Could not resume playback','error'); });
    else audio.pause();
    return;
  }
  dv.queue = list.slice();
  playIndex(i);
  toast('Playing ' + s.title);
}

async function songMenu(s){
  var off = dv.offline.has(s.id);
  var pick = await modal.choose({
    title: s.title, icon: 'note',
    options: [
      { id: 'play', label: isNow(s) && isPlaying() ? 'Pause' : 'Play', icon: isNow(s) && isPlaying() ? 'pause' : 'play' },
      { id: 'fav', label: s.fav ? 'Remove from favorites' : 'Add to favorites', icon: s.fav ? 'heart' : 'heart-o' },
      { id: 'off', label: off ? 'Remove offline copy' : 'Save offline', icon: off ? 'trash' : 'download' },
      { id: 'info', label: 'Source and license', icon: 'info' },
      { id: 'del', label: 'Remove from library', icon: 'trash', danger: true }
    ]
  });
  if(!pick) return;
  if(pick === 'play'){ var list = filtered(); var i = list.findIndex(function(x){ return x.id === s.id; }); if(i < 0){ list = [s]; i = 0; } tapSong(list, i); }
  else if(pick === 'fav') toggleFav(s);
  else if(pick === 'off') toggleOffline(s);
  else if(pick === 'info') songDetails(s);
  else if(pick === 'del') removeSong(s);
}

function songDetails(s){
  var box = el('div','');
  box.appendChild(el('p','','Artist: ' + s.artist));
  box.appendChild(el('p','','Year: ' + (s.year || 'Unknown')));
  box.appendChild(el('p','','License: ' + s.license));
  var srcName = s.source === 'ia' ? 'Internet Archive' : (s.source === 'wm' ? 'Wikimedia Commons'
    : (s.recSource === 'ia' ? 'Internet Archive' : (s.recSource === 'wm' ? 'Wikimedia Commons' : 'Not found yet')));
  if(s.source === 'catalog') box.appendChild(el('p','','Type: ' + (s.kind === 'hymn' ? 'Hymn' : 'Christmas carol') + ' (public domain song)'));
  box.appendChild(el('p','','Recording source: ' + srcName));
  if(s.recTitle) box.appendChild(el('p','','Recording: ' + s.recTitle));
  var a = el('a','dv-link');
  a.href = s.page; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.appendChild(icon('link'));
  a.appendChild(el('span','','Open source page'));
  if(s.page) box.appendChild(a);
  modal.info({ title: s.title, icon: 'info', content: box, buttonText: 'Close' });
}

async function toggleFav(s){
  s.fav = !s.fav;
  try{ await dbPut('songs', s); }catch(e){ s.fav = !s.fav; toast('Could not update favorites','error'); return; }
  toast(s.fav ? 'Added to favorites' : 'Removed from favorites', s.fav ? 'ok' : 'info');
  renderAll();
}

async function removeSong(s){
  var ok = await modal.confirm({
    title: 'Remove this song?',
    message: '\u201C' + s.title + '\u201D will be removed from your library. Its favorite mark and offline copy will be deleted too.',
    confirmText: 'Remove', danger: true
  });
  if(!ok) return;
  var lid = loader.show('Removing', { block: true });
  try{
    await dbDel('songs', s.id);
    if(dv.offline.has(s.id)){ await dbDel('blobs', s.id); dv.offline.delete(s.id); }
    dv.songs.delete(s.id);
    dv.queue = dv.queue.filter(function(x){ return x.id !== s.id; });
    if(dv.cur && dv.cur.id === s.id){
      audio.pause(); audio.removeAttribute('src'); audio.load();
      dv.cur = null; dv.idx = -1;
    } else if(dv.cur){
      dv.idx = dv.queue.findIndex(function(x){ return x.id === dv.cur.id; });
    }
    toast('Song removed','warn');
  }catch(e){
    toast('Could not remove the song','error');
  } finally { loader.hide(lid); }
  renderAll();
}

async function toggleOffline(s){
  if(dv.saving.has(s.id)) return;
  if(dv.offline.has(s.id)){
    var ok = await modal.confirm({
      title: 'Remove offline copy?',
      message: '\u201C' + s.title + '\u201D will no longer play without internet. It stays in your library.',
      confirmText: 'Remove', danger: true
    });
    if(!ok) return;
    try{ await dbDel('blobs', s.id); dv.offline.delete(s.id); toast('Offline copy removed','warn'); }
    catch(e){ toast('Could not remove the copy','error'); }
    renderAll();
    return;
  }
  if(!navigator.onLine){
    await modal.info({ title: 'You are offline', icon: 'warn', paragraphs: ['Connect to the internet to save this song for offline listening.'] });
    return;
  }
  if(!S.offlineNote){
    var yes = await modal.confirm({
      title: 'Save for offline?', icon: 'download', confirmText: 'Save',
      message: 'The song audio will be stored in this phone\u2019s app storage so it plays without internet. You can remove it anytime from the song menu.'
    });
    if(!yes) return;
    S.offlineNote = true; saveS();
    try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  }
  var ctrl = new AbortController();
  var cancelled = false;
  dv.saving.add(s.id);
  sync();
  var lid = loader.show('Saving offline', { block: true, cancel: function(){ cancelled = true; ctrl.abort(); } });
  try{
    var blob = await DV.download.saveOffline(s, ctrl.signal);
    await dbPut('blobs', { id: s.id, blob: blob });
    dv.offline.add(s.id);
    toast('Saved offline','ok');
  }catch(e){
    if(cancelled) toast('Download cancelled','warn');
    else if(e && e.code === 'NO_RECORDING') await modal.info(noRecordingInfo(s));
    else if(e && e.name === 'QuotaExceededError') await modal.info({ title: 'Storage is full', icon: 'warn', paragraphs: ['Free some space on your phone or remove other offline songs, then try again.'] });
    else await modal.info({ title: 'Could not save offline', icon: 'warn', paragraphs: ['The song could not be downloaded. The source may be busy or may not allow downloads. Try again later.'] });
  } finally {
    loader.hide(lid);
    dv.saving.delete(s.id);
  }
  renderAll();
}

/* ================= Playback ================= */
function bufStart(label){
  if(dv.bufId) return;
  dv.bufId = loader.show(label || 'Loading song', { block: false });
}
function bufStop(){
  if(dv.bufId){ loader.hide(dv.bufId); dv.bufId = 0; }
}

async function playIndex(i, opts){
  var s = dv.queue[i];
  if(!s) return;
  var my = ++dv.playToken;
  if(!(opts && opts.auto)) dv.skips = 0;
  dv.idx = i;
  dv.cur = s;
  s.lastPlayed = Date.now();
  dbPut('songs', s).catch(function(){});
  S.lastId = s.id; saveS();
  bufStop();
  bufStart(s.source === 'catalog' && !s.src ? 'Finding a recording' : 'Loading song');
  sync();
  try{
    var url, rec = null;
    if(dv.offline.has(s.id)) rec = await dbGet('blobs', s.id);
    if(rec && rec.blob){
      var prev = dv.blobUrl;
      dv.blobUrl = URL.createObjectURL(rec.blob);
      url = dv.blobUrl;
      if(prev) setTimeout(function(){ URL.revokeObjectURL(prev); }, 1500);
    } else {
      url = await DV.download.resolve(s);
    }
    if(my !== dv.playToken) return;
    audio.src = url;
    await audio.play();
  }catch(e){
    if(my !== dv.playToken) return;
    bufStop();
    if(e && e.name === 'AbortError') return;
    if(e && e.code === 'NO_RECORDING'){
      sync();
      if(opts && opts.auto && dv.skips < dv.queue.length){
        dv.skips++;
        toast('No recording for \u201C' + s.title + '\u201D. Skipping.','warn');
        playIndex((i + 1) % dv.queue.length, { auto: true });
        return;
      }
      await modal.info(noRecordingInfo(s));
      return;
    }
    toast(navigator.onLine ? 'This song could not be played. Try the next one.' : 'You are offline. Play a song saved offline.','error');
  }
  sync();
}

async function playButton(){
  if(dv.cur){
    if(audio.paused){
      if(!audio.src) playIndex(dv.idx);
      else audio.play().catch(function(){ toast('Could not resume playback','error'); });
    } else audio.pause();
    return;
  }
  if(!(await ensureLibrary())) return;
  var list = sorted();
  var start = Math.max(0, list.findIndex(function(x){ return x.id === S.lastId; }));
  dv.queue = list;
  playIndex(start);
}

function nextSong(auto){
  var q = dv.queue;
  if(!q.length) return;
  if(auto && dv.repeat === 1){ audio.currentTime = 0; audio.play().catch(function(){}); return; }
  var i;
  if(dv.shuffle && q.length > 1){
    do { i = Math.floor(Math.random() * q.length); } while(i === dv.idx);
  } else {
    i = dv.idx + 1;
    if(i >= q.length){
      if(dv.repeat === 2 || !auto) i = 0;
      else { audio.pause(); audio.currentTime = 0; sync(); return; }
    }
  }
  playIndex(i, { auto: true });
}
function prevSong(){
  var q = dv.queue;
  if(!q.length) return;
  if(audio.currentTime > 3){ audio.currentTime = 0; return; }
  var i = dv.idx - 1;
  if(i < 0) i = q.length - 1;
  playIndex(i, { auto: true });
}

/* ================= UI sync ================= */
function sync(){
  var s = dv.cur;
  var playing = isPlaying();
  $('dvMpTitle').textContent = s ? s.title : 'Tap play to start';
  $('dvMpArtist').textContent = s ? metaLine(s) : 'Carol Songs library';
  $('dvMpLic').textContent = s ? s.license : 'Public domain Christmas music';
  setIcon($('dvPlay'), playing ? 'pause' : 'play');
  var sh = $('dvShuffle'); sh.classList.toggle('dv-dim', !dv.shuffle); sh.classList.toggle('dv-act', dv.shuffle);
  var rp = $('dvRepeat'); rp.classList.toggle('dv-dim', dv.repeat === 0); rp.classList.toggle('dv-act', dv.repeat !== 0);
  setIcon(rp, dv.repeat === 1 ? 'repeat1' : 'repeat');
  var fb = $('dvBtnFav'), fav = !!(s && s.fav);
  fb.classList.toggle('dv-on-red', fav);
  setIcon(fb, fav ? 'heart' : 'heart-o');
  fb.querySelector('span').textContent = fav ? 'Favorited' : 'Favorite';
  var ob = $('dvBtnOff'), off = !!(s && dv.offline.has(s.id));
  ob.classList.toggle('dv-on', off);
  setIcon(ob, off ? 'done' : 'download');
  ob.querySelector('span').textContent = s && dv.saving.has(s.id) ? 'Saving' : (off ? 'Saved' : 'Offline');
  document.querySelectorAll('#dvLibList [data-sid]').forEach(function(row){
    var now = !!(s && row.dataset.sid === s.id);
    row.classList.toggle('dv-now', now);
    var u = row.querySelector('.dv-thumb use');
    if(u) u.setAttribute('href','#i-' + (now && playing ? 'pause' : 'play'));
  });
  if(s) document.title = (playing ? '\u25B6 ' : '') + s.title + ' - Carol Songs';
  if('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : (s ? 'paused' : 'none');
}

var artCache = '';
function makeArt(){
  if(artCache) return artCache;
  var c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  var x = c.getContext('2d');
  var g = x.createLinearGradient(0,0,0,512);
  g.addColorStop(0,'#1877F2'); g.addColorStop(1,'#0B4FB8');
  x.fillStyle = g; x.fillRect(0,0,512,512);
  x.fillStyle = '#FFD54A';
  x.beginPath();
  for(var i = 0; i < 10; i++){
    var a = -Math.PI/2 + i*Math.PI/5;
    var r = i % 2 === 0 ? 150 : 62;
    var px = 256 + r*Math.cos(a), py = 262 + r*Math.sin(a);
    if(i === 0) x.moveTo(px,py); else x.lineTo(px,py);
  }
  x.closePath(); x.fill();
  x.fillStyle = '#fff';
  [[100,100,8],[420,130,6],[80,400,6],[430,410,8],[256,460,5],[256,56,5]].forEach(function(d){
    x.beginPath(); x.arc(d[0],d[1],d[2],0,Math.PI*2); x.fill();
  });
  artCache = c.toDataURL('image/png');
  return artCache;
}
function setMedia(){
  var s = dv.cur;
  if(!s || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: s.title, artist: s.artist, album: 'Carol Songs',
    artwork: [{ src: makeArt(), sizes: '512x512', type: 'image/png' }]
  });
}

/* ================= Theme + text size ================= */
function applyTheme(){
  var dark = S.dark === null ? window.matchMedia('(prefers-color-scheme: dark)').matches : !!S.dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  $('dvThemeColor').setAttribute('content', dark ? '#121316' : '#FDFBFF');
  $('dvItDark').setAttribute('aria-checked', dark ? 'true' : 'false');
}
function applyFs(){
  var px = Math.min(22, Math.max(19, parseInt(S.fs, 10) || 19));
  S.fs = px;
  document.documentElement.style.fontSize = px + 'px';
  $('dvFs').value = String(px);
  $('dvFsVal').textContent = px + 'px';
}

/* ================= Drawers ================= */
function openDrawer(side){
  var d = $(side === 'l' ? 'dvDrawerL' : 'dvDrawerR');
  d.classList.add('dv-open');
  $('dvScrim').classList.add('dv-show');
  nav.push(function(){
    d.classList.remove('dv-open');
    $('dvScrim').classList.remove('dv-show');
  });
}
$('dvScrim').addEventListener('click', function(){ nav.back(); });
$('dvMenuL').addEventListener('click', function(){ openDrawer('l'); });
$('dvMenuR').addEventListener('click', function(){ openDrawer('r'); });

async function fromDrawer(fn){ await nav.back(); fn(); }

/* ================= Documents (left menu) ================= */
function docBuild(blocks){
  return function(body){
    body.classList.add('dv-doc');
    blocks.forEach(function(b){
      if(b.logo){ var ico = el('div','dv-docico'); var s = document.createElementNS(NS,'svg'); s.setAttribute('viewBox','0 0 24 24'); var u = document.createElementNS(NS,'use'); u.setAttribute('href','#i-star'); s.appendChild(u); ico.appendChild(s); body.appendChild(ico); }
      if(b.h) body.appendChild(el('h3','',b.h));
      (b.p || []).forEach(function(t){ body.appendChild(el('p','',t)); });
      if(b.ol){ var ol = el('ol'); b.ol.forEach(function(t){ ol.appendChild(el('li','',t)); }); body.appendChild(ol); }
      if(b.ul){ var ul = el('ul'); b.ul.forEach(function(t){ ul.appendChild(el('li','',t)); }); body.appendChild(ul); }
    });
  };
}

var DOCS = {
  about: { title: 'About the App', icon: 'info', build: docBuild([
    { logo: true, h: 'Carol Songs', p: ['Carol Songs brings public domain Christmas carols and hymns together in one place. Its built-in library of 40 carols and 30 hymns finds a public domain recording of each song on the Internet Archive and Wikimedia Commons, and keeps the songs you choose on this phone.'] },
    { h: 'What you can do', ul: [
      'Stream carols with Previous, Play, Next, shuffle, repeat and volume control.',
      'Search your library and switch between list and grid views.',
      'Mark favorites and find songs you played recently.',
      'Save songs for offline listening and play them with no connection.',
      'Use dark mode, a larger text size, a to-do list and a calculator from the tools menu.'
    ] },
    { h: 'Made for Android phones', p: ['Carol Songs is a Progressive Web App designed for Android phones. Install it from Chrome to open it like any other app.'] },
    { h: 'Version', p: ['Carol Songs 1.0'] }
  ]) },
  dev: { title: 'About the Developer', icon: 'person', build: docBuild([
    { h: 'Chris Johnson, PhD', p: ['Chris Johnson is the founder and lead developer of Biblefirm, a technology ministry that builds Progressive Web Apps for education, community, productivity and engagement.'] },
    { h: 'Our mission', p: ['Biblefirm exists to reach six million souls across six continents through digital technology, with tools that serve the body of Christ.'] },
    { h: 'Why Carol Songs', p: ['Christmas music has carried the message of Christ\u2019s birth for centuries. Carol Songs makes the public domain carols easy to find, enjoy and share.'] }
  ]) },
  how: { title: 'How to Use', icon: 'help', build: docBuild([
    { h: 'Getting started', ol: [
      'Open the Library tab. It already holds 40 Christmas carols and 30 hymns. Use the Carols and Hymns filters to browse.',
      'Type in the search bar to filter your library. Tap Find more songs online to add more from the Internet Archive or Wikimedia Commons.',
      'Tap a song to play it. Tap it again to pause. The first time you play a song, Carol Songs looks for a public domain recording of it, so that first play needs internet.',
      'Open the MP3 tab for Previous, Play, Next, shuffle, repeat and the Volume button.',
      'Tap Favorite on the MP3 tab, or the menu button on any song, to favorite it, save it offline, see its license or remove it.',
      'Use the Recent, Favorites and Offline filters in the Library to find songs quickly.'
    ] },
    { h: 'Tools menu', p: ['Tap the three dots at the top right for dark mode, the to-do list, the calculator, text size, Install App and Share App.'] },
    { h: 'Offline listening', p: ['Songs saved offline play without internet. Open Library, choose the Offline filter, and tap a song.'] }
  ]) },
  terms: { title: 'Terms of Use', icon: 'doc', build: docBuild([
    { ol: [
      'Acceptance. By using Carol Songs you agree to these terms. If you do not agree, please stop using the app.',
      'Personal use. Carol Songs is provided for personal, non-commercial listening.',
      'Third-party content. Songs are provided by the Internet Archive and Wikimedia Commons and their contributors. Carol Songs does not host the audio files.',
      'Public domain status. The songs and melodies in the built-in library are in the public domain, but every recording is a separate work, so Carol Songs only plays recordings that are public domain or freely licensed. Filters such as recorded before 1926 are a guide, not a legal guarantee. Copyright rules differ between countries, so always confirm the license on the song\u2019s source page before using a song outside this app.',
      'Offline copies. Songs you save offline are for your own listening and must not be redistributed or sold.',
      'No warranty. The app and its songs are provided as they are. Songs may become unavailable if the source removes them.',
      'Removal requests. If you hold rights to a recording shown here, please ask the source host to remove it. Carol Songs will no longer be able to play it.',
      'Changes. These terms may be updated as the app improves. Continued use means you accept the updated terms.'
    ] }
  ]) },
  warn: { title: 'Proprietary Warning', icon: 'warn', build: docBuild([
    { h: 'Copyright \u00A9 2026 Biblefirm. All rights reserved.', p: [
      'The Carol Songs application, including its source code, interface design, structure, the DV Architecture and the Biblefirm name and branding, is proprietary property of Biblefirm.',
      'Copying, cloning, reverse-engineering, repackaging, redistributing, reselling or publishing any part of this application without written permission is strictly prohibited and may result in legal action.',
      'Songs retrieved from third-party sources remain under their own licenses and are not covered by this notice.'
    ] }
  ]) },
  support: { title: 'Support Us', icon: 'heart', build: function(body){
    docBuild([
      { logo: true, h: 'Carol Songs is free', p: ['There are no ads and no sign-up. If this app blesses you, here is how you can support the ministry behind it.'] },
      { h: 'Ways to help', ul: [
        'Share Carol Songs with family, friends and your church.',
        'Pray for the Biblefirm ministry and its mission to reach six million souls across six continents.',
        'Send feedback so the app can keep improving.'
      ] }
    ])(body);
    var sh = el('button','dv-btn dv-fill'); sh.type = 'button';
    sh.appendChild(icon('share')); sh.appendChild(el('span','','Share Carol Songs'));
    sh.addEventListener('click', function(){ shareApp(); });
    var ct = el('button','dv-btn'); ct.type = 'button';
    ct.appendChild(icon('mail')); ct.appendChild(el('span','','Send feedback'));
    ct.addEventListener('click', function(){ nav.back().then(function(){ openDoc('contact'); }); });
    body.appendChild(sh); body.appendChild(ct);
  } },
  contact: { title: 'Contact Us', icon: 'mail', build: function(body){
    body.classList.add('dv-doc','dv-contact');
    body.appendChild(el('h3','','Message the Biblefirm team'));
    body.appendChild(el('p','','Write your question or feedback, then tap Send. Your phone\u2019s share sheet opens so you can send it with the app you prefer.'));
    var ta = el('textarea','');
    ta.maxLength = 500;
    ta.placeholder = 'Your message';
    ta.setAttribute('aria-label','Your message');
    body.appendChild(ta);
    var cnt = el('p','','0/500');
    cnt.style.textAlign = 'right';
    body.appendChild(cnt);
    ta.addEventListener('input', function(){ cnt.textContent = ta.value.length + '/500'; });
    var send = el('button','dv-btn dv-fill'); send.type = 'button';
    send.appendChild(icon('mail')); send.appendChild(el('span','','Send message'));
    send.addEventListener('click', async function(){
      var msg = ta.value.trim();
      if(msg.length < 5){ toast('Write a short message first','warn'); ta.focus(); return; }
      var text = 'Carol Songs feedback:\n' + msg;
      if(navigator.share){
        try{ await navigator.share({ title: 'Carol Songs feedback', text: text }); toast('Message ready to send','ok'); }
        catch(e){ if(e && e.name !== 'AbortError') toast('Could not open the share sheet','error'); }
      } else {
        try{ await navigator.clipboard.writeText(text); toast('Message copied. Paste it into your messaging app.','ok'); }
        catch(e){ toast('Could not copy the message','error'); }
      }
    });
    body.appendChild(send);
  } }
};

function openDoc(key){
  var d = DOCS[key];
  if(d) page.open(d.title, d.build);
}

(function buildLeft(){
  var box = $('dvListL');
  var items = [['about','info','About the App'],['dev','person','About the Developer'],['how','help','How to Use'],['terms','doc','Terms of Use'],['warn','warn','Proprietary Warning'],['support','heart','Support Us'],['contact','mail','Contact Us']];
  items.forEach(function(it){
    var b = el('button','dv-item');
    b.type = 'button';
    b.appendChild(icon(it[1]));
    b.appendChild(el('span','dv-grow',it[2]));
    b.addEventListener('click', function(){ fromDrawer(function(){ openDoc(it[0]); }); });
    box.appendChild(b);
  });
})();

/* ================= To-do list page ================= */
function buildTodo(body){
  body.classList.add('dv-todo');
  var ta = el('textarea','');
  ta.maxLength = 500;
  ta.value = S.todo || '';
  ta.placeholder = 'Write your tasks here';
  ta.setAttribute('aria-label','To-do list');
  var bar = el('div','dv-tbar');
  var cnt = el('div','dv-cnt','');
  var row = el('div','dv-trow');
  function mk(label, ic, cls, fn){
    var b = el('button','dv-btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.appendChild(icon(ic));
    b.appendChild(el('span','',label));
    b.addEventListener('click', fn);
    row.appendChild(b);
    return b;
  }
  function upd(){
    cnt.textContent = ta.value.length + '/500 characters';
    cnt.classList.toggle('dv-full', ta.value.length >= 500);
  }
  var timer = 0, wasFull = ta.value.length >= 500;
  ta.addEventListener('input', function(){
    if(ta.value.length > 500) ta.value = ta.value.slice(0,500);
    upd();
    var full = ta.value.length >= 500;
    if(full && !wasFull) toast('Limit of 500 characters reached','warn');
    wasFull = full;
    clearTimeout(timer);
    timer = setTimeout(function(){ S.todo = ta.value; saveS(); }, 400);
  });
  mk('Save','save','dv-fill', function(){
    S.todo = ta.value; saveS();
    toast('To-do list saved','ok');
  });
  mk('Export','download','', async function(){
    var text = ta.value;
    if(!text.trim()){ toast('Nothing to export yet','warn'); return; }
    var name = await modal.input({
      title: 'Save as text file', message: 'Choose a file name.', label: 'File name', value: 'carol-todo', maxLength: 40, confirmText: 'Save file',
      validate: function(v){
        if(!v) return 'Enter a file name';
        if(/[\\\/:*?"<>|]/.test(v)) return 'Avoid these characters: \\ / : * ? " < > |';
        return null;
      }
    });
    if(!name) return;
    if(!/\.txt$/i.test(name)) name += '.txt';
    var lid = loader.show('Preparing file', { block: true });
    try{
      DV.download.saveTextFile(name, text);
      toast('File saved','ok');
    }catch(e){ toast('Could not save the file','error'); }
    finally{ loader.hide(lid); }
  });
  mk('Clear','trash','', async function(){
    if(!ta.value.length){ toast('The list is already empty'); return; }
    var ok = await modal.confirm({ title: 'Clear the to-do list?', message: 'All text in your to-do list will be deleted. This cannot be undone.', confirmText: 'Clear', danger: true });
    if(!ok) return;
    ta.value = ''; S.todo = ''; saveS(); wasFull = false; upd();
    toast('To-do list cleared','warn');
  });
  bar.appendChild(cnt);
  bar.appendChild(row);
  body.appendChild(ta);
  body.appendChild(bar);
  upd();
  return function(){ S.todo = ta.value; saveS(); };
}

/* ================= Calculator page ================= */
function buildCalc(body){
  body.classList.add('dv-calc');
  var st = { a: null, op: null, cur: '0', fresh: true, hist: '' };
  var disp = el('div','dv-cdisp');
  var hist = el('div','dv-chist','');
  var num = el('div','dv-cnum','0');
  disp.appendChild(hist); disp.appendChild(num);
  var keys = el('div','dv-keys');
  function f(n){
    if(!isFinite(n)) return 'Error';
    var s = String(parseFloat(n.toPrecision(12)));
    if(s.length > 14) s = n.toExponential(6);
    return s;
  }
  function show(){ num.textContent = st.cur; hist.textContent = st.hist; }
  function reset(){ st.a = null; st.op = null; st.cur = '0'; st.fresh = true; st.hist = ''; }
  function compute(a, op, b){
    if(op === '+') return a + b;
    if(op === '\u2212') return a - b;
    if(op === '\u00D7') return a * b;
    if(op === '\u00F7') return b === 0 ? null : a / b;
    return b;
  }
  function divZero(){ reset(); show(); toast('Cannot divide by zero','error'); }
  function digit(d){
    if(st.fresh){ st.cur = d === '.' ? '0.' : d; st.fresh = false; }
    else {
      if(d === '.' && st.cur.indexOf('.') !== -1) return;
      if(st.cur.replace(/[-.]/g,'').length >= 12){ toast('Digit limit reached','warn'); return; }
      st.cur = (st.cur === '0' && d !== '.') ? d : st.cur + d;
    }
  }
  function oper(o){
    var v = parseFloat(st.cur);
    if(st.op && !st.fresh){
      var r = compute(st.a, st.op, v);
      if(r === null){ divZero(); return; }
      st.a = r; st.cur = f(r);
    } else st.a = v;
    st.op = o; st.fresh = true; st.hist = f(st.a) + ' ' + o;
  }
  function equals(){
    if(!st.op) return;
    var v = parseFloat(st.cur);
    var r = compute(st.a, st.op, v);
    if(r === null){ divZero(); return; }
    st.hist = f(st.a) + ' ' + st.op + ' ' + f(v) + ' =';
    st.cur = f(r); st.a = null; st.op = null; st.fresh = true;
  }
  var layout = [
    ['C','fn'],['back','fn'],['%','fn'],['\u00F7','op'],
    ['7',''],['8',''],['9',''],['\u00D7','op'],
    ['4',''],['5',''],['6',''],['\u2212','op'],
    ['1',''],['2',''],['3',''],['+','op'],
    ['\u00B1','fn'],['0',''],['.',''],['=','eq']
  ];
  layout.forEach(function(k){
    var b = el('button', k[1] ? 'dv-' + k[1] : '');
    b.type = 'button';
    if(k[0] === 'back'){ b.appendChild(icon('backspace')); b.setAttribute('aria-label','Backspace'); }
    else { b.textContent = k[0]; b.setAttribute('aria-label', k[0] === 'C' ? 'Clear' : k[0]); }
    b.addEventListener('click', function(){
      var key = k[0];
      if(/^[0-9.]$/.test(key)) digit(key);
      else if(key === 'C') reset();
      else if(key === 'back'){
        if(!st.fresh){ st.cur = st.cur.slice(0,-1); if(st.cur === '' || st.cur === '-') st.cur = '0'; }
      }
      else if(key === '\u00B1'){ if(st.cur !== '0'){ st.cur = st.cur.charAt(0) === '-' ? st.cur.slice(1) : '-' + st.cur; } }
      else if(key === '%'){ st.cur = f(parseFloat(st.cur) / 100); st.fresh = true; }
      else if(key === '='){ equals(); }
      else oper(key);
      show();
    });
    keys.appendChild(b);
  });
  body.appendChild(disp);
  body.appendChild(keys);
  show();
}

/* ================= Right menu actions ================= */
$('dvItDark').addEventListener('click', function(){
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  S.dark = !isDark;
  saveS();
  applyTheme();
  toast(S.dark ? 'Dark mode on' : 'Dark mode off','ok');
});
$('dvItTodo').addEventListener('click', function(){ fromDrawer(function(){ page.open('To-do list', buildTodo); }); });
$('dvItCalc').addEventListener('click', function(){ fromDrawer(function(){ page.open('Calculator', buildCalc); }); });

var fsEl = $('dvFs');
fsEl.addEventListener('input', function(){
  S.fs = parseInt(fsEl.value, 10);
  applyFs();
  hap(H.tap);
});
fsEl.addEventListener('change', function(){ saveS(); toast('Text size ' + S.fs + 'px','ok'); });

function isStandalone(){
  try{ return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }catch(e){ return false; }
}
async function installApp(){
  await nav.back();
  if(isStandalone()){ toast('Carol Songs is already installed','ok'); return; }
  if(dv.installEvt){
    var ev = dv.installEvt;
    dv.installEvt = null;
    ev.prompt();
    var c = null;
    try{ c = await ev.userChoice; }catch(e){}
    if(c && c.outcome === 'accepted') toast('Installing Carol Songs','ok');
    else toast('Install cancelled','warn');
    return;
  }
  await modal.info({
    title: 'Install from Chrome', icon: 'download',
    paragraphs: [
      'Tap the Chrome menu (three dots), then choose Install app or Add to Home screen.',
      'If you do not see it, open this page in Chrome and make sure Chrome is up to date.'
    ]
  });
}
$('dvItInstall').addEventListener('click', installApp);

async function shareApp(){
  var url = location.href.split('#')[0].split('?')[0];
  var data = { title: 'Carol Songs', text: 'Free public domain Christmas songs to stream and keep offline.', url: url };
  if(navigator.share){
    try{ await navigator.share(data); toast('Thanks for sharing','ok'); return; }
    catch(e){ if(e && e.name === 'AbortError') return; }
  }
  try{
    await navigator.clipboard.writeText(url);
    toast('Link copied','ok');
  }catch(e){
    var inp = el('input','dv-field');
    inp.type = 'text'; inp.readOnly = true; inp.value = url;
    inp.addEventListener('focus', function(){ inp.select(); });
    await modal.info({ title: 'Copy the link', icon: 'link', message: 'Select the link below and copy it.', content: inp, buttonText: 'Done' });
  }
}
$('dvItShare').addEventListener('click', async function(){ await nav.back(); shareApp(); });

/* ================= Library + tab events ================= */
(function buildChips(){
  var box = $('dvChips');
  FILTERS.forEach(function(f){
    var b = el('button','dv-chip', f[1]);
    b.type = 'button';
    b.dataset.f = f[0];
    b.setAttribute('aria-pressed', f[0] === 'all' ? 'true' : 'false');
    b.addEventListener('click', function(){ dv.filter = f[0]; renderLibrary(); });
    box.appendChild(b);
  });
})();
$('dvQ').addEventListener('input', function(){ dv.query = $('dvQ').value; renderLibrary(); });
$('dvQ').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); $('dvQ').blur(); } });
$('dvQClear').addEventListener('click', function(){ $('dvQ').value = ''; dv.query = ''; renderLibrary(); $('dvQ').focus(); });
$('dvViewList').addEventListener('click', function(){ S.view = 'list'; saveS(); renderLibrary(); });
$('dvViewGrid').addEventListener('click', function(){ S.view = 'grid'; saveS(); renderLibrary(); });
$('dvFindMore').addEventListener('click', findOnline);

$('dvNavHome').addEventListener('click', function(){ setTab('home'); });
$('dvNavMp3').addEventListener('click', function(){ setTab('mp3'); });
$('dvNavLib').addEventListener('click', function(){ setTab('lib'); });

$('dvQaRecent').addEventListener('click', function(){
  dv.filter = 'recent'; dv.query = ''; $('dvQ').value = '';
  setTab('lib');
  if(!sorted().some(function(s){ return s.lastPlayed; })) toast('No recent songs yet');
});
$('dvQaPlay').addEventListener('click', async function(){
  if(dv.cur && isPlaying()){ setTab('mp3'); return; }
  await playButton();
  if(dv.cur) setTab('mp3');
});
$('dvQaSearch').addEventListener('click', function(){
  dv.filter = 'all';
  setTab('lib');
  setTimeout(function(){ $('dvQ').focus(); }, 250);
});
$('dvQaLib').addEventListener('click', function(){
  dv.filter = 'all'; dv.query = ''; $('dvQ').value = '';
  setTab('lib');
});

/* ================= Player events ================= */
$('dvPlay').addEventListener('click', playButton);
$('dvNext').addEventListener('click', function(){ if(!dv.cur){ toast('Press play to start a song','warn'); return; } nextSong(false); });
$('dvPrev').addEventListener('click', function(){ if(!dv.cur){ toast('Press play to start a song','warn'); return; } prevSong(); });
$('dvShuffle').addEventListener('click', function(){ dv.shuffle = !dv.shuffle; sync(); toast(dv.shuffle ? 'Shuffle on' : 'Shuffle off'); });
$('dvRepeat').addEventListener('click', function(){
  dv.repeat = (dv.repeat + 1) % 3;
  sync();
  toast(['Repeat off','Repeat one song','Repeat all songs'][dv.repeat]);
});
$('dvBtnFav').addEventListener('click', function(){ if(!dv.cur){ toast('Play a song first','warn'); return; } toggleFav(dv.cur); });
$('dvBtnOff').addEventListener('click', function(){ if(!dv.cur){ toast('Play a song first','warn'); return; } toggleOffline(dv.cur); });
$('dvBtnInfo').addEventListener('click', function(){ if(!dv.cur){ toast('Play a song first','warn'); return; } songDetails(dv.cur); });

var volRange = $('dvVolRange');
function applyVol(){
  var v = Math.min(100, Math.max(0, parseInt(S.vol, 10) || 0));
  audio.volume = v / 100;
  volRange.value = String(v);
  $('dvVolPct').textContent = audio.muted ? 'Muted' : v + '%';
  var name = audio.muted || v === 0 ? 'vol-off' : (v < 50 ? 'vol-down' : 'vol');
  setIcon($('dvVolMute'), name);
  setIcon($('dvBtnVol'), name);
}
$('dvBtnVol').addEventListener('click', function(){
  var p = $('dvVolPanel');
  p.classList.toggle('dv-show');
  $('dvBtnVol').classList.toggle('dv-on', p.classList.contains('dv-show'));
});
$('dvVolMute').addEventListener('click', function(){
  audio.muted = !audio.muted;
  applyVol();
  toast(audio.muted ? 'Muted' : 'Sound on');
});
volRange.addEventListener('input', function(){
  S.vol = parseInt(volRange.value, 10);
  if(S.vol > 0) audio.muted = false;
  applyVol();
});
volRange.addEventListener('change', saveS);

var seek = $('dvSeek');
seek.addEventListener('input', function(){
  dv.seeking = true;
  var d = audio.duration;
  if(isFinite(d)) $('dvTc').textContent = fmt(d * seek.value / 1000);
});
seek.addEventListener('change', function(){
  var d = audio.duration;
  if(isFinite(d)) audio.currentTime = d * seek.value / 1000;
  dv.seeking = false;
});

audio.addEventListener('play', sync);
audio.addEventListener('pause', sync);
audio.addEventListener('waiting', function(){ if(dv.cur) bufStart(); });
audio.addEventListener('playing', function(){ dv.skips = 0; bufStop(); setMedia(); sync(); });
audio.addEventListener('canplay', bufStop);
audio.addEventListener('ended', function(){ nextSong(true); });
audio.addEventListener('error', function(){
  bufStop();
  if(!audio.getAttribute('src') || !dv.cur) return;
  toast('This song could not be played. Try the next one.','error');
  sync();
});
audio.addEventListener('loadedmetadata', function(){ $('dvTd').textContent = fmt(audio.duration); });
audio.addEventListener('durationchange', function(){ $('dvTd').textContent = fmt(audio.duration); });
audio.addEventListener('timeupdate', function(){
  var d = audio.duration, c = audio.currentTime;
  if(isFinite(d) && d > 0){
    if(!dv.seeking){
      seek.value = String(Math.round(c / d * 1000));
      $('dvTc').textContent = fmt(c);
    }
    if('mediaSession' in navigator && navigator.mediaSession.setPositionState){
      try{ navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate, position: Math.min(c, d) }); }catch(e){}
    }
  }
});

if('mediaSession' in navigator){
  var ms = navigator.mediaSession;
  var set = function(a, fn){ try{ ms.setActionHandler(a, fn); }catch(e){} };
  set('play', function(){ audio.play().catch(function(){}); });
  set('pause', function(){ audio.pause(); });
  set('previoustrack', prevSong);
  set('nexttrack', function(){ nextSong(false); });
  set('seekto', function(d){ if(d.seekTime != null) audio.currentTime = d.seekTime; });
  set('seekbackward', function(d){ audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
  set('seekforward', function(d){ audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
}

/* ================= Install + connectivity ================= */
window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); dv.installEvt = e; });
window.addEventListener('appinstalled', function(){ dv.installEvt = null; toast('Carol Songs installed','ok'); });
window.addEventListener('online', function(){ toast('Back online','ok'); });
window.addEventListener('offline', function(){ toast('You are offline. Saved songs still play.','warn'); });

/* ================= Init ================= */
async function init(){
  applyTheme();
  applyFs();
  applyVol();
  try{
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ if(S.dark === null) applyTheme(); });
  }catch(e){}
  try{
    await DV.db.open();
    var songs = await dbAll('songs');
    songs.forEach(function(s){
      dv.songs.set(s.id, s);
      if((s.order || 0) > dv.orderSeq) dv.orderSeq = s.order;
    });
    if(dv.orderSeq < 1000) dv.orderSeq = 1000;
    var keys = await dbKeys('blobs');
    keys.forEach(function(k){ dv.offline.add(k); });
    await seedCatalog(false);
  }catch(e){
    await modal.info({ title: 'Storage unavailable', icon: 'warn', paragraphs: ['Carol Songs could not open its storage on this phone. Your library will not be saved between visits.'] });
  }
  renderAll();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(function(){});
  }
}
init();
})();

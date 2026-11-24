/* Carol Songs - download.js
   Everything that talks to the network: Internet Archive and Wikimedia Commons
   search, finding a public domain recording for a catalog song, streaming
   address lookup, offline downloads and text-file export.
   Needs songs.js (DV.util, DV.db). Exposes window.DV.download */
(function(){
'use strict';
var DV = window.DV = window.DV || {};
var U = DV.util;

var probeEl = null;
function canPlay(mime){
  if(!probeEl) probeEl = new Audio();
  return probeEl.canPlayType(mime) !== '';
}

function noRecording(song){
  var e = new Error('No public domain recording found for ' + song.title);
  e.code = 'NO_RECORDING';
  return e;
}
function isAbort(e){ return !!(e && e.name === 'AbortError'); }

/* ---------- Internet Archive ---------- */
function iaUrl(q, rows, page){
  return 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q)
    + '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=date&fl%5B%5D=licenseurl'
    + '&sort%5B%5D=downloads+desc&rows=' + rows + '&page=' + page + '&output=json';
}

async function iaDocs(q, signal){
  var res = await fetch(iaUrl(q, 8, 1), { signal: signal });
  if(!res.ok) throw new Error('Internet Archive search failed');
  var data = await res.json();
  return (data.response && data.response.docs) || [];
}

/* Discover tab / "Find more songs online": one page of results */
async function srcIA(mode, term, c, signal){
  var rows = 30;
  var t = U.clean(term);
  var topic = '(christmas OR carol OR carols OR noel OR xmas)';
  var q = t ? '(' + t + ') AND ' + topic
            : '(subject:christmas OR title:christmas OR title:carol OR title:carols OR title:noel)';
  q += ' AND mediatype:audio';
  q += mode === 'strict' ? ' AND date:[1800-01-01 TO 1925-12-31]' : ' AND licenseurl:(*publicdomain*)';
  var res = await fetch(iaUrl(q, rows, c.page), { signal: signal });
  if(!res.ok) throw new Error('Internet Archive search failed');
  var data = await res.json();
  var r = data.response || {};
  var docs = r.docs || [];
  var total = r.numFound || 0;
  var out = [];
  docs.forEach(function(d){
    var year = U.yearOf(d.year) || U.yearOf(d.date);
    var lic = String(d.licenseurl || '').toLowerCase();
    if(mode === 'strict' && !(year && year <= 1925)) return;
    if(mode === 'pd' && lic.indexOf('publicdomain') === -1) return;
    out.push({
      id: 'ia:' + d.identifier, source: 'ia', ident: d.identifier, src: null,
      title: U.first(d.title) || d.identifier,
      artist: U.first(d.creator) || 'Unknown artist',
      year: year,
      license: mode === 'strict' ? 'Public domain recording (US, 1925 or earlier)' : 'Marked public domain or CC0',
      page: 'https://archive.org/details/' + encodeURIComponent(d.identifier),
      fav: false, lastPlayed: 0
    });
  });
  c.page += 1;
  if(docs.length < rows || (c.page - 1) * rows >= total) c.done = true;
  return out;
}

/* Finds the best playable audio file inside an Internet Archive item */
async function iaFile(ident, signal){
  var res = await fetch('https://archive.org/metadata/' + encodeURIComponent(ident), { signal: signal });
  if(!res.ok) throw new Error('Could not load song details');
  var meta = await res.json();
  var files = (meta.files || []).filter(function(f){
    return f && f.name && !/_sample|_spectrogram/i.test(f.name);
  });
  function rank(f){
    var n = f.name.toLowerCase();
    if(n.endsWith('.mp3')) return f.source === 'derivative' ? 0 : 1;
    if(n.endsWith('.ogg') || n.endsWith('.opus')) return 2;
    return 99;
  }
  files.sort(function(a, b){ return rank(a) - rank(b); });
  var best = files[0];
  if(!best || rank(best) === 99) return null;
  return 'https://archive.org/download/' + encodeURIComponent(ident) + '/'
    + best.name.split('/').map(encodeURIComponent).join('/');
}

/* ---------- Wikimedia Commons ---------- */
/* topic: undefined = Christmas bias, '' = none, or any extra search words */
async function srcWM(term, c, signal, topic){
  var t = U.clean(term);
  var extra = topic === undefined ? ' (christmas OR carol OR noel)' : (topic ? ' ' + topic : '');
  var search = (t ? t + extra : 'christmas carol') + ' filetype:audio';
  var url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search'
    + '&gsrsearch=' + encodeURIComponent(search)
    + '&gsrnamespace=6&gsrlimit=30&gsroffset=' + c.cont
    + '&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&format=json&origin=*';
  var res = await fetch(url, { signal: signal });
  if(!res.ok) throw new Error('Wikimedia search failed');
  var data = await res.json();
  var pages = data.query && data.query.pages
    ? Object.keys(data.query.pages).map(function(k){ return data.query.pages[k]; }) : [];
  pages.sort(function(a, b){ return (a.index || 0) - (b.index || 0); });
  var out = [];
  pages.forEach(function(p){
    var ii = p.imageinfo && p.imageinfo[0];
    if(!ii || !ii.url) return;
    var mime = String(ii.mime || '').toLowerCase();
    if(mime === 'application/ogg') mime = 'audio/ogg';
    if(!mime || !canPlay(mime)) return;
    var md = ii.extmetadata || {};
    var val = function(k){ return md[k] && md[k].value ? md[k].value : ''; };
    var title = p.title.replace(/^File:/, '').replace(/\.[A-Za-z0-9]+$/, '').replace(/_/g, ' ');
    out.push({
      id: 'wm:' + p.pageid, source: 'wm', src: ii.url, title: title,
      artist: U.plain(val('Artist')) || 'Unknown artist',
      year: U.yearOf(U.plain(val('DateTimeOriginal'))) || U.yearOf(U.plain(val('DateTime'))),
      license: U.plain(val('LicenseShortName')) || 'Free license (see source)',
      page: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title)),
      fav: false, lastPlayed: 0
    });
  });
  if(data.continue && data.continue.gsroffset != null) c.cont = data.continue.gsroffset;
  else c.done = true;
  return out;
}

/* key: 'ia-strict' | 'ia-pd' | 'wm' */
function search(key, term, c, signal){
  if(key === 'wm') return srcWM(term, c, signal);
  return srcIA(key === 'ia-strict' ? 'strict' : 'pd', term, c, signal);
}

/* ---------- Finding a recording for a catalog song ---------- */
function titleMatches(title, name){
  var have = U.clean(U.first(title)).toLowerCase().split(' ');
  return U.clean(name).toLowerCase().split(' ').every(function(w){ return have.indexOf(w) !== -1; });
}

async function findRecording(song, signal){
  var names = (song.names && song.names.length ? song.names : [U.clean(song.title)]).filter(Boolean);
  var passes = [
    { id: 'strict', filter: ' AND mediatype:audio AND date:[1800-01-01 TO 1925-12-31]',
      license: 'Public domain recording (US, 1925 or earlier)' },
    { id: 'pd', filter: ' AND mediatype:audio AND licenseurl:(*publicdomain*)',
      license: 'Marked public domain or CC0' }
  ];
  for(var p = 0; p < passes.length; p++){
    for(var n = 0; n < names.length; n++){
      var name = names[n];
      var docs = await iaDocs('title:("' + name + '")' + passes[p].filter, signal);
      if(!docs.length) docs = await iaDocs('("' + name + '")' + passes[p].filter, signal);
      var tried = 0;
      for(var i = 0; i < docs.length && tried < 4; i++){
        var d = docs[i];
        if(!titleMatches(d.title, name)) continue;
        var year = U.yearOf(d.year) || U.yearOf(d.date);
        if(passes[p].id === 'strict' && !(year && year <= 1925)) continue;
        if(passes[p].id === 'pd' && String(d.licenseurl || '').toLowerCase().indexOf('publicdomain') === -1) continue;
        tried++;
        var link = null;
        try{ link = await iaFile(d.identifier, signal); }
        catch(e){ if(isAbort(e)) throw e; link = null; }
        if(!link) continue;
        song.src = link;
        song.recSource = 'ia';
        song.recTitle = U.first(d.title);
        song.artist = U.first(d.creator) || 'Unknown artist';
        song.year = year;
        song.license = passes[p].license;
        song.page = 'https://archive.org/details/' + encodeURIComponent(d.identifier);
        await DV.db.put('songs', song);
        return link;
      }
    }
  }
  var topic = song.kind === 'hymn' ? '' : undefined;
  for(var m = 0; m < names.length; m++){
    var items = await srcWM(names[m], { cont: 0, done: false }, signal, topic);
    for(var k = 0; k < items.length; k++){
      if(!titleMatches(items[k].title, names[m])) continue;
      song.src = items[k].src;
      song.recSource = 'wm';
      song.recTitle = items[k].title;
      song.artist = items[k].artist;
      song.year = items[k].year;
      song.license = items[k].license;
      song.page = items[k].page;
      await DV.db.put('songs', song);
      return song.src;
    }
  }
  throw noRecording(song);
}

/* ---------- Public: get a playable address for any song ---------- */
var pending = {};
function resolve(song, signal){
  if(song.src) return Promise.resolve(song.src);
  if(pending[song.id]) return pending[song.id];
  var p = (async function(){
    if(song.source === 'catalog') return findRecording(song, signal);
    if(song.source === 'ia'){
      var link = await iaFile(song.ident, signal);
      if(!link) throw new Error('No playable audio in this item');
      song.src = link;
      DV.db.put('songs', song).catch(function(){});
      return link;
    }
    throw new Error('No audio file');
  })();
  pending[song.id] = p;
  var clear = function(){ delete pending[song.id]; };
  p.then(clear, clear);
  return p;
}

/* ---------- Public: download the audio so it plays offline ---------- */
async function saveOffline(song, signal){
  var url = await resolve(song, signal);
  var res = await fetch(url, { signal: signal });
  if(!res.ok) throw new Error('download failed');
  return res.blob();
}

/* ---------- Public: save text as a file on the phone ---------- */
function saveTextFile(name, text){
  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
}

/* ---------- Public: save a binary file (such as a recording) on the phone ---------- */
function saveBlobFile(name, blob){
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
}

DV.download = {
  search: search,
  resolve: resolve,
  saveOffline: saveOffline,
  saveTextFile: saveTextFile,
  saveBlobFile: saveBlobFile,
  findRecording: findRecording
};
})();

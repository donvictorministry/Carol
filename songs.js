/* Carol Songs - songs.js
   Built-in song catalog (public domain carols and hymns), shared utilities and
   local storage (IndexedDB). Loaded first. Exposes:
   window.DV.util, window.DV.db, window.DV.catalog */
(function(){
'use strict';
var DV = window.DV = window.DV || {};

/* ---------- utilities shared by every module ---------- */
var util = {
  clean: function(s){
    return String(s || '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  },
  plain: function(html){
    if(!html) return '';
    var d = new DOMParser().parseFromString(String(html), 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
  },
  yearOf: function(v){
    var m = String(v || '').match(/\d{4}/);
    return m ? parseInt(m[0], 10) : null;
  },
  first: function(v){
    return Array.isArray(v) ? v.join(', ') : (v || '');
  },
  slug: function(s){
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
};
DV.util = util;

/* ---------- IndexedDB: stores "songs" and "blobs" ---------- */
var DB = null;
function open(){
  return new Promise(function(resolve, reject){
    var req = indexedDB.open('dvCarolDB', 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if(!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if(!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
    };
    req.onsuccess = function(){ DB = req.result; resolve(DB); };
    req.onerror = function(){ reject(req.error); };
  });
}
function tx(store, mode, fn){
  return new Promise(function(resolve, reject){
    var t = DB.transaction(store, mode);
    var st = t.objectStore(store);
    var r = fn(st);
    t.oncomplete = function(){ resolve(r && r.result); };
    t.onerror = function(){ reject(t.error); };
    t.onabort = function(){ reject(t.error); };
  });
}
DV.db = {
  open: open,
  put: function(s, v){ return tx(s, 'readwrite', function(st){ return st.put(v); }); },
  putMany: function(s, arr){ return tx(s, 'readwrite', function(st){ arr.forEach(function(v){ st.put(v); }); }); },
  del: function(s, k){ return tx(s, 'readwrite', function(st){ return st.delete(k); }); },
  get: function(s, k){ return tx(s, 'readonly', function(st){ return st.get(k); }); },
  all: function(s){ return tx(s, 'readonly', function(st){ return st.getAll(); }); },
  keys: function(s){ return tx(s, 'readonly', function(st){ return st.getAllKeys(); }); }
};

/* ---------- catalog: [title, [other names used to find a recording]] ---------- */
var CAROLS = [
  ['Silent Night', ['Stille Nacht']],
  ['O Holy Night', ['Cantique de Noel']],
  ['Joy to the World', []],
  ['Hark! The Herald Angels Sing', []],
  ['O Come, All Ye Faithful (Adeste Fideles)', ['Adeste Fideles']],
  ['Away in a Manger', []],
  ['What Child Is This? (Greensleeves)', ['Greensleeves']],
  ['Go Tell It on the Mountain', []],
  ['Deck the Halls', []],
  ['We Wish You a Merry Christmas', []],
  ['Jingle Bells', []],
  ['It Came Upon the Midnight Clear', ['Midnight Clear']],
  ['The First Noel', ['First Nowell', 'The First Nowell']],
  ['Angels We Have Heard on High', []],
  ['O Little Town of Bethlehem', []],
  ['We Three Kings of Orient Are', ['We Three Kings']],
  ['God Rest Ye Merry, Gentlemen', ['God Rest You Merry Gentlemen']],
  ['O Come, O Come, Emmanuel', ['O Come Emmanuel']],
  ['Good King Wenceslas', []],
  ["Once in Royal David's City", ['Once in Royal Davids City']],
  ['While Shepherds Watched Their Flocks by Night', ['While Shepherds Watched']],
  ['Angels from the Realms of Glory', []],
  ['In the Bleak Midwinter', []],
  ['Good Christian Men, Rejoice', ['Good Christian Men Rejoice']],
  ['O Christmas Tree (O Tannenbaum)', ['O Tannenbaum']],
  ['The Twelve Days of Christmas', ['Twelve Days of Christmas']],
  ['Ding Dong Merrily on High', []],
  ['I Saw Three Ships', []],
  ['The Holly and the Ivy', []],
  ["Lo, How a Rose E'er Blooming", ['Es ist ein Ros entsprungen', 'Lo How a Rose']],
  ['Coventry Carol', []],
  ['Bring a Torch, Jeanette, Isabella', ['Bring a Torch Jeanette Isabella']],
  ['Infant Holy, Infant Lowly', []],
  ['Still, Still, Still', []],
  ['I Heard the Bells on Christmas Day', []],
  ['Pat-a-Pan', ['Patapan']],
  ['Here We Come A-Wassailing', ['Here We Come a Wassailing']],
  ['Up on the Housetop', []],
  ['Jolly Old Saint Nicholas', []],
  ['Auld Lang Syne', []]
];

var HYMNS = [
  ['Amazing Grace', []],
  ['Blessed Assurance', []],
  ['It Is Well With My Soul', ['It Is Well']],
  ['Crown Him With Many Crowns', []],
  ["All Hail the Power of Jesus' Name", ['All Hail the Power of Jesus Name', 'Coronation']],
  ['Holy, Holy, Holy! Lord God Almighty', ['Holy Holy Holy']],
  ['Be Thou My Vision', []],
  ['To God Be the Glory', []],
  ['What a Friend We Have in Jesus', []],
  ['Come, Thou Fount of Every Blessing', ['Come Thou Fount']],
  ['Rock of Ages', []],
  ['A Mighty Fortress Is Our God', ['Ein feste Burg', 'Mighty Fortress']],
  ['Joyful, Joyful, We Adore Thee', ['Joyful Joyful We Adore Thee']],
  ['Praise to the Lord, the Almighty', ['Lobe den Herren', 'Praise to the Lord']],
  ['When I Survey the Wondrous Cross', []],
  ['Nearer, My God, to Thee', ['Nearer My God to Thee']],
  ['Abide with Me', []],
  ['Fairest Lord Jesus', ['Beautiful Savior']],
  ['For the Beauty of the Earth', []],
  ['The Old Rugged Cross', ['Old Rugged Cross']],
  ['Nothing but the Blood of Jesus', ['Nothing but the Blood']],
  ['Standing on the Promises', []],
  ['Sweet Hour of Prayer', []],
  ['Jesus Paid It All', []],
  ['I Surrender All', []],
  ['Leaning on the Everlasting Arms', []],
  ["'Tis So Sweet to Trust in Jesus", ['Tis So Sweet to Trust in Jesus']],
  ['My Hope Is Built on Nothing Less (The Solid Rock)', ['The Solid Rock', 'Solid Rock']],
  ['Pass Me Not, O Gentle Savior', ['Pass Me Not']],
  ['There Is a Fountain Filled with Blood', ['There Is a Fountain']]
];

/* Display title: drop the bracketed note, keep the rest exactly as listed */
function displayTitle(t){
  return t.replace(/\s*\([^)]*\)\s*$/, '').trim();
}
/* Extra search names: the bracketed text, e.g. "Adeste Fideles" */
function bracketName(t){
  var m = t.match(/\(([^)]*)\)\s*$/);
  return m ? m[1] : '';
}

/* Builds the song records that seed the library. Catalog songs sort before
   any song found online (negative order). */
function build(){
  var out = [];
  var n = 0;
  function add(list, kind){
    list.forEach(function(row){
      var title = displayTitle(row[0]);
      var names = [util.clean(title)];
      var br = bracketName(row[0]);
      if(br) names.push(util.clean(br));
      (row[1] || []).forEach(function(a){ names.push(util.clean(a)); });
      var seen = {};
      names = names.filter(function(x){
        var k = x.toLowerCase();
        if(!x || seen[k]) return false;
        seen[k] = true;
        return true;
      });
      out.push({
        id: 'cat:' + kind + ':' + util.slug(title),
        source: 'catalog',
        kind: kind,
        title: title,
        names: names,
        src: null,
        artist: kind === 'hymn' ? 'Public domain hymn' : 'Public domain carol',
        year: null,
        license: 'Public domain song. A public domain recording is found when you first play it.',
        page: '',
        fav: false,
        lastPlayed: 0,
        order: n - 100000
      });
      n++;
    });
  }
  add(CAROLS, 'carol');
  add(HYMNS, 'hymn');
  return out;
}

DV.catalog = { carols: CAROLS, hymns: HYMNS, build: build };
})();

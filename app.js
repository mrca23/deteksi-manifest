// Deteksi Manifest - perjelas foto, baca nomor bagging (Tesseract.js), buang yang tidak jelas.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var BAGGING_RE = /^LY\d{12}$/;
  var BATAS_YAKIN = 80;        // keyakinan minimal (0-100) agar nomor dimasukkan
  var LEBAR_TARGET = 1800;     // sisi pendek gambar setelah diperbesar (px)
  $('batasTxt').textContent = BATAS_YAKIN;

  var state = { asli: null, jelas: null, hasil: null, lihat: 'jelas' };

  // ---------- perjelas gambar ----------
  // Rata-rata kotak (box blur) memakai integral image: O(n) berapa pun radiusnya.
  function boxBlur(src, w, h, r) {
    var I = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h), x, y;
    for (y = 0; y < h; y++) {
      var baris = 0;
      for (x = 0; x < w; x++) {
        baris += src[y * w + x];
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + baris;
      }
    }
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        var s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
      }
    }
    return out;
  }

  function persentil(arr, p) {
    var hist = new Uint32Array(256), n = arr.length, i;
    for (i = 0; i < n; i++) hist[Math.max(0, Math.min(255, arr[i] | 0))]++;
    var target = n * p, c = 0;
    for (i = 0; i < 256; i++) { c += hist[i]; if (c >= target) return i; }
    return 255;
  }

  function otsu(arr) {
    var hist = new Float64Array(256), n = arr.length, i;
    for (i = 0; i < n; i++) hist[arr[i] | 0]++;
    var total = 0; for (i = 0; i < 256; i++) total += i * hist[i];
    var sumB = 0, wB = 0, best = 0, t = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (total - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }

  // Tandai piksel garis tabel: deret gelap horizontal >= w/12 atau vertikal >= h/25.
  // Toleransi celah kecil (garis foto tidak mulus) & tebal garis ikut dilebarkan 1 px.
  function hapusGaris(g, w, h, t) {
    var gelap = new Uint8Array(w * h), m = new Uint8Array(w * h), i, x, y;
    for (i = 0; i < w * h; i++) gelap[i] = g[i] <= t ? 1 : 0;
    var minH = Math.round(w / 12), minV = Math.round(h / 25), celah = 3;
    function tandai(ambil, panjang, jumlahGaris, minRun, set) {
      for (var a = 0; a < jumlahGaris; a++) {
        var mulai = -1, akhir = -1, kosong = 0;
        for (var b = 0; b <= panjang; b++) {
          var d = b < panjang && ambil(a, b);
          if (d) { if (mulai < 0) mulai = b; akhir = b; kosong = 0; }
          else if (mulai >= 0 && ++kosong > celah) {
            if (akhir - mulai + 1 >= minRun) for (var c = mulai; c <= akhir; c++) set(a, c);
            mulai = -1; kosong = 0;
          }
        }
      }
    }
    tandai(function (yy, xx) { return gelap[yy * w + xx]; }, w, h, minH, function (yy, xx) { m[yy * w + xx] = 1; });
    tandai(function (xx, yy) { return gelap[yy * w + xx]; }, h, w, minV, function (xx, yy) { m[yy * w + xx] = 1; });
    // lebarkan 1 px agar sisa tepi garis ikut hilang
    var out = new Uint8Array(w * h);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var k = y * w + x;
      if (m[k] || m[k - 1] || m[k + 1] || m[k - w] || m[k + w]) out[k] = 1;
    }
    return out;
  }

  function kanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // Perkiraan kemiringan foto: coba sudut -10..10 derajat, pilih yang membuat baris teks /
  // garis tabel paling "rata" (proyeksi horizontal paling tajam). Dihitung di gambar kecil.
  function sudutMiring(img, w0, h0) {
    var k = 500 / Math.max(w0, h0), w = Math.round(w0 * k), h = Math.round(h0 * k);
    var c = kanvas(w, h), ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var px = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), i;
    for (i = 0; i < w * h; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    var bg = boxBlur(g, w, h, 12), xs = [], ys = [];
    for (i = 0; i < w * h; i++) if (g[i] < 0.75 * bg[i]) { xs.push(i % w); ys.push((i / w) | 0); }
    var terbaik = 0, skorMax = -1;
    for (var d = -10; d <= 10.001; d += 0.25) {
      var a = d * Math.PI / 180, sn = Math.sin(a), cs = Math.cos(a), off = w + 2, hist = new Float64Array(w + h + 2 * off), skor = 0;
      for (i = 0; i < xs.length; i++) hist[Math.round(ys[i] * cs - xs[i] * sn) + off]++;
      for (i = 0; i < hist.length; i++) skor += hist[i] * hist[i];
      if (skor > skorMax) { skorMax = skor; terbaik = d; }
    }
    return terbaik;
  }

  function perjelas(img) {
    var w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    var s = Math.max(1, Math.min(3, LEBAR_TARGET / Math.min(w0, h0)));
    if (w0 * h0 * s * s > 14e6) s = Math.sqrt(14e6 / (w0 * h0));
    var sudut = sudutMiring(img, w0, h0), rad = Math.abs(sudut) >= 0.3 ? -sudut * Math.PI / 180 : 0;
    var sw = w0 * s, sh = h0 * s;
    var w = Math.round(Math.abs(sw * Math.cos(rad)) + Math.abs(sh * Math.sin(rad)));
    var h = Math.round(Math.abs(sw * Math.sin(rad)) + Math.abs(sh * Math.cos(rad)));

    // 0. luruskan + perbesar
    var asli = kanvas(w, h), ctx = asli.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2); ctx.rotate(rad);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var data = ctx.getImageData(0, 0, w, h), px = data.data, n = w * h, i;

    // 1. abu-abu
    var g = new Float32Array(n);
    for (i = 0; i < n; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

    // 2. ratakan pencahayaan: bagi dengan latar (blur besar) -> bayangan & gradasi hilang
    var bg = boxBlur(g, w, h, Math.round(Math.min(w, h) / 30));
    for (i = 0; i < n; i++) g[i] = Math.min(255, 255 * g[i] / (bg[i] + 1));

    // 3. regangkan kontras (persentil 1% - 99%)
    var lo = persentil(g, 0.01), hi = Math.max(lo + 1, persentil(g, 0.99));
    for (i = 0; i < n; i++) g[i] = Math.max(0, Math.min(255, (g[i] - lo) * 255 / (hi - lo)));

    // 4. pertajam (unsharp mask)
    var halus = boxBlur(g, w, h, Math.max(1, Math.round(s)));
    for (i = 0; i < n; i++) g[i] = Math.max(0, Math.min(255, g[i] + 0.8 * (g[i] - halus[i])));

    // 5. hapus garis tabel (deret piksel gelap panjang horizontal / vertikal)
    var t = otsu(g), garis = hapusGaris(g, w, h, t);
    for (i = 0; i < n; i++) if (garis[i]) g[i] = 255;

    var abu = kanvas(w, h), hp = kanvas(w, h);
    var dAbu = abu.getContext('2d').createImageData(w, h), dHp = hp.getContext('2d').createImageData(w, h);
    for (i = 0; i < n; i++) {
      var v = g[i] | 0, b = g[i] > t ? 255 : 0, k = i * 4;
      dAbu.data[k] = dAbu.data[k + 1] = dAbu.data[k + 2] = v; dAbu.data[k + 3] = 255;
      dHp.data[k] = dHp.data[k + 1] = dHp.data[k + 2] = b; dHp.data[k + 3] = 255;
    }
    abu.getContext('2d').putImageData(dAbu, 0, 0);
    hp.getContext('2d').putImageData(dHp, 0, 0);
    return { asli: asli, abu: abu, hp: hp, skala: s, sudut: rad ? sudut : 0 };
  }

  // ---------- baca teks ----------
  // Dibaca beberapa kali (gambar abu-abu & hitam-putih x 2 mode tata letak). Nomor dimasukkan
  // hanya kalau semua pembacaan di posisi itu sepakat.
  var PASS = [
    { gambar: 'abu', psm: '11', label: 'abu-abu, teks tersebar' },
    { gambar: 'hp', psm: '11', label: 'hitam-putih, teks tersebar' },
    { gambar: 'abu', psm: '4', label: 'abu-abu, per kolom' },
    { gambar: 'hp', psm: '4', label: 'hitam-putih, per kolom' }
  ];
  var workerP = null;
  function worker() {
    if (!workerP) {
      workerP = Tesseract.createWorker('eng', 1, {
        logger: function (m) { if (m.status === 'recognizing text') progres(state.tahap, m.progress); }
      }).then(function (wk) {
        return wk.setParameters({ tessedit_char_whitelist: 'LY0123456789', preserve_interword_spaces: '0' })
          .then(function () { return wk; });
      });
    }
    return workerP;
  }

  // Kata dari Tesseract kadang menyambung lintas kolom (NO / JUMLAH ISI). Pecah di celah
  // antar huruf yang lebar (> 0.9x lebar huruf rata-rata) supaya tiap kolom terpisah.
  function pecahKata(wd) {
    var sym = (wd.symbols || []).filter(function (s) { return /[LY0-9]/.test(s.text); });
    if (sym.length < 2) return [{ teks: (wd.text || '').replace(/[^LY0-9]/g, ''), yakin: wd.confidence, box: wd.bbox }];
    var lebar = sym.map(function (s) { return s.bbox.x1 - s.bbox.x0; }).sort(function (a, b) { return a - b; });
    var med = lebar[lebar.length >> 1] || 1, seg = [], cur = [sym[0]];
    for (var i = 1; i < sym.length; i++) {
      if (sym[i].bbox.x0 - sym[i - 1].bbox.x1 > 0.9 * med) { seg.push(cur); cur = []; }
      cur.push(sym[i]);
    }
    seg.push(cur);
    return seg.map(function (s) {
      var yakin = s.reduce(function (a, x) { return a + x.confidence; }, 0) / s.length;
      return {
        teks: s.map(function (x) { return x.text; }).join(''),
        yakin: seg.length === 1 ? Math.min(yakin, wd.confidence || yakin) : yakin,
        box: s.reduce(function (b, x) {
          return { x0: Math.min(b.x0, x.bbox.x0), y0: Math.min(b.y0, x.bbox.y0), x1: Math.max(b.x1, x.bbox.x1), y1: Math.max(b.y1, x.bbox.y1) };
        }, { x0: 1e9, y0: 1e9, x1: 0, y1: 0 })
      };
    });
  }

  // Kandidat = potongan yang mirip usaha menulis nomor bagging (ada L/Y, atau >= 10 angka).
  function kandidat(words, pass) {
    var out = [];
    words.forEach(function (wd) {
      pecahKata(wd).forEach(function (p) {
        // angka di DEPAN "LY" pasti kolom NO (bagging selalu diawali LY) -> aman dibuang.
        // Angka di belakang tidak dipotong: bisa jadi digit bagging yang hilang terisi kolom JUMLAH.
        var t = p.teks.replace(/^\d{1,3}(?=LY)/, '');
        if (t.length < 8) return;
        if (!/[LY]/.test(t) && !/\d{10,}/.test(t)) return;
        out.push({ teks: t, yakin: p.yakin, box: p.box, pass: pass });
      });
    });
    return out;
  }

  function tumpang(a, b) {
    var ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix <= 0 || iy <= 0) return false;
    var ha = a.y1 - a.y0, hb = b.y1 - b.y0;
    return iy >= 0.5 * Math.min(ha, hb) && ix >= 0.3 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
  }

  // Gabungkan hasil 2x baca per posisi, lalu putuskan: dimasukkan / tidak jelas.
  function putuskan(semua) {
    var grup = [];
    semua.forEach(function (c) {
      var g = grup.find(function (x) { return x.anggota.some(function (y) { return tumpang(y.box, c.box); }); });
      if (g) g.anggota.push(c); else grup.push({ anggota: [c] });
    });
    var ok = [], tidak = [];
    grup.forEach(function (g) {
      var sah = g.anggota.filter(function (c) { return BAGGING_RE.test(c.teks); });
      var beda = sah.map(function (c) { return c.teks; }).filter(function (t, i, a) { return a.indexOf(t) === i; });
      var box = g.anggota.reduce(function (b, c) {
        return { x0: Math.min(b.x0, c.box.x0), y0: Math.min(b.y0, c.box.y0), x1: Math.max(b.x1, c.box.x1), y1: Math.max(b.y1, c.box.y1) };
      }, { x0: 1e9, y0: 1e9, x1: 0, y1: 0 });
      var terbaik = g.anggota.slice().sort(function (a, b) { return b.yakin - a.yakin; })[0];
      var r = { box: box, yakin: Math.round(sah.length ? Math.max.apply(null, sah.map(function (c) { return c.yakin; })) : terbaik.yakin) };
      if (beda.length === 1 && r.yakin >= BATAS_YAKIN) {
        r.nomor = beda[0];
        r.cocok = sah.length;
        ok.push(r);
      } else {
        r.teks = beda.length ? beda.join(' / ') : terbaik.teks;
        r.alasan = beda.length > 1 ? 'pembacaan ulang hasilnya berbeda'
          : !beda.length ? 'format tidak lengkap (harus LY + 12 angka)'
          : 'keyakinan rendah (' + r.yakin + '%)';
        tidak.push(r);
      }
    });
    // nomor sama muncul 2x di posisi berbeda: simpan sekali, tandai
    var lihat = {}, unik = [];
    ok.sort(urutPosisi).forEach(function (r) {
      if (lihat[r.nomor]) { lihat[r.nomor].dobel = true; return; }
      lihat[r.nomor] = r; unik.push(r);
    });
    return { ok: unik, tidak: tidak.sort(urutPosisi) };
  }
  // Gambar sudah diluruskan dan 1 baris manifest = 1 nomor bagging: urut dari tengah-y.
  function urutPosisi(a, b) { return (a.box.y0 + a.box.y1) - (b.box.y0 + b.box.y1) || a.box.x0 - b.box.x0; }

  function proses(img) {
    var t0 = Date.now();
    setStatus('Memperjelas gambar...');
    $('bar').classList.remove('tersembunyi'); progres(0, 0);
    return new Promise(function (res) { setTimeout(res, 30); }).then(function () {
      var p = perjelas(img);
      state.asli = p.asli; state.jelas = p.abu; state.hp = p.hp;
      tampilGambar();
      setStatus('Menyiapkan pembaca teks (sekali unduh +-5 MB saat pertama kali)...');
      return worker().then(function (wk) {
        var semua = [];
        var jalan = PASS.reduce(function (rantai, ps, i) {
          return rantai.then(function () {
            state.tahap = i;
            setStatus('Membaca gambar (' + (i + 1) + '/' + PASS.length + ': ' + ps.label + ')...');
            return wk.setParameters({ tessedit_pageseg_mode: ps.psm })
              .then(function () { return wk.recognize(p[ps.gambar]); })
              .then(function (r) { semua = semua.concat(kandidat(r.data.words, i)); });
          });
        }, Promise.resolve());
        return jalan.then(function () {
          state.hasil = putuskan(semua);
          state.hasil.detik = Math.round((Date.now() - t0) / 1000);
          state.hasil.sudut = p.sudut;
          $('bar').classList.add('tersembunyi');
          tampilHasil();
          return state.hasil;
        });
      });
    }).catch(function (err) {
      $('bar').classList.add('tersembunyi');
      setStatus('Gagal membaca: ' + (err && err.message ? err.message : err) + '. Cek koneksi internet (pembaca teks perlu diunduh sekali).', 'error');
    });
  }

  // ---------- tampilan ----------
  function setStatus(msg, cls) { var s = $('status'); s.textContent = msg; s.className = 'status' + (cls ? ' ' + cls : ''); }
  function progres(tahap, p) { $('bar').firstElementChild.style.width = Math.round((tahap + (p || 0)) / PASS.length * 100) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function potong(box) {
    var src = state.jelas, pad = 6;
    var x = Math.max(0, box.x0 - pad), y = Math.max(0, box.y0 - pad);
    var w = Math.min(src.width - x, box.x1 - box.x0 + pad * 2), h = Math.min(src.height - y, box.y1 - box.y0 + pad * 2);
    var c = kanvas(w, h); c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
    return c.toDataURL('image/png');
  }

  function tampilHasil() {
    var h = state.hasil;
    $('hasilBox').classList.remove('tersembunyi');
    $('ringkas').innerHTML =
      '<div class="ok"><small>Nomor bagging dimasukkan</small><strong>' + h.ok.length + '</strong></div>' +
      '<div class="' + (h.tidak.length ? 'warn' : '') + '"><small>Tidak jelas (tidak dimasukkan)</small><strong>' + h.tidak.length + '</strong></div>' +
      '<div><small>Waktu baca</small><strong>' + h.detik + ' dtk</strong></div>' +
      '<div><small>Foto diluruskan</small><strong>' + (h.sudut ? String(Math.abs(h.sudut)).replace('.', ',') + '°' : '-') + '</strong></div>';
    $('jmlList').textContent = '(' + h.ok.length + ')';
    $('listBagging').innerHTML = h.ok.map(function (r) {
      return '<li>' + r.nomor + (r.dobel ? ' <small>tertulis 2x</small>' : '') + '</li>';
    }).join('');
    $('tabelOk').innerHTML = '<thead><tr><th class="num">No</th><th>No. Bagging</th><th class="num">Yakin</th><th>Potongan gambar</th></tr></thead><tbody>' +
      (h.ok.length ? h.ok.map(function (r, i) {
        return '<tr><td class="num">' + (i + 1) + '</td><td class="mono">' + r.nomor + (r.dobel ? ' <small class="alasan">(tertulis 2x)</small>' : '') +
          '</td><td class="num">' + r.yakin + '%</td><td><img alt="" src="' + potong(r.box) + '"></td></tr>';
      }).join('') : '<tr><td colspan="4">Tidak ada nomor bagging yang terbaca jelas. Coba foto ulang lebih dekat & terang.</td></tr>') + '</tbody>';
    $('tidakBox').classList.toggle('tersembunyi', !h.tidak.length);
    $('tabelTidak').innerHTML = '<thead><tr><th>Terbaca</th><th>Alasan</th><th>Potongan gambar</th></tr></thead><tbody>' +
      h.tidak.map(function (r) {
        return '<tr><td class="mono">' + esc(r.teks) + '</td><td class="alasan">' + esc(r.alasan) + '</td><td><img alt="" src="' + potong(r.box) + '"></td></tr>';
      }).join('') + '</tbody>';
    setStatus(h.ok.length + ' nomor bagging terbaca jelas' + (h.tidak.length ? ', ' + h.tidak.length + ' tidak jelas tidak dimasukkan.' : '.'), 'ok');
    tampilGambar();
  }

  function tampilGambar() {
    var src = state.lihat === 'asli' ? state.asli : state.jelas;
    if (!src) return;
    var c = kanvas(src.width, src.height), ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    if (state.hasil) {
      ctx.lineWidth = Math.max(2, src.width / 500);
      state.hasil.ok.forEach(function (r) { ctx.strokeStyle = '#1f9d4a'; ctx.strokeRect(r.box.x0 - 3, r.box.y0 - 3, r.box.x1 - r.box.x0 + 6, r.box.y1 - r.box.y0 + 6); });
      state.hasil.tidak.forEach(function (r) { ctx.strokeStyle = '#e0a000'; ctx.strokeRect(r.box.x0 - 3, r.box.y0 - 3, r.box.x1 - r.box.x0 + 6, r.box.y1 - r.box.y0 + 6); });
    }
    $('gambar').innerHTML = ''; $('gambar').appendChild(c);
    $('gambarBox').classList.remove('tersembunyi');
  }

  function daftarNomor() { return state.hasil ? state.hasil.ok.map(function (r) { return r.nomor; }) : []; }

  // ---------- event ----------
  function bukaFile(file) {
    if (!file || !/^image\//.test(file.type)) return setStatus('File harus berupa gambar (.jpg / .png / .webp).', 'error');
    state.hasil = null;
    $('hasilBox').classList.add('tersembunyi');
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () { URL.revokeObjectURL(url); proses(img); };
    img.onerror = function () { setStatus('Gambar tidak bisa dibuka. Format HEIC (iPhone) belum didukung, kirim sebagai JPG.', 'error'); };
    img.src = url;
  }
  $('file').addEventListener('change', function (e) { bukaFile(e.target.files[0]); e.target.value = ''; });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('aktif'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('aktif'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); bukaFile(e.dataTransfer.files[0]); });
  document.querySelectorAll('[data-lihat]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.lihat = b.dataset.lihat;
      document.querySelectorAll('[data-lihat]').forEach(function (x) { x.classList.toggle('aktif', x === b); });
      tampilGambar();
    });
  });
  $('btnSalin').addEventListener('click', function () {
    var t = daftarNomor().join('\n');
    (navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(t) : Promise.reject())
      .then(function () { setStatus(daftarNomor().length + ' nomor bagging disalin.', 'ok'); },
        function () {
          var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); setStatus('Nomor bagging disalin.', 'ok'); } catch (e) { setStatus('Gagal menyalin.', 'error'); }
          ta.remove();
        });
  });
  $('btnTxt').addEventListener('click', function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([daftarNomor().join('\r\n') + '\r\n'], { type: 'text/plain' }));
    a.download = 'bagging-manifest.txt'; document.body.appendChild(a); a.click(); a.remove();
  });

  // untuk pengujian otomatis
  window.__manifest = { proses: proses, reset: function () { if (workerP) workerP.then(function (w) { w.terminate(); }); workerP = null; } };
})();

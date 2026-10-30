(function () {
  "use strict";
  const STORE = "evotingdpt_future_v3";
  const USER_SESSION = "evotingdpt_user_v3";
  const ADMIN_SESSION = "evotingdpt_admin_v3";
  const ADMIN_HASH = "7a75134a89dba9fe05c7957c1b30cd53d213c3c1ef7311389e237b8f8c4f2fd4";
  const SEED_USERS = [
    { name: "Teuku Kanda Alwan M.", username: "teukukanda", passwordHash: "8cc8e00dd4fba82797cf9fc22b57223d4fe8a24db29de93e1fa1608716aaa56e" },
    { name: "Fadhil Zulfiqar", username: "fadhilzulfiqar", passwordHash: "3b4f36e1db43fb027519b0bb09ed2390fc7da240148354d1f735e5860a5b0320" },
    { name: "M. Dafa Alhafis", username: "mdafaalhafis", passwordHash: "428bb0a2dc1698f92ba12567c1cc5b922d0de11196016606796f39cb1f6b64cf" }
  ];
  const DEFAULT_CANDIDATES = [
    { id: "01", ketua: "Nama Ketua Paslon 01", wakil: "Nama Wakil Paslon 01", visi: "Visi Paslon 01 dapat dilengkapi oleh admin.", misi: "Misi Paslon 01 dapat dilengkapi oleh admin.", slogan: "Bersama membangun DPT yang lebih baik.", photoKetua: "assets/paslon-01-ketua.webp", photoWakil: "assets/paslon-01-wakil.webp" },
    { id: "02", ketua: "Nama Ketua Paslon 02", wakil: "Nama Wakil Paslon 02", visi: "Visi Paslon 02 dapat dilengkapi oleh admin.", misi: "Misi Paslon 02 dapat dilengkapi oleh admin.", slogan: "Bergerak bersama untuk masa depan.", photoKetua: "assets/paslon-02-ketua.webp", photoWakil: "assets/paslon-02-wakil.webp" }
  ];

  function freshData() {
    return {
      config: {
        title: "Pemilihan Ketua & Wakil Ketua DPT",
        institution: "Politeknik Agraria STPN",
        period: "2026–2027",
        tagline: "SATU SUARA, SATU PILIHAN, UNTUK MASA DEPAN DPT",
        status: "open",
        candidates: JSON.parse(JSON.stringify(DEFAULT_CANDIDATES))
      },
      users: SEED_USERS.map(function (u) { return Object.assign({}, u, { hasVoted: false, isSeed: true }); }),
      votes: { "01": 0, "02": 0 },
      adminHash: ADMIN_HASH,
      activity: []
    };
  }

  function getDB() {
    let d;
    try { d = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { d = null; }
    if (!d) {
      d = freshData();
      localStorage.setItem(STORE, JSON.stringify(d));
    }
    if (!d.config) d.config = freshData().config;
    if (!Array.isArray(d.config.candidates) || d.config.candidates.length !== 2) d.config.candidates = JSON.parse(JSON.stringify(DEFAULT_CANDIDATES));
    if (!Array.isArray(d.users)) d.users = [];
    if (!d.votes) d.votes = { "01": 0, "02": 0 };
    if (typeof d.votes["01"] !== "number") d.votes["01"] = 0;
    if (typeof d.votes["02"] !== "number") d.votes["02"] = 0;
    if (!d.adminHash) d.adminHash = ADMIN_HASH;
    if (!Array.isArray(d.activity)) d.activity = [];
    localStorage.setItem(STORE, JSON.stringify(d));
    return d;
  }

  function saveDB(d) {
    try {
      localStorage.setItem(STORE, JSON.stringify(d));
      return true;
    } catch (e) {
      alert("Penyimpanan browser penuh. Kurangi ukuran foto atau ekspor cadangan terlebih dahulu.");
      return false;
    }
  }

  async function hash(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function lines(value) {
    return esc(value).replace(/\r?\n/g, "<br>");
  }

  function dateTime(value) {
    try { return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return value || "-"; }
  }

  function logActivity(action, detail) {
    const d = getDB();
    d.activity.unshift({ action: action, detail: detail || "", at: new Date().toISOString() });
    d.activity = d.activity.slice(0, 100);
    saveDB(d);
  }

  function toast(target, message, type) {
    const el = document.getElementById(target);
    if (!el) return;
    el.innerHTML = '<div class="toast ' + (type || "info") + '">' + esc(message) + '</div>';
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }

  function initVoterPage() {
    getDB();
    const form = document.getElementById("loginForm");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const username = document.getElementById("voterUsername").value.trim().toLowerCase();
      const password = document.getElementById("voterPassword").value;
      const d = getDB();
      const user = d.users.find(function (u) { return u.username.toLowerCase() === username; });
      if (!user || user.passwordHash !== await hash(password)) {
        toast("loginFeedback", "Username atau password tidak sesuai.", "error");
        return;
      }
      sessionStorage.setItem(USER_SESSION, user.username);
      document.getElementById("voterPassword").value = "";
      renderVoter();
    });
    renderVoter();
  }

  function renderVoter() {
    const d = getDB();
    const username = sessionStorage.getItem(USER_SESSION);
    const user = d.users.find(function (u) { return u.username === username; });
    const loginView = document.getElementById("loginView");
    const ballotView = document.getElementById("ballotView");
    if (!user) {
      sessionStorage.removeItem(USER_SESSION);
      loginView.classList.remove("hidden");
      ballotView.classList.add("hidden");
      return;
    }
    loginView.classList.add("hidden");
    ballotView.classList.remove("hidden");
    document.getElementById("welcomeName").textContent = user.name;
    document.getElementById("welcomeUsername").textContent = "Akun pemilih: " + user.username;
    document.getElementById("electionHeading").textContent = d.config.title;
    document.getElementById("electionSubheading").textContent = d.config.institution + " • Periode " + d.config.period;
    const state = document.getElementById("voterState");
    if (d.config.status !== "open") {
      state.className = "state-banner closed";
      state.textContent = d.config.status === "closed" ? "Pemungutan suara sedang ditutup oleh panitia." : "Pemungutan suara belum dibuka.";
    } else if (user.hasVoted) {
      state.className = "state-banner done";
      state.textContent = "Terima kasih. Hak suara akun ini telah digunakan pada browser ini.";
    } else {
      state.className = "state-banner open";
      state.textContent = "Pemungutan suara dibuka. Silakan baca profil pasangan calon sebelum menentukan pilihan.";
    }
    const grid = document.getElementById("candidateGrid");
    grid.innerHTML = d.config.candidates.map(function (c) {
      const disabled = user.hasVoted || d.config.status !== "open";
      return '<article class="candidate-card">' +
        '<div class="candidate-top"><span class="candidate-number">' + esc(c.id) + '</span><span class="candidate-label">PASANGAN CALON</span></div>' +
        '<div class="people-grid">' +
          '<div class="person-card"><img src="' + esc(c.photoKetua) + '" alt="Foto Ketua Paslon ' + esc(c.id) + '" onerror="this.src=\'assets/logo-dpt.webp\'"><div class="person-caption"><small>CALON KETUA</small><strong>' + esc(c.ketua) + '</strong></div></div>' +
          '<div class="person-card"><img src="' + esc(c.photoWakil) + '" alt="Foto Wakil Paslon ' + esc(c.id) + '" onerror="this.src=\'assets/logo-dpt.webp\'"><div class="person-caption"><small>CALON WAKIL KETUA</small><strong>' + esc(c.wakil) + '</strong></div></div>' +
        '</div>' +
        '<div class="candidate-copy"><div><span class="eyebrow">VISI</span><p>' + lines(c.visi) + '</p></div><div><span class="eyebrow">MISI</span><p>' + lines(c.misi) + '</p></div><blockquote>' + esc(c.slogan) + '</blockquote></div>' +
        '<button class="btn btn-gold btn-vote" ' + (disabled ? "disabled" : "") + ' onclick="window.Evoting.vote(\'' + esc(c.id) + '\')">' + (user.hasVoted ? "SUARA TELAH DIGUNAKAN" : (d.config.status === "open" ? "PILIH PASLON " + esc(c.id) : "PEMILIHAN DITUTUP")) + '</button>' +
        '</article>';
    }).join("");
  }

  async function castVote(id) {
    const d = getDB();
    const username = sessionStorage.getItem(USER_SESSION);
    const user = d.users.find(function (u) { return u.username === username; });
    if (!user || user.hasVoted || d.config.status !== "open") return;
    const c = d.config.candidates.find(function (x) { return x.id === id; });
    if (!c) return;
    if (!confirm("Anda akan memilih Paslon " + id + ". Pilihan yang dikirim tidak dapat diubah. Lanjutkan?")) return;
    user.hasVoted = true;
    user.votedAt = new Date().toISOString();
    d.votes[id] = (d.votes[id] || 0) + 1;
    d.activity.unshift({ action: "Suara masuk", detail: "Satu suara tercatat (pilihan tetap dirahasiakan).", at: new Date().toISOString() });
    d.activity = d.activity.slice(0, 100);
    if (saveDB(d)) {
      renderVoter();
      toast("voterFeedback", "Terima kasih, " + user.name + ". Suara latihan Anda berhasil direkam.", "success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function voterLogout() {
    sessionStorage.removeItem(USER_SESSION);
    renderVoter();
  }

  function initAdminPage() {
    getDB();
    const form = document.getElementById("adminLoginForm");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const d = getDB();
      const password = document.getElementById("adminPassword").value;
      if (await hash(password) !== d.adminHash) {
        toast("adminLoginFeedback", "Password admin salah.", "error");
        return;
      }
      sessionStorage.setItem(ADMIN_SESSION, "1");
      document.getElementById("adminPassword").value = "";
      renderAdminShell();
      logActivity("Admin masuk", "Sesi admin dibuka.");
    });
    document.querySelectorAll("[data-tab]").forEach(function (button) {
      button.addEventListener("click", function () { showAdminTab(button.dataset.tab); });
    });
    if (sessionStorage.getItem(ADMIN_SESSION) === "1") renderAdminShell();
  }

  function renderAdminShell() {
    document.getElementById("adminLoginView").classList.add("hidden");
    document.getElementById("adminShell").classList.remove("hidden");
    const d = getDB();
    document.getElementById("adminElectionName").textContent = d.config.title;
    showAdminTab("overview");
  }

  function adminLogout() {
    sessionStorage.removeItem(ADMIN_SESSION);
    location.reload();
  }

  function showAdminTab(tab) {
    document.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); });
    const content = document.getElementById("adminContent");
    if (tab === "overview") content.innerHTML = overviewHTML();
    else if (tab === "candidates") content.innerHTML = candidatesHTML();
    else if (tab === "voters") content.innerHTML = votersHTML();
    else if (tab === "results") content.innerHTML = resultsHTML();
    else if (tab === "settings") content.innerHTML = settingsHTML();
    else if (tab === "activity") content.innerHTML = activityHTML();
  }

  function overviewHTML() {
    const d = getDB();
    const total = d.users.length;
    const voted = d.users.filter(function (u) { return u.hasVoted; }).length;
    const remaining = total - voted;
    const percent = total ? Math.round(voted / total * 100) : 0;
    const totalVotes = (d.votes["01"] || 0) + (d.votes["02"] || 0);
    const status = d.config.status === "open" ? "DIBUKA" : (d.config.status === "closed" ? "DITUTUP" : "BELUM DIMULAI");
    return '<div class="page-heading"><div><span class="eyebrow">RINGKASAN PEMILIHAN</span><h1>Dashboard overview</h1><p>Pantau partisipasi dan rekapitulasi suara.</p></div><span class="status-chip ' + d.config.status + '">' + status + '</span></div>' +
      '<div class="stats-grid">' +
      statCard("TOTAL PEMILIH", total, "Akun terdaftar", "users") +
      statCard("SUDAH MEMILIH", voted, "Hak suara digunakan", "check-circle") +
      statCard("BELUM MEMILIH", remaining, "Menunggu partisipasi", "clock") +
      statCard("PARTISIPASI", percent + "%", "Persentase keikutsertaan", "activity") +
      '</div>' +
      '<div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><span class="eyebrow">TINGKAT PARTISIPASI</span><h2>Progress pemilih</h2></div><strong class="big-percent">' + percent + '%</strong></div><div class="progress-track"><div class="progress-fill" style="width:' + percent + '%"></div></div><div class="progress-meta"><span>' + voted + ' sudah memilih</span><span>' + remaining + ' belum memilih</span></div><div class="mini-note">Total suara yang tercatat: <b>' + totalVotes + '</b></div></section>' +
      '<section class="panel"><div class="panel-head"><div><span class="eyebrow">STATUS SISTEM</span><h2>Kontrol pemilihan</h2></div><span class="live-dot"></span></div><p class="muted">Status saat ini: <b>' + status + '</b></p><button class="btn btn-gold" onclick="window.Evoting.quickToggleStatus()">' + (d.config.status === "open" ? "TUTUP PEMILIHAN" : "BUKA PEMILIHAN") + '</button><p class="tiny muted">Kontrol ini hanya berlaku pada penyimpanan browser admin.</p></section></div>' +
      '<section class="panel"><div class="panel-head"><div><span class="eyebrow">REKAPITULASI</span><h2>Perolehan suara</h2></div><button class="btn btn-outline btn-small" onclick="window.Evoting.goTab(\'results\')">Lihat detail</button></div>' + resultBars(d) + '</section>' +
      '<div class="notice-box"><b>Catatan GitHub Pages:</b> ini adalah versi antarmuka/demo. Data tersimpan di browser masing-masing dan tidak tersinkron antarperangkat. Jangan gunakan sebagai pemilihan resmi lintas perangkat.</div>';
  }

  function statCard(label, value, sub, icon) {
    return '<div class="stat-card"><div class="stat-icon">' + iconSvg(icon) + '</div><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div><div class="stat-sub">' + sub + '</div></div>';
  }

  function iconSvg(type) {
    const paths = {
      users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6"/><path d="M16 5a3 3 0 0 1 0 6M17 14c3 .4 4 2.3 4 5"/>',
      "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      activity: '<path d="M3 12h4l2-6 4 12 2-6h6"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (paths[type] || paths.activity) + '</g></svg>';
  }

  function resultBars(d) {
    const total = (d.votes["01"] || 0) + (d.votes["02"] || 0);
    return d.config.candidates.map(function (c) {
      const count = d.votes[c.id] || 0;
      const pct = total ? Math.round(count / total * 100) : 0;
      return '<div class="result-row"><div class="result-label"><b>Paslon ' + c.id + '</b><span>' + esc(c.ketua) + ' & ' + esc(c.wakil) + '</span><strong>' + count + ' suara · ' + pct + '%</strong></div><div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>';
    }).join("");
  }

  function candidatesHTML() {
    const d = getDB();
    return '<div class="page-heading"><div><span class="eyebrow">MANAJEMEN KANDIDAT</span><h1>Profil pasangan calon</h1><p>Ubah nama, foto, visi, misi, dan slogan melalui panel ini.</p></div></div>' +
      '<div class="candidate-edit-grid">' + d.config.candidates.map(function (c, i) {
        return '<section class="panel candidate-editor"><div class="panel-head"><div><span class="eyebrow">PASANGAN CALON</span><h2>Nomor ' + c.id + '</h2></div><span class="candidate-number small-number">' + c.id + '</span></div>' +
          '<div class="edit-photos"><label><img id="editKetuaImg' + i + '" src="' + esc(c.photoKetua) + '" onerror="this.src=\'assets/logo-dpt.webp\'"><span>Foto Ketua</span><input type="file" accept="image/*" onchange="window.Evoting.uploadPhoto(this,' + i + ',\'photoKetua\',\'editKetuaImg' + i + '\')"></label>' +
          '<label><img id="editWakilImg' + i + '" src="' + esc(c.photoWakil) + '" onerror="this.src=\'assets/logo-dpt.webp\'"><span>Foto Wakil</span><input type="file" accept="image/*" onchange="window.Evoting.uploadPhoto(this,' + i + ',\'photoWakil\',\'editWakilImg' + i + '\')"></label></div>' +
          '<div class="form-grid"><label>Nama Ketua<input id="cKetua' + i + '" value="' + esc(c.ketua) + '"></label><label>Nama Wakil Ketua<input id="cWakil' + i + '" value="' + esc(c.wakil) + '"></label><label class="full">Visi<textarea id="cVisi' + i + '" rows="3">' + esc(c.visi) + '</textarea></label><label class="full">Misi<textarea id="cMisi' + i + '" rows="5">' + esc(c.misi) + '</textarea></label><label class="full">Slogan<input id="cSlogan' + i + '" value="' + esc(c.slogan) + '"></label></div>' +
          '<button class="btn btn-gold" onclick="window.Evoting.saveCandidate(' + i + ')">SIMPAN PASLON ' + c.id + '</button></section>';
      }).join("") + '</div><div class="notice-box">Foto yang diunggah disimpan di browser admin. Pada GitHub Pages, perubahan ini tidak otomatis tampil pada perangkat pemilih lain.</div>';
  }

  function votersHTML() {
    const d = getDB();
    const rows = d.users.map(function (u, i) {
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(u.name) + '</b></td><td><code>' + esc(u.username) + '</code></td><td><span class="table-status ' + (u.hasVoted ? "done" : "pending") + '">' + (u.hasVoted ? "SUDAH MEMILIH" : "BELUM MEMILIH") + '</span></td><td><button class="btn btn-outline btn-small" onclick="window.Evoting.resetVoterPassword(\'' + esc(u.username) + '\')">Reset password</button> ' + (u.hasVoted ? '<span class="tiny muted">Terkunci</span>' : '<button class="btn btn-danger btn-small" onclick="window.Evoting.deleteVoter(\'' + esc(u.username) + '\')">Hapus</button>') + '</td></tr>';
    }).join("");
    return '<div class="page-heading"><div><span class="eyebrow">DAFTAR PEMILIH</span><h1>Manajemen akun</h1><p>Tambah, cari, reset password, dan hapus akun yang belum menggunakan hak pilih.</p></div><button class="btn btn-outline btn-small" onclick="window.Evoting.exportVoters()">Ekspor CSV</button></div>' +
      '<div class="panel"><h2>Tambah pemilih</h2><div class="form-grid"><label>Nama lengkap<input id="newVoterName" placeholder="Nama pemilih"></label><label>Username<input id="newVoterUsername" placeholder="Username unik"></label><label>Password sementara<input id="newVoterPassword" placeholder="Minimal 8 karakter"></label><div class="form-action"><button class="btn btn-gold" onclick="window.Evoting.addVoter()">TAMBAH PEMILIH</button></div></div></div>' +
      '<div class="panel"><h2>Import banyak pemilih</h2><p class="muted tiny">Format per baris: Nama Lengkap | username | password</p><textarea id="bulkVoters" rows="4" placeholder="Nama Pemilih | username | password"></textarea><button class="btn btn-outline" onclick="window.Evoting.bulkAddVoters()">IMPORT DAFTAR</button></div>' +
      '<div class="panel"><div class="panel-head"><h2>Seluruh pemilih (' + d.users.length + ')</h2><input class="search-input" id="voterSearch" placeholder="Cari nama atau username..." oninput="window.Evoting.filterVoters()"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>No.</th><th>Nama</th><th>Username</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="voterRows">' + rows + '</tbody></table></div></div>';
  }

  function resultsHTML() {
    const d = getDB();
    const total = (d.votes["01"] || 0) + (d.votes["02"] || 0);
    return '<div class="page-heading"><div><span class="eyebrow">REKAPITULASI SUARA</span><h1>Hasil pemilihan</h1><p>Rekap agregat. Sistem tidak menyimpan hubungan antara identitas pemilih dan pilihan paslon.</p></div><button class="btn btn-outline btn-small" onclick="window.Evoting.exportResults()">Ekspor hasil CSV</button></div>' +
      '<div class="stats-grid compact"><div class="stat-card"><div class="stat-label">TOTAL SUARA</div><div class="stat-value">' + total + '</div></div><div class="stat-card"><div class="stat-label">TOTAL PEMILIH</div><div class="stat-value">' + d.users.length + '</div></div></div>' +
      '<section class="panel"><h2>Perolehan per pasangan calon</h2>' + resultBars(d) + '</section><div class="notice-box">Catatan: angka di sini hanya berasal dari browser tempat admin membuka halaman ini. Tidak ada sinkronisasi suara antarperangkat pada GitHub Pages.</div>';
  }

  function settingsHTML() {
    const d = getDB();
    return '<div class="page-heading"><div><span class="eyebrow">KONFIGURASI</span><h1>Pengaturan pemilihan</h1><p>Atur identitas acara dan status pemungutan suara.</p></div></div>' +
      '<section class="panel"><h2>Informasi pemilihan</h2><div class="form-grid"><label class="full">Judul pemilihan<input id="setTitle" value="' + esc(d.config.title) + '"></label><label>Institusi<input id="setInstitution" value="' + esc(d.config.institution) + '"></label><label>Periode<input id="setPeriod" value="' + esc(d.config.period) + '"></label><label class="full">Tagline<input id="setTagline" value="' + esc(d.config.tagline) + '"></label><label>Status pemilihan<select id="setStatus"><option value="not-started" ' + (d.config.status === "not-started" ? "selected" : "") + '>Belum dimulai</option><option value="open" ' + (d.config.status === "open" ? "selected" : "") + '>Dibuka</option><option value="closed" ' + (d.config.status === "closed" ? "selected" : "") + '>Ditutup</option></select></label></div><button class="btn btn-gold" onclick="window.Evoting.saveSettings()">SIMPAN PENGATURAN</button></section>' +
      '<section class="panel"><h2>Keamanan admin</h2><div class="form-grid"><label>Password lama<input type="password" id="oldAdminPassword"></label><label>Password baru<input type="password" id="newAdminPassword"></label></div><button class="btn btn-outline" onclick="window.Evoting.changeAdminPassword()">GANTI PASSWORD ADMIN</button></section>' +
      '<section class="panel"><h2>Cadangan data</h2><p class="muted">Ekspor backup untuk menyimpan konfigurasi, akun, dan rekap pada browser ini. Simpan file dengan aman.</p><div class="button-row"><button class="btn btn-outline" onclick="window.Evoting.exportBackup()">DOWNLOAD BACKUP JSON</button><label class="btn btn-outline file-button">IMPORT BACKUP JSON<input type="file" accept="application/json" onchange="window.Evoting.importBackup(this)"></label><button class="btn btn-danger" onclick="window.Evoting.resetTraining()">RESET DATA LATIHAN</button></div></section>';
  }

  function activityHTML() {
    const d = getDB();
    const rows = d.activity.map(function (x) {
      return '<tr><td>' + dateTime(x.at) + '</td><td><b>' + esc(x.action) + '</b></td><td>' + esc(x.detail) + '</td></tr>';
    }).join("");
    return '<div class="page-heading"><div><span class="eyebrow">CATATAN SISTEM</span><h1>Aktivitas admin</h1><p>Riwayat perubahan dan aktivitas umum pada browser ini.</p></div></div><section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Waktu</th><th>Aktivitas</th><th>Detail</th></tr></thead><tbody>' + (rows || '<tr><td colspan="3">Belum ada aktivitas.</td></tr>') + '</tbody></table></div></section>';
  }

  function saveCandidate(index) {
    const d = getDB(), c = d.config.candidates[index];
    c.ketua = document.getElementById("cKetua" + index).value.trim();
    c.wakil = document.getElementById("cWakil" + index).value.trim();
    c.visi = document.getElementById("cVisi" + index).value.trim();
    c.misi = document.getElementById("cMisi" + index).value.trim();
    c.slogan = document.getElementById("cSlogan" + index).value.trim();
    saveDB(d); logActivity("Profil paslon diperbarui", "Paslon " + c.id + " diperbarui."); showAdminTab("candidates");
    toast("adminFeedback", "Profil Paslon " + c.id + " berhasil disimpan pada browser ini.", "success");
  }

  function uploadPhoto(input, index, key, imageId) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Pilih file gambar."); return; }
    if (file.size > 2500000) { alert("Ukuran foto maksimal 2,5 MB."); return; }
    const reader = new FileReader();
    reader.onload = function () {
      const d = getDB(); d.config.candidates[index][key] = reader.result;
      if (saveDB(d)) {
        const img = document.getElementById(imageId);
        if (img) img.src = reader.result;
        toast("adminFeedback", "Foto berhasil diperbarui pada browser ini.", "success");
      }
    };
    reader.readAsDataURL(file);
  }

  async function addVoter() {
    const d = getDB();
    const name = document.getElementById("newVoterName").value.trim();
    const username = document.getElementById("newVoterUsername").value.trim().toLowerCase();
    const password = document.getElementById("newVoterPassword").value;
    if (!name || !username || password.length < 8) { alert("Lengkapi nama, username, dan password minimal 8 karakter."); return; }
    if (d.users.some(function (u) { return u.username.toLowerCase() === username; })) { alert("Username sudah digunakan."); return; }
    d.users.push({ name: name, username: username, passwordHash: await hash(password), hasVoted: false, isSeed: false });
    saveDB(d); logActivity("Pemilih ditambahkan", name + " (" + username + ").");
    showAdminTab("voters");
    alert("Akun pemilih ditambahkan. Catat password sementara dan berikan langsung kepada pemilih.");
  }

  async function bulkAddVoters() {
    const d = getDB();
    const text = document.getElementById("bulkVoters").value.trim();
    if (!text) return;
    const rows = text.split(/\r?\n/);
    let added = 0;
    for (const row of rows) {
      const parts = row.split("|").map(function (x) { return x.trim(); });
      if (parts.length < 3 || !parts[0] || !parts[1] || parts[2].length < 8) continue;
      const username = parts[1].toLowerCase();
      if (d.users.some(function (u) { return u.username.toLowerCase() === username; })) continue;
      d.users.push({ name: parts[0], username: username, passwordHash: await hash(parts[2]), hasVoted: false, isSeed: false });
      added++;
    }
    saveDB(d); logActivity("Import pemilih", added + " akun ditambahkan."); showAdminTab("voters");
    alert(added + " akun berhasil ditambahkan. Bagikan password sementara secara pribadi.");
  }

  function deleteVoter(username) {
    const d = getDB(), user = d.users.find(function (u) { return u.username === username; });
    if (!user) return;
    if (user.hasVoted) { alert("Akun yang sudah memilih tidak dapat dihapus karena rekap suara disimpan secara anonim."); return; }
    if (!confirm("Hapus akun " + user.name + "?")) return;
    d.users = d.users.filter(function (u) { return u.username !== username; });
    saveDB(d); logActivity("Pemilih dihapus", user.name + " (" + username + ")."); showAdminTab("voters");
  }

  async function resetVoterPassword(username) {
    const d = getDB(), user = d.users.find(function (u) { return u.username === username; });
    if (!user) return;
    const password = prompt("Masukkan password sementara baru untuk " + user.name + " (minimal 8 karakter):");
    if (password === null) return;
    if (password.length < 8) { alert("Password minimal 8 karakter."); return; }
    user.passwordHash = await hash(password);
    saveDB(d); logActivity("Password pemilih direset", user.username + ".");
    alert("Password baru disimpan. Berikan password tersebut langsung kepada pemilih.");
  }

  function filterVoters() {
    const q = (document.getElementById("voterSearch").value || "").toLowerCase();
    document.querySelectorAll("#voterRows tr").forEach(function (row) {
      row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  }

  function saveSettings() {
    const d = getDB();
    d.config.title = document.getElementById("setTitle").value.trim();
    d.config.institution = document.getElementById("setInstitution").value.trim();
    d.config.period = document.getElementById("setPeriod").value.trim();
    d.config.tagline = document.getElementById("setTagline").value.trim();
    d.config.status = document.getElementById("setStatus").value;
    saveDB(d); logActivity("Pengaturan pemilihan diperbarui", "Informasi dan status pemilihan diubah."); renderAdminShell();
  }

  function quickToggleStatus() {
    const d = getDB();
    d.config.status = d.config.status === "open" ? "closed" : "open";
    saveDB(d); logActivity("Status pemilihan diubah", "Status: " + d.config.status); showAdminTab("overview");
  }

  async function changeAdminPassword() {
    const d = getDB();
    const oldPass = document.getElementById("oldAdminPassword").value;
    const newPass = document.getElementById("newAdminPassword").value;
    if (await hash(oldPass) !== d.adminHash) { alert("Password lama tidak sesuai."); return; }
    if (newPass.length < 12) { alert("Gunakan password baru minimal 12 karakter."); return; }
    d.adminHash = await hash(newPass);
    saveDB(d); logActivity("Password admin diubah", "Password admin diperbarui.");
    alert("Password admin berhasil diubah pada browser ini.");
    showAdminTab("settings");
  }

  function resetTraining() {
    if (!confirm("Reset latihan? Semua status pemilih kembali BELUM MEMILIH dan rekap suara menjadi 0. Tindakan ini tidak dapat dibatalkan.")) return;
    const d = getDB();
    d.votes = { "01": 0, "02": 0 };
    d.users.forEach(function (u) { u.hasVoted = false; delete u.votedAt; });
    d.activity.unshift({ action: "Reset data latihan", detail: "Semua status dan rekap latihan dikosongkan.", at: new Date().toISOString() });
    saveDB(d); sessionStorage.removeItem(USER_SESSION); showAdminTab("overview");
  }

  function exportVoters() {
    const d = getDB();
    const rows = [["Nama", "Username", "Status"]];
    d.users.forEach(function (u) { rows.push([u.name, u.username, u.hasVoted ? "Sudah memilih" : "Belum memilih"]); });
    downloadFile("EvotingDPT_Daftar_Pemilih.csv", rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n"), "text/csv;charset=utf-8");
  }

  function exportResults() {
    const d = getDB();
    const rows = [["Paslon", "Ketua", "Wakil", "Suara"], d.config.candidates[0], d.config.candidates[1]];
    const csv = [["Paslon", "Ketua", "Wakil", "Suara"].map(csvCell).join(","),
      [ "01", d.config.candidates[0].ketua, d.config.candidates[0].wakil, d.votes["01"] || 0].map(csvCell).join(","),
      [ "02", d.config.candidates[1].ketua, d.config.candidates[1].wakil, d.votes["02"] || 0].map(csvCell).join(",")].join("\n");
    downloadFile("EvotingDPT_Hasil_Simulasi.csv", csv, "text/csv;charset=utf-8");
  }

  function exportBackup() {
    downloadFile("EvotingDPT_Backup.json", JSON.stringify(getDB(), null, 2), "application/json");
  }

  function importBackup(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        if (!data.config || !Array.isArray(data.users) || !data.votes) throw new Error("Format backup tidak sesuai.");
        if (!confirm("Ganti seluruh data browser ini dengan data dari backup?")) return;
        localStorage.setItem(STORE, JSON.stringify(data));
        logActivity("Backup diimpor", "Data dipulihkan dari file JSON.");
        renderAdminShell();
      } catch (e) { alert("File backup tidak valid."); }
    };
    reader.readAsText(file);
  }

  function goTab(tab) { showAdminTab(tab); }

  window.Evoting = {
    vote: castVote,
    voterLogout: voterLogout,
    adminLogout: adminLogout,
    goTab: goTab,
    saveCandidate: saveCandidate,
    uploadPhoto: uploadPhoto,
    addVoter: addVoter,
    bulkAddVoters: bulkAddVoters,
    deleteVoter: deleteVoter,
    resetVoterPassword: resetVoterPassword,
    filterVoters: filterVoters,
    saveSettings: saveSettings,
    quickToggleStatus: quickToggleStatus,
    changeAdminPassword: changeAdminPassword,
    resetTraining: resetTraining,
    exportVoters: exportVoters,
    exportResults: exportResults,
    exportBackup: exportBackup,
    importBackup: importBackup
  };

  document.addEventListener("DOMContentLoaded", function () {
    if (document.body.dataset.page === "vote") initVoterPage();
    if (document.body.dataset.page === "admin") initAdminPage();
  });
})();
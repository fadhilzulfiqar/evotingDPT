(function () {
  'use strict';
  var API = '/api';
  var stats = null;
  var draftConfig = null;
  var currentTab = 'overview';
  var $ = function (selector) { return document.querySelector(selector); };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  async function api(path, options) {
    var opt = Object.assign({ method: 'GET', credentials: 'same-origin', headers: {} }, options || {});
    opt.headers = Object.assign({ 'Content-Type': 'application/json' }, opt.headers || {});
    var response = await fetch(API + path, opt);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Permintaan tidak dapat diproses.');
    return data;
  }

  function message(target, text, type) {
    var el = document.getElementById(target);
    if (!el) return;
    el.innerHTML = text ? '<div class="toast ' + (type || 'error') + '">' + esc(text) + '</div>' : '';
  }

  function heading(kicker, title, description) {
    return '<div class="page-heading"><div><span class="eyebrow">' + esc(kicker) + '</span><h1>' + esc(title) + '</h1><p>' + esc(description) + '</p></div></div>';
  }

  function statCard(label, value, sub, symbol) {
    return '<div class="stat-card"><div class="stat-icon">' + symbol + '</div><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + esc(value) + '</div><div class="stat-sub">' + esc(sub) + '</div></div>';
  }

  function statusLabel(status) {
    return status === 'open' ? 'PEMILIHAN DIBUKA' : status === 'closed' ? 'PEMILIHAN DITUTUP' : 'BELUM DIMULAI';
  }

  function renderOverview() {
    var total = Number(stats.total || 0);
    var voted = Number(stats.voted || 0);
    var remaining = Number(stats.remaining || 0);
    var participation = Number(stats.participation || 0);
    var status = stats.config.status || 'scheduled';
    var html = heading('PUSAT KENDALI', 'Ringkasan pemilihan', 'Pantau partisipasi pemilih dan kondisi pemungutan suara secara terpusat.');
    html += '<div class="page-heading"><span class="status-chip ' + (status === 'open' ? 'open' : status === 'closed' ? 'closed' : '') + '">' + statusLabel(status) + '</span></div>';
    html += '<div class="stats-grid">';
    html += statCard('TOTAL PEMILIH', total, 'Akun terdaftar', '◎');
    html += statCard('SUDAH MEMILIH', voted, 'Hak suara tercatat', '✓');
    html += statCard('BELUM MEMILIH', remaining, 'Belum menggunakan hak suara', '◷');
    html += statCard('PARTISIPASI', participation + '%', 'Tingkat partisipasi', '↗');
    html += '</div>';
    html += '<div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><span class="eyebrow">PARTISIPASI</span><h2>Progres pemungutan suara</h2></div><div class="big-percent">' + participation + '%</div></div>';
    html += '<div class="progress-track"><div class="progress-fill" style="width:' + Math.max(0, Math.min(100, participation)) + '%"></div></div>';
    html += '<div class="progress-meta"><span>' + voted + ' sudah memilih</span><span>' + remaining + ' belum memilih</span></div>';
    html += '<p class="mini-note">Data diperbarui langsung dari penyimpanan pusat Netlify Blobs.</p></section>';
    html += '<section class="panel"><span class="eyebrow">KONFIGURASI</span><h2>Informasi pemilihan</h2>';
    html += '<p class="muted"><b>' + esc(stats.config.title) + '</b></p><p class="tiny muted">' + esc(stats.config.institution) + ' · ' + esc(stats.config.period) + '</p>';
    html += '<div class="notice-box">Jumlah pasangan calon: <b>' + (stats.config.candidates || []).length + '</b><br>Status: <b>' + statusLabel(status) + '</b></div>';
    html += '<button class="btn btn-outline btn-small" type="button" onclick="window.EvotingAdmin.openTab(\'candidates\')">Kelola pasangan calon →</button></section></div>';
    $('#adminContent').innerHTML = html;
  }

  function fallbackPhoto(id, role) {
    var n = String(id) === '02' ? '2' : '1';
    return '/assets/paslon' + n + '-' + role + '.jpg';
  }

  function candidateEditor(candidate, index) {
    var ketuaPhoto = candidate.photoKetua || fallbackPhoto(candidate.id, 'ketua');
    var wakilPhoto = candidate.photoWakil || fallbackPhoto(candidate.id, 'wakil');
    var html = '<section class="panel candidate-editor"><div class="panel-head"><div><span class="eyebrow">PASANGAN CALON ' + esc(candidate.id) + '</span><h2>Data kandidat</h2></div><span class="candidate-number small-number">' + esc(candidate.id) + '</span></div>';
    html += '<div class="edit-photos"><div><label>Foto Ketua</label><img id="photoPreviewKetua' + index + '" src="' + esc(ketuaPhoto) + '" alt="Foto ketua paslon ' + esc(candidate.id) + '"><label class="file-button btn btn-outline btn-small">Pilih foto ketua<input type="file" accept="image/*" onchange="window.EvotingAdmin.pickPhoto(this,' + index + ',\'ketua\')"></label></div>';
    html += '<div><label>Foto Wakil</label><img id="photoPreviewWakil' + index + '" src="' + esc(wakilPhoto) + '" alt="Foto wakil paslon ' + esc(candidate.id) + '"><label class="file-button btn btn-outline btn-small">Pilih foto wakil<input type="file" accept="image/*" onchange="window.EvotingAdmin.pickPhoto(this,' + index + ',\'wakil\')"></label></div></div>';
    html += '<div class="form-grid">';
    html += '<label>Nama Ketua<input id="candidate' + index + 'Ketua" value="' + esc(candidate.ketua) + '" maxlength="120"></label>';
    html += '<label>Nama Wakil Ketua<input id="candidate' + index + 'Wakil" value="' + esc(candidate.wakil) + '" maxlength="120"></label>';
    html += '<label class="full">Visi<textarea id="candidate' + index + 'Visi" rows="3" maxlength="1500">' + esc(candidate.visi) + '</textarea></label>';
    html += '<label class="full">Misi<textarea id="candidate' + index + 'Misi" rows="5" maxlength="2500">' + esc(candidate.misi) + '</textarea></label>';
    html += '<label class="full">Slogan<input id="candidate' + index + 'Slogan" value="' + esc(candidate.slogan) + '" maxlength="300"></label>';
    html += '</div></section>';
    return html;
  }

  function renderCandidates() {
    draftConfig = JSON.parse(JSON.stringify(stats.config));
    var html = heading('PENGELOLAAN KANDIDAT', 'Pasangan calon', 'Perbarui identitas pemilihan, foto, visi, misi, dan slogan kedua pasangan calon.');
    html += '<section class="panel"><div class="panel-head"><div><span class="eyebrow">INFORMASI PEMILIHAN</span><h2>Identitas pemilihan</h2></div></div><div class="form-grid">';
    html += '<label class="full">Judul pemilihan<input id="cfgTitle" value="' + esc(draftConfig.title) + '" maxlength="160"></label>';
    html += '<label>Institusi<input id="cfgInstitution" value="' + esc(draftConfig.institution) + '" maxlength="160"></label>';
    html += '<label>Periode<input id="cfgPeriod" value="' + esc(draftConfig.period) + '" maxlength="80"></label>';
    html += '<label class="full">Tagline<input id="cfgTagline" value="' + esc(draftConfig.tagline) + '" maxlength="220"></label>';
    html += '<label>Status pemilihan<select id="cfgStatus"><option value="scheduled">Belum dimulai</option><option value="open">Dibuka</option><option value="closed">Ditutup</option></select></label>';
    html += '</div><div class="form-action" style="margin-top:16px"><button class="btn btn-gold" type="button" onclick="window.EvotingAdmin.saveConfig()">Simpan seluruh perubahan</button></div></section>';
    html += '<div class="candidate-edit-grid">';
    (draftConfig.candidates || []).forEach(function (candidate, index) { html += candidateEditor(candidate, index); });
    html += '</div><div class="form-action"><button class="btn btn-gold" type="button" onclick="window.EvotingAdmin.saveConfig()">Simpan seluruh perubahan</button></div>';
    $('#adminContent').innerHTML = html;
    $('#cfgStatus').value = draftConfig.status || 'scheduled';
  }

  function renderVoterRows() {
    if (!stats) return;
    var search = ($('#voterSearch') ? $('#voterSearch').value : '').trim().toLowerCase();
    var rows = (stats.users || []).filter(function (user) {
      return (String(user.name) + ' ' + String(user.username)).toLowerCase().indexOf(search) >= 0;
    });
    var html = '';
    rows.forEach(function (user, index) {
      html += '<tr><td>' + (index + 1) + '</td><td>' + esc(user.name) + '</td><td><code>' + esc(user.username) + '</code></td>';
      html += '<td><span class="table-status ' + (user.hasVoted ? 'done' : 'pending') + '">' + (user.hasVoted ? 'SUDAH MEMILIH' : 'BELUM MEMILIH') + '</span></td>';
      html += '<td>' + (user.votedAt ? esc(new Date(user.votedAt).toLocaleString('id-ID')) : '-') + '</td>';
      html += '<td>' + (user.hasVoted ? '<span class="tiny muted">Terkunci</span>' : '<button class="btn btn-danger btn-small" type="button" onclick="window.EvotingAdmin.deleteVoter(\'' + esc(user.id) + '\')">Hapus</button>') + '</td></tr>';
    });
    $('#voterRows').innerHTML = html || '<tr><td colspan="6" class="empty-state">Belum ada data pemilih yang sesuai.</td></tr>';
  }

  function renderVoters() {
    var html = heading('MANAJEMEN AKUN', 'Data pemilih', 'Tambah akun satu per satu atau impor daftar pemilih secara massal.');
    html += '<div class="dashboard-grid"><section class="panel"><span class="eyebrow">TAMBAH AKUN</span><h2>Tambah satu pemilih</h2>';
    html += '<div class="form-grid"><label class="full">Nama lengkap<input id="newName" placeholder="Nama pemilih"></label><label>Username / NIT<input id="newUsername" placeholder="NIT atau username"></label><label>Password<input id="newPassword" type="text" placeholder="Password unik"></label></div>';
    html += '<div class="form-action" style="margin-top:14px"><button class="btn btn-gold" type="button" onclick="window.EvotingAdmin.addVoter()">Tambah pemilih</button></div></section>';
    html += '<section class="panel"><span class="eyebrow">IMPOR MASSAL</span><h2>Tambah banyak pemilih</h2><p class="tiny muted">Format per baris: Nama | Username/NIT | Password</p>';
    html += '<label class="field"><span>Daftar pemilih</span><textarea id="bulkRows" rows="7" placeholder="Andi Saputra | 23123456 | DPT-A7K92&#10;Budi Santoso | 23123457 | DPT-B8L31"></textarea></label>';
    html += '<button class="btn btn-outline" type="button" onclick="window.EvotingAdmin.bulkImport()">Impor daftar pemilih</button></section></div>';
    html += '<section class="panel"><div class="panel-head"><div><span class="eyebrow">DATABASE PEMILIH</span><h2>Daftar akun dan status partisipasi</h2></div><input id="voterSearch" class="search-input" placeholder="Cari nama atau NIT..." oninput="window.EvotingAdmin.filterVoters()"></div>';
    html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>NO.</th><th>NAMA</th><th>USERNAME / NIT</th><th>STATUS</th><th>WAKTU</th><th>AKSI</th></tr></thead><tbody id="voterRows"></tbody></table></div></section>';
    $('#adminContent').innerHTML = html;
    renderVoterRows();
  }

  function renderResults() {
    var totalVotes = Object.values(stats.counts || {}).reduce(function (sum, value) { return sum + Number(value || 0); }, 0);
    var html = heading('REKAPITULASI', 'Hasil suara', 'Rekapitulasi menampilkan perolehan setiap pasangan calon tanpa membuka pilihan per akun pemilih.');
    html += '<div class="stats-grid compact">' + statCard('TOTAL SUARA MASUK', totalVotes, 'Surat suara tercatat', '✓') + statCard('TOTAL PEMILIH', stats.total || 0, 'Akun terdaftar', '◎') + '</div>';
    html += '<section class="panel"><div class="panel-head"><div><span class="eyebrow">PEROLEHAN SUARA</span><h2>Hasil sementara</h2></div><span class="status-chip">' + statusLabel(stats.config.status) + '</span></div>';
    (stats.config.candidates || []).forEach(function (candidate) {
      var count = Number((stats.counts || {})[candidate.id] || 0);
      var percent = totalVotes ? Math.round(count / totalVotes * 1000) / 10 : 0;
      html += '<div class="result-row"><div class="result-label"><b>PASLON ' + esc(candidate.id) + '</b><span>' + esc(candidate.ketua) + ' & ' + esc(candidate.wakil) + '</span><strong>' + count + ' suara · ' + percent + '%</strong></div>';
      html += '<div class="progress-track"><div class="progress-fill" style="width:' + percent + '%"></div></div></div>';
    });
    html += '<p class="mini-note">Pembaruan terakhir: ' + (stats.updatedAt ? esc(new Date(stats.updatedAt).toLocaleString('id-ID')) : 'belum ada suara masuk') + '.</p></section>';
    $('#adminContent').innerHTML = html;
  }

  function renderSettings() {
    var html = heading('PENGATURAN AKSES', 'Keamanan admin', 'Ganti password administrator dan kelola data simulasi sebelum pemilihan resmi.');
    html += '<section class="panel"><span class="eyebrow">GANTI KREDENSIAL</span><h2>Perbarui password admin</h2><p class="tiny muted">Username admin tetap <b>admin_dpt</b>. Password baru minimal 8 karakter. Setelah diganti, Anda akan diminta login kembali.</p>';
    html += '<div class="form-grid"><label>Password admin saat ini<input id="oldAdminPassword" type="password" autocomplete="current-password"></label><label>Password admin baru<input id="newAdminPassword" type="password" autocomplete="new-password" minlength="8"></label></div>';
    html += '<div class="form-action" style="margin-top:14px"><button class="btn btn-gold" type="button" onclick="window.EvotingAdmin.changePassword()">Ganti password admin</button></div></section>';
    html += '<section class="panel"><span class="eyebrow">SIMULASI</span><h2>Reset data latihan</h2><p class="muted">Fitur ini menghapus seluruh surat suara dan status sudah/belum memilih, tetapi daftar akun pemilih tetap tersimpan. Gunakan hanya setelah simulasi latihan selesai dan sebelum pemilihan resmi dimulai.</p>';
    html += '<div class="notice-box">Perhatian: reset tidak dapat dibatalkan. Jangan gunakan fitur ini ketika pemungutan suara resmi sedang berlangsung.</div>';
    html += '<button class="btn btn-danger" type="button" onclick="window.EvotingAdmin.resetPractice()">Reset data latihan</button></section>';
    html += '<section class="panel"><span class="eyebrow">STATUS SERVER</span><h2>Penyimpanan terpusat</h2><p class="muted">Aplikasi menggunakan Netlify Functions dan Netlify Blobs. Source code dan aset visual tetap dikelola melalui repository GitHub.</p><div class="notice-box">URL API: <b>/api/health</b><br>Storage: <b>Netlify Blobs</b><br>Branch deployment: <b>main</b></div></section>';
    $('#adminContent').innerHTML = html;
  }

  function renderTab(tab) {
    currentTab = tab || 'overview';
    document.querySelectorAll('.admin-nav button').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-tab') === currentTab);
    });
    if (!stats) return;
    if (currentTab === 'candidates') renderCandidates();
    else if (currentTab === 'voters') renderVoters();
    else if (currentTab === 'results') renderResults();
    else if (currentTab === 'settings') renderSettings();
    else renderOverview();
  }

  async function loadStats() {
    try {
      stats = await api('/admin/stats');
      $('#adminLoginView').classList.add('hidden');
      $('#adminShell').classList.remove('hidden');
      $('#adminElectionName').textContent = stats.config.title || 'Dashboard EvotingDPT';
      message('adminFeedback', '');
      renderTab(currentTab);
      return true;
    } catch (error) {
      if (error.message !== 'Unauthorized') message('adminLoginFeedback', error.message, 'error');
      return false;
    }
  }

  async function login(event) {
    event.preventDefault();
    message('adminLoginFeedback', '');
    var button = $('#adminLoginButton');
    button.disabled = true;
    button.textContent = 'Memeriksa akses...';
    try {
      await api('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: $('#adminUsername').value.trim(), password: $('#adminPassword').value })
      });
      $('#adminPassword').value = '';
      currentTab = 'overview';
      await loadStats();
    } catch (error) {
      var text = error.message;
      if (text.indexOf('ADMIN_BOOTSTRAP_PASSWORD') >= 0) {
        text = 'Password awal admin belum dikonfigurasi di Netlify. Tambahkan environment variable ADMIN_BOOTSTRAP_PASSWORD, lalu jalankan deploy ulang.';
      }
      message('adminLoginFeedback', text, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Masuk dashboard →';
    }
  }

  async function saveConfig() {
    if (!draftConfig) return;
    draftConfig.title = $('#cfgTitle').value.trim();
    draftConfig.institution = $('#cfgInstitution').value.trim();
    draftConfig.period = $('#cfgPeriod').value.trim();
    draftConfig.tagline = $('#cfgTagline').value.trim();
    draftConfig.status = $('#cfgStatus').value;
    (draftConfig.candidates || []).forEach(function (candidate, index) {
      candidate.ketua = $('#candidate' + index + 'Ketua').value.trim();
      candidate.wakil = $('#candidate' + index + 'Wakil').value.trim();
      candidate.visi = $('#candidate' + index + 'Visi').value.trim();
      candidate.misi = $('#candidate' + index + 'Misi').value.trim();
      candidate.slogan = $('#candidate' + index + 'Slogan').value.trim();
    });
    try {
      await api('/admin/config', { method: 'POST', body: JSON.stringify(draftConfig) });
      await loadStats();
      renderTab('candidates');
      message('adminFeedback', 'Pengaturan pemilihan dan data pasangan calon berhasil disimpan.', 'success');
    } catch (error) {
      message('adminFeedback', error.message, 'error');
    }
  }

  function pickPhoto(input, index, role) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 900000) {
      alert('Ukuran setiap foto maksimal 900 KB. Kompres foto terlebih dahulu agar penyimpanan tetap ringan.');
      input.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      if (!draftConfig || !draftConfig.candidates[index]) return;
      var key = role === 'ketua' ? 'photoKetua' : 'photoWakil';
      draftConfig.candidates[index][key] = reader.result;
      var preview = document.getElementById('photoPreview' + (role === 'ketua' ? 'Ketua' : 'Wakil') + index);
      if (preview) preview.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function addVoter() {
    var payload = {
      name: $('#newName').value.trim(),
      username: $('#newUsername').value.trim(),
      password: $('#newPassword').value
    };
    try {
      await api('/admin/users/add', { method: 'POST', body: JSON.stringify(payload) });
      await loadStats();
      renderTab('voters');
      message('adminFeedback', 'Akun pemilih berhasil ditambahkan.', 'success');
    } catch (error) {
      message('adminFeedback', error.message, 'error');
    }
  }

  async function bulkImport() {
    var lines = $('#bulkRows').value.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    var rows = lines.map(function (line) {
      var parts = line.split('|');
      return { name: (parts[0] || '').trim(), username: (parts[1] || '').trim(), password: (parts[2] || '').trim() };
    }).filter(function (row) { return row.name && row.username && row.password; });
    if (!rows.length) {
      message('adminFeedback', 'Tidak ada baris valid. Gunakan format Nama | Username/NIT | Password.', 'error');
      return;
    }
    try {
      var result = await api('/admin/users/bulk', { method: 'POST', body: JSON.stringify({ rows: rows }) });
      await loadStats();
      renderTab('voters');
      message('adminFeedback', result.added + ' akun berhasil ditambahkan. ' + (result.skipped || []).length + ' baris dilewati.', 'success');
    } catch (error) {
      message('adminFeedback', error.message, 'error');
    }
  }

  async function deleteVoter(id) {
    var user = (stats.users || []).find(function (item) { return item.id === id; });
    if (!user || user.hasVoted) {
      alert('Akun yang sudah menggunakan hak suara tidak dapat dihapus.');
      return;
    }
    if (!confirm('Hapus akun pemilih ' + user.name + ' (' + user.username + ')?')) return;
    try {
      await api('/admin/users/delete', { method: 'POST', body: JSON.stringify({ id: id }) });
      await loadStats();
      renderTab('voters');
      message('adminFeedback', 'Akun pemilih berhasil dihapus.', 'success');
    } catch (error) {
      message('adminFeedback', error.message, 'error');
    }
  }

  function filterVoters() { renderVoterRows(); }

  async function resetPractice() {
    if (!confirm('Reset akan menghapus seluruh hasil suara dan mengubah semua status pemilih menjadi BELUM MEMILIH. Daftar pemilih tetap tersimpan. Lanjutkan?')) return;
    if (!confirm('Konfirmasi terakhir: reset seluruh data latihan sekarang?')) return;
    try {
      await api('/admin/reset-practice', { method: 'POST', body: '{}' });
      await loadStats();
      renderTab('settings');
      message('adminFeedback', 'Data latihan berhasil direset. Daftar pemilih tetap tersimpan.', 'success');
    } catch (error) {
      message('adminFeedback', error.message, 'error');
    }
  }

  async function changePassword() {
    var oldPassword = $('#oldAdminPassword').value;
    var newPassword = $('#newAdminPassword').value;
    if (newPassword.length < 8) {
      message('adminFeedback', 'Password baru minimal 8 karakter.', 'error');
      return;
    }
    try {
      await api('/admin/password', { method: 'POST', body: JSON.stringify({ oldPassword: oldPassword, newPassword: newPassword }) });
      $('#adminShell').classList.add('hidden');
      $('#adminLoginView').classList.remove('hidden');
      $('#adminPassword').value = '';
      message('adminLoginFeedback', 'Password berhasil diganti. Silakan login kembali menggunakan password baru.', 'success');
    } catch (error) {
      message('adminFeedback', error.message, 'error');
    }
  }

  async function logout() {
    try { await api('/admin/logout', { method: 'POST', body: '{}' }); } catch (error) {}
    window.location.href = '/admin.html';
  }

  function openTab(tab) { renderTab(tab); }

  function init() {
    $('#adminLoginForm').addEventListener('submit', login);
    document.querySelectorAll('.admin-nav button').forEach(function (button) {
      button.addEventListener('click', function () { renderTab(button.getAttribute('data-tab')); });
    });
    loadStats();
  }

  window.EvotingAdmin = {
    openTab: openTab,
    saveConfig: saveConfig,
    pickPhoto: pickPhoto,
    addVoter: addVoter,
    bulkImport: bulkImport,
    deleteVoter: deleteVoter,
    filterVoters: filterVoters,
    resetPractice: resetPractice,
    changePassword: changePassword,
    logout: logout
  };

  init();
})();
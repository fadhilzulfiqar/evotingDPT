(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  let stats = null;
  let draftConfig = null;
  let currentTab = 'overview';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  async function api(path, options = {}) {
    const response = await fetch('/api/v2' + path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Permintaan tidak dapat diproses.');
    return data;
  }
  function feedback(message, kind = 'error', target = '#adminFeedback') {
    const el = $(target); el.textContent = message || ''; el.style.color = kind === 'success' ? '#8ce2b9' : '';
  }
  function heading(kicker, title, description) {
    return '<div class="panel-heading"><div><div class="eyebrow">' + esc(kicker) + '</div><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div></div>';
  }
  function statCard(label, value, note) {
    return '<div class="admin-stat"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(note) + '</small></div>';
  }
  function statusLabel(status) { return status === 'open' ? 'DIBUKA' : status === 'closed' ? 'DITUTUP' : 'BELUM DIMULAI'; }

  function renderOverview() {
    const setup = stats.setupRequired;
    let html = heading('RINGKASAN PEMILIHAN', 'Dashboard utama', 'Pantau partisipasi pemilih dan kesiapan pemungutan suara.');
    if (setup) html += '<div class="notice-error">PostgreSQL belum terhubung. Data calon dan akun dapat disiapkan, tetapi pemilihan tidak dapat dibuka sebelum DATABASE_URL dikonfigurasi pada Netlify.</div>';
    html += '<div class="admin-content-grid">';
    html += statCard('TOTAL AKUN', stats.total, 'Seluruh akun terdaftar');
    html += statCard('AKUN AKTIF', stats.activeTotal, 'Memiliki hak untuk login');
    html += statCard('SUDAH MEMILIH', stats.voted == null ? '—' : stats.voted, 'Partisipasi tercatat');
    html += statCard('BELUM MEMILIH', stats.remaining == null ? '—' : stats.remaining, 'Akun aktif yang belum memilih');
    html += statCard('PARTISIPASI', stats.participation == null ? '—' : stats.participation + '%', 'Persentase pemilih aktif');
    html += statCard('STATUS', statusLabel(stats.config.status), 'Status pemungutan suara');
    html += '</div><section class="admin-panel"><div class="eyebrow">KONDISI SISTEM</div><h2>Ringkasan teknis</h2>';
    html += '<p>Database suara: <b>' + (setup ? 'Belum terhubung' : 'PostgreSQL') + '</b><br>Autentikasi dan konfigurasi: <b>Netlify Blobs</b><br>Skema: <b>Ketua dan Wakil dipilih terpisah</b></p>';
    html += '<div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.openTab(\'candidates\')">Kelola data calon</button><button class="small-button" type="button" onclick="window.EvotingAdmin.openTab(\'voters\')">Kelola pemilih</button><button class="small-button" type="button" onclick="window.EvotingAdmin.openTab(\'results\')">Lihat rekap suara</button></div></section>';
    $('#adminContent').innerHTML = html;
  }

  function candidateEditor(candidate, role, index, locked) {
    const photo = candidate.photo
      ? '<img id="preview-' + role + '-' + index + '" src="' + esc(candidate.photo) + '" alt="Foto ' + esc(candidate.name) + '">'
      : '<div class="photo-empty" id="preview-' + role + '-' + index + '">0' + (index + 1) + '</div>';
    const title = role === 'ketua' ? 'CALON KETUA' : 'CALON WAKIL KETUA';
    return '<section class="candidate-admin-card"><h3>' + title + ' · NOMOR ' + esc(candidate.number) + '</h3>' + photo +
      '<label>Unggah foto<input class="file-input" type="file" accept="image/png,image/jpeg,image/webp" ' + (locked ? 'disabled' : '') + ' onchange="window.EvotingAdmin.pickPhoto(this,\'' + role + '\',' + index + ')"></label>' +
      '<label>Nama lengkap<input type="text" id="name-' + role + '-' + index + '" maxlength="120" value="' + esc(candidate.name) + '" ' + (locked ? 'disabled' : '') + ' placeholder="Nama lengkap calon"></label>' +
      '<p class="inline-note">Foto dan nama akan ditampilkan pada halaman pemilih. Tidak ada kolom visi dan misi.</p></section>';
  }

  function renderCandidates() {
    draftConfig = JSON.parse(JSON.stringify(stats.config));
    const locked = stats.config.status === 'open';
    let html = heading('PENGELOLAAN CALON', 'Empat kandidat independen', 'Atur dua calon Ketua dan dua calon Wakil. Masing-masing jabatan memiliki pemungutan suara sendiri.');
    if (locked) html += '<div class="notice-error">Pemilihan sedang dibuka. Data calon dikunci. Tutup pemilihan terlebih dahulu jika perlu melakukan perubahan.</div>';
    html += '<section class="admin-panel"><div class="admin-form-grid">';
    html += '<label class="full">Judul pemilihan<input id="cfgTitle" value="' + esc(draftConfig.title) + '" maxlength="160"></label>';
    html += '<label>Institusi<input id="cfgInstitution" value="' + esc(draftConfig.institution) + '" maxlength="160"></label>';
    html += '<label>Periode<input id="cfgPeriod" value="' + esc(draftConfig.period) + '" maxlength="80"></label>';
    html += '<label class="full">Tagline<input id="cfgTagline" value="' + esc(draftConfig.tagline) + '" maxlength="220"></label>';
    html += '<label>Status pemilihan<select id="cfgStatus"><option value="scheduled">Belum dimulai</option><option value="open">Dibuka</option><option value="closed">Ditutup</option></select></label></div>';
    html += '<div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.saveConfig()">Simpan konfigurasi</button></div></section>';
    html += '<div class="candidate-admin-grid">';
    draftConfig.candidates.ketua.forEach((candidate, index) => { html += candidateEditor(candidate, 'ketua', index, locked); });
    draftConfig.candidates.wakil.forEach((candidate, index) => { html += candidateEditor(candidate, 'wakil', index, locked); });
    html += '</div><section class="admin-panel"><p>Ketentuan sebelum membuka pemilihan: nama dan foto seluruh empat calon harus lengkap, serta PostgreSQL harus terhubung. Setelah status dibuka, identitas calon terkunci.</p><div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.saveConfig()">Simpan seluruh perubahan</button></div></section>';
    $('#adminContent').innerHTML = html; $('#cfgStatus').value = draftConfig.status || 'scheduled';
  }

  function renderVoterRows() {
    if (!stats) return;
    const search = ($('#voterSearch') ? $('#voterSearch').value : '').trim().toLowerCase();
    const rows = stats.users.filter(user => (String(user.name) + ' ' + String(user.username)).toLowerCase().includes(search));
    let html = '';
    rows.forEach((user, index) => {
      const state = !user.active ? '<span class="status-pill disabled">DINONAKTIFKAN</span>'
        : user.hasVoted === null ? '<span class="status-pill pending">MENUNGGU DATABASE</span>'
        : user.hasVoted ? '<span class="status-pill done">SUDAH MEMILIH</span>'
        : '<span class="status-pill pending">BELUM MEMILIH</span>';
      const actions = user.active
        ? '<button class="small-button" type="button" data-action="edit" data-id="' + esc(user.id) + '">Edit</button> ' +
          (user.hasVoted === null ? '<span class="inline-note">Menunggu database</span>' : user.hasVoted ? '<span class="inline-note">Hak suara digunakan</span>' : '<button class="small-button warn" type="button" data-action="deactivate" data-id="' + esc(user.id) + '">Nonaktifkan</button>')
        : '<button class="small-button" type="button" data-action="activate" data-id="' + esc(user.id) + '">Aktifkan kembali</button>';
      html += '<tr><td>' + (index + 1) + '</td><td>' + esc(user.name) + '</td><td>' + esc(user.username) + '</td><td>' + state + '</td><td>' + (user.votedAt ? esc(new Date(user.votedAt).toLocaleString('id-ID')) : '—') + '</td><td>' + actions + '</td></tr>';
    });
    $('#voterRows').innerHTML = html || '<tr><td colspan="6">Tidak ada data pemilih.</td></tr>';
  }

  function renderVoters() {
    let html = heading('MANAJEMEN PEMILIH', 'Data pemilih', 'Tambah, impor, edit, dan nonaktifkan akun. Status partisipasi dapat dipantau tanpa membuka pilihan suara.');
    html += '<div class="admin-content-grid"><section class="admin-panel"><div class="eyebrow">TAMBAH AKUN</div><h2>Pemilih baru</h2><div class="admin-form-grid"><label class="full">Nama lengkap<input id="newName" placeholder="Nama pemilih"></label><label>Username<input id="newUsername" placeholder="Username"></label><label>Password<input id="newPassword" type="text" placeholder="Password"></label></div><div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.addVoter()">Tambah akun</button></div></section>';
    html += '<section class="admin-panel"><div class="eyebrow">IMPOR MASSAL</div><h2>Daftar pemilih</h2><p>Format per baris: Nama | Username | Password</p><textarea id="bulkRows" class="admin-input" rows="6" placeholder="Nama Pemilih | 23123456 | DPT-A7K92"></textarea><div class="admin-actions"><button class="small-button" type="button" onclick="window.EvotingAdmin.bulkImport()">Impor daftar</button></div></section></div>';
    html += '<section class="admin-panel"><div class="panel-heading"><div><div class="eyebrow">STATUS PARTISIPASI</div><h2>Daftar akun dan status pemilihan</h2></div><input id="voterSearch" class="search-box" placeholder="Cari nama atau username..." oninput="window.EvotingAdmin.filterVoters()"></div>';
    html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>NO.</th><th>NAMA</th><th>USERNAME</th><th>STATUS</th><th>WAKTU SUARA</th><th>AKSI</th></tr></thead><tbody id="voterRows"></tbody></table></div></section>';
    $('#adminContent').innerHTML = html;
    $('#voterRows').addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      if (button.dataset.action === 'edit') editUser(id);
      else if (button.dataset.action === 'deactivate') deactivateUser(id);
      else if (button.dataset.action === 'activate') activateUser(id);
    });
    renderVoterRows();
  }

  function renderResultGroup(role, candidates, counts) {
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    let html = '<section class="admin-panel"><div class="eyebrow">' + (role === 'ketua' ? 'PEMILIHAN KETUA' : 'PEMILIHAN WAKIL KETUA') + '</div><h2>Rekapitulasi ' + (role === 'ketua' ? 'Ketua' : 'Wakil Ketua') + '</h2>';
    candidates.forEach(candidate => {
      const count = Number(counts[candidate.id] || 0);
      const percent = total ? Math.round(count / total * 1000) / 10 : 0;
      html += '<div class="result-item"><div class="result-meta"><span>' + esc(candidate.number) + ' · ' + esc(candidate.name || 'Nama belum diatur') + '</span><strong>' + count + ' suara · ' + percent + '%</strong></div><div class="result-track"><div class="result-fill" style="width:' + percent + '%"></div></div></div>';
    });
    html += '<p class="inline-note">Total suara ' + (role === 'ketua' ? 'Ketua' : 'Wakil') + ': ' + total + '. Suara tidak ditampilkan per identitas pemilih.</p></section>';
    return html;
  }

  function renderResults() {
    let html = heading('HASIL PEMILIHAN', 'Rekapitulasi suara', 'Perolehan suara Ketua dan Wakil dihitung dan ditampilkan secara terpisah.');
    if (stats.setupRequired) html += '<div class="notice-error">Rekap belum tersedia karena PostgreSQL belum dikonfigurasi.</div>';
    else if (!stats.resultsVisible) html += '<div class="notice-error">Perolehan suara setiap calon disembunyikan selama pemungutan suara berlangsung untuk mengurangi potensi bias. Status partisipasi pemilih tetap dapat dipantau. Rekap akan dibuka setelah admin menutup pemilihan.</div>';
    else {
      html += '<div class="admin-content-grid">' + statCard('TOTAL SURAT SUARA', stats.totalBallots, 'Satu surat suara berisi pilihan dua jabatan') + statCard('SUDAH MEMILIH', stats.voted, 'Akun pemilih aktif') + statCard('BELUM MEMILIH', stats.remaining, 'Akun pemilih aktif') + '</div>';
      html += renderResultGroup('ketua', stats.config.candidates.ketua, stats.chairCounts);
      html += renderResultGroup('wakil', stats.config.candidates.wakil, stats.viceCounts);
      html += '<section class="admin-panel"><div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.exportCsv()">Unduh rekap CSV</button></div><p class="inline-note">File berisi rekap agregat dan daftar partisipasi, tanpa menghubungkan identitas dengan pilihan.</p></section>';
    }
    $('#adminContent').innerHTML = html;
  }

  async function renderAudit() {
    let html = heading('PENGAWASAN', 'Audit aktivitas admin', 'Riwayat perubahan konfigurasi, pengelolaan akun, arsip, dan reset pemilihan.');
    try {
      const result = await api('/admin/audit');
      html += '<section class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>WAKTU</th><th>AKSI</th><th>TARGET</th><th>DETAIL</th></tr></thead><tbody>';
      result.entries.forEach(entry => {
        html += '<tr><td>' + esc(new Date(entry.created_at).toLocaleString('id-ID')) + '</td><td>' + esc(entry.action) + '</td><td>' + esc(entry.target_id || '—') + '</td><td>' + esc(JSON.stringify(entry.details || {})) + '</td></tr>';
      });
      html += '</tbody></table></div></section>';
    } catch (error) { html += '<div class="notice-error">' + esc(error.message) + '</div>'; }
    $('#adminContent').innerHTML = html;
  }

  function renderSettings() {
    let html = heading('PENGATURAN SISTEM', 'Keamanan dan arsip', 'Kelola kredensial administrator, arsip data uji coba lama, dan reset pemilihan v2.');
    html += '<section class="admin-panel"><div class="eyebrow">KREDENSIAL ADMIN</div><h2>Ganti password admin</h2><div class="admin-form-grid"><label>Password saat ini<input id="oldAdminPassword" type="password" autocomplete="current-password"></label><label>Password baru<input id="newAdminPassword" type="password" autocomplete="new-password" minlength="8"></label></div><div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.changePassword()">Ganti password</button></div></section>';
    html += '<section class="admin-panel"><div class="eyebrow">PRESERVASI DATA LAMA</div><h2>Arsipkan data trial v1</h2><p>Menyalin konfigurasi lama serta record surat suara trial dari Netlify Blobs ke store arsip privat. Data sumber tidak dihapus. Akun pemilih tetap berada di penyimpanan semula. Sebelum backup, tutup pemilihan trial lama melalui <a href="/admin" target="_blank" rel="noopener">dashboard admin lama</a>. Backend akan menolak backup jika status lama masih OPEN atau datanya berubah selama proses.</p><div class="notice-error">Arsip legacy dapat memuat struktur internal lama yang menghubungkan voter-lock dengan pilihan. Isi arsip tidak akan ditampilkan pada dashboard atau ekspor.</div><div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.archiveLegacy()">Buat backup data trial lama</button></div></section>';
    html += '<section class="admin-panel"><div class="eyebrow">RESET PEMILIHAN V2</div><h2>Reset dengan arsip otomatis</h2><p>Hanya dapat dilakukan setelah pemilihan ditutup. Sebelum menghapus data aktif v2, backend menyalin surat suara dan status partisipasi ke tabel arsip PostgreSQL. Akun pemilih tidak dihapus.</p><div class="admin-actions"><button class="small-button warn" type="button" onclick="window.EvotingAdmin.resetElection()">Arsipkan dan reset v2</button></div></section>';
    html += '<section class="admin-panel"><div class="eyebrow">STATUS INFRASTRUKTUR</div><h2>Koneksi penyimpanan</h2><p>Database suara: <b>' + (stats.setupRequired ? 'Belum terhubung' : 'PostgreSQL') + '</b><br>Data akun, sesi, foto, dan konfigurasi: <b>Netlify Blobs</b><br>Lingkungan aplikasi: <b>v2 independent ballot</b></p></section>';
    $('#adminContent').innerHTML = html;
  }

  function renderTab(tab) {
    currentTab = tab || 'overview';
    document.querySelectorAll('.admin-nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === currentTab));
    if (!stats) return;
    if (currentTab === 'candidates') renderCandidates();
    else if (currentTab === 'voters') renderVoters();
    else if (currentTab === 'results') renderResults();
    else if (currentTab === 'audit') renderAudit();
    else if (currentTab === 'settings') renderSettings();
    else renderOverview();
  }

  async function loadStats() {
    stats = await api('/admin/stats');
    $('#adminLoginView').classList.add('hidden');
    $('#adminShell').classList.remove('hidden');
    $('#adminElectionName').textContent = stats.config.title || 'Dashboard E-Voting DPT';
    feedback('');
    renderTab(currentTab);
  }

  async function login(event) {
    event.preventDefault(); feedback('', 'error', '#adminLoginFeedback');
    const button = $('#adminLoginButton'); button.disabled = true; button.textContent = 'Memeriksa akses...';
    try {
      await api('/admin/login', { method: 'POST', body: JSON.stringify({ username: $('#adminUsername').value.trim(), password: $('#adminPassword').value }) });
      $('#adminPassword').value = ''; currentTab = 'overview'; await loadStats();
    } catch (error) { feedback(error.message, 'error', '#adminLoginFeedback'); }
    finally { button.disabled = false; button.textContent = 'Masuk dashboard →'; }
  }

  async function saveConfig() {
    if (!draftConfig) return;
    draftConfig.title = $('#cfgTitle').value.trim();
    draftConfig.institution = $('#cfgInstitution').value.trim();
    draftConfig.period = $('#cfgPeriod').value.trim();
    draftConfig.tagline = $('#cfgTagline').value.trim();
    draftConfig.status = $('#cfgStatus').value;
    ['ketua','wakil'].forEach(role => draftConfig.candidates[role].forEach((candidate,index) => {
      const input = $('#name-' + role + '-' + index); if (input) candidate.name = input.value.trim();
    }));
    try {
      await api('/admin/config', { method: 'POST', body: JSON.stringify(draftConfig) });
      await loadStats(); renderTab('candidates'); feedback('Konfigurasi pemilihan berhasil disimpan.', 'success');
    } catch (error) { feedback(error.message); }
  }

  function pickPhoto(input, role, index) {
    const file = input.files && input.files[0]; if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { alert('Gunakan foto JPG, PNG, atau WebP.'); input.value=''; return; }
    if (file.size > 900000) { alert('Ukuran setiap foto maksimal 900 KB. Kompres foto terlebih dahulu.'); input.value=''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (!draftConfig) return;
      draftConfig.candidates[role][index].photo = reader.result;
      const preview = $('#preview-' + role + '-' + index);
      if (preview) {
        if (preview.tagName === 'IMG') preview.src = reader.result;
        else { const img = document.createElement('img'); img.id = preview.id; img.alt = 'Foto calon'; img.src = reader.result; preview.replaceWith(img); }
      }
    };
    reader.readAsDataURL(file);
  }

  async function addVoter() {
    const payload = { name: $('#newName').value.trim(), username: $('#newUsername').value.trim(), password: $('#newPassword').value };
    try { await api('/admin/users/add', { method: 'POST', body: JSON.stringify(payload) }); await loadStats(); renderTab('voters'); feedback('Akun pemilih berhasil ditambahkan.', 'success'); }
    catch (error) { feedback(error.message); }
  }

  async function bulkImport() {
    const lines = $('#bulkRows').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const rows = lines.map(line => { const parts = line.split('|'); return { name:(parts[0]||'').trim(), username:(parts[1]||'').trim(), password:(parts[2]||'').trim() }; }).filter(row => row.name && row.username && row.password);
    if (!rows.length) return feedback('Tidak ada baris valid. Gunakan format Nama | Username | Password.');
    try { const result = await api('/admin/users/bulk', { method:'POST', body:JSON.stringify({rows}) }); await loadStats(); renderTab('voters'); feedback(result.added + ' akun ditambahkan; ' + result.skipped.length + ' baris dilewati.', 'success'); }
    catch (error) { feedback(error.message); }
  }

  async function editUser(id) {
    const user = stats.users.find(item => item.id === id); if (!user) return;
    const name = prompt('Ubah nama lengkap pemilih:', user.name); if (name === null) return;
    const password = prompt('Password baru (kosongkan jika tidak diubah):', ''); if (password === null) return;
    try { await api('/admin/users/update', { method:'POST', body:JSON.stringify({id,name,password}) }); await loadStats(); renderTab('voters'); feedback('Data pemilih berhasil diperbarui.', 'success'); }
    catch (error) { feedback(error.message); }
  }

  async function deactivateUser(id) {
    const user = stats.users.find(item => item.id === id); if (!user || user.hasVoted !== false) return;
    if (!confirm('Nonaktifkan akun ' + user.name + ' (' + user.username + ')? Akun tidak dapat login, tetapi data tetap tersimpan dalam audit.')) return;
    try { await api('/admin/users/deactivate', { method:'POST', body:JSON.stringify({id}) }); await loadStats(); renderTab('voters'); feedback('Akun berhasil dinonaktifkan.', 'success'); }
    catch (error) { feedback(error.message); }
  }

  async function activateUser(id) {
    if (!confirm('Aktifkan kembali akun pemilih ini?')) return;
    try { await api('/admin/users/activate', { method:'POST', body:JSON.stringify({id}) }); await loadStats(); renderTab('voters'); feedback('Akun berhasil diaktifkan kembali.', 'success'); }
    catch (error) { feedback(error.message); }
  }

  async function archiveLegacy() {
    if (!confirm('Buat salinan arsip privat dari data trial lama? Data sumber tidak akan dihapus. Pada deploy preview, fitur ini memang dinonaktifkan.')) return;
    try {
      const result = await api('/admin/legacy-archive', { method:'POST', body:'{}' });
      feedback('Backup berhasil dibuat: ' + result.manifest.backupId + '. Record voter-lock: ' + result.manifest.voterLockRecordsCopied + ', ballot: ' + result.manifest.ballotRecordsCopied + '.', 'success');
      await loadStats(); renderTab('settings');
    } catch (error) { feedback(error.message); }
  }

  async function resetElection() {
    if (stats.config.status === 'open') return feedback('Tutup pemilihan terlebih dahulu sebelum reset.');
    if (!confirm('Reset akan mengarsipkan surat suara dan partisipasi v2, lalu mengosongkan hasil aktif. Akun pemilih tidak dihapus. Lanjutkan?')) return;
    if (!confirm('Konfirmasi akhir: pastikan arsip dan keputusan panitia sudah disetujui.')) return;
    try {
      const result = await api('/admin/reset-practice', { method:'POST', body:'{}' });
      await loadStats(); renderTab('settings'); feedback('Reset selesai. Arsip ID: ' + result.archiveId, 'success');
    } catch (error) { feedback(error.message); }
  }

  async function changePassword() {
    const oldPassword = $('#oldAdminPassword').value; const newPassword = $('#newAdminPassword').value;
    if (!newPassword || newPassword.length < 8) return feedback('Password baru minimal 8 karakter.');
    try {
      await api('/admin/password', { method:'POST', body:JSON.stringify({oldPassword,newPassword}) });
      $('#adminShell').classList.add('hidden'); $('#adminLoginView').classList.remove('hidden');
      feedback('Password berhasil diganti. Silakan login kembali.', 'success', '#adminLoginFeedback');
    } catch (error) { feedback(error.message); }
  }

  function exportCsv() {
    if (!stats || stats.setupRequired || !stats.resultsVisible) return;
    const rows = [['JENIS','NOMOR','NAMA CALON','JUMLAH SUARA'],
      ...stats.config.candidates.ketua.map(candidate => ['Ketua',candidate.number,candidate.name,stats.chairCounts[candidate.id]||0]),
      ...stats.config.candidates.wakil.map(candidate => ['Wakil',candidate.number,candidate.name,stats.viceCounts[candidate.id]||0]),
      [],['DAFTAR PARTISIPASI'],['NAMA PEMILIH','USERNAME','STATUS','WAKTU']];
    stats.users.forEach(user => rows.push([user.name,user.username,!user.active?'Dinonaktifkan':user.hasVoted?'Sudah memilih':'Belum memilih',user.votedAt?new Date(user.votedAt).toLocaleString('id-ID'):'']));
    const csv = rows.map(row => row.map(value => '"' + String(value == null ? '' : value).replace(/"/g,'""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href=url; link.download='rekap-evoting-dpt-v2.csv'; link.click(); URL.revokeObjectURL(url);
  }

  async function logout() {
    try { await api('/admin/logout', {method:'POST',body:'{}'}); } catch (_) {}
    window.location.href='/admin-v2';
  }

  function init() {
    $('#adminLoginForm').addEventListener('submit', login);
    $('#logoutButton').addEventListener('click', logout);
    document.querySelectorAll('.admin-nav button').forEach(button => button.addEventListener('click', () => renderTab(button.dataset.tab)));
    loadStats().catch(() => {});
  }

  window.EvotingAdmin = {openTab,saveConfig,pickPhoto,addVoter,bulkImport,editUser,deactivateUser,activateUser,archiveLegacy,resetElection,changePassword,exportCsv,filterVoters:renderVoterRows};
  init();
})();
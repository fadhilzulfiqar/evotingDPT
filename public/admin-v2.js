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
  function statusLabel(status) { return status === 'open' ? 'DIBUKA' : status === 'closing' ? 'PENUTUPAN' : status === 'closed' ? 'DITUTUP' : 'BELUM DIMULAI'; }

  function renderOverview() {
    let html = heading('RINGKASAN PEMILIHAN', 'Dashboard utama', 'Pantau partisipasi pemilih dan kesiapan pemungutan suara.');
    html += '<div class="admin-content-grid">';
    html += statCard('TOTAL AKUN', stats.total, 'Seluruh akun terdaftar');
    html += statCard('AKUN AKTIF', stats.activeTotal, 'Memiliki hak untuk login');
    html += statCard('SUDAH MEMILIH', stats.voted, 'Partisipasi selesai tercatat');
    html += statCard('BELUM MEMILIH', stats.remaining, 'Akun aktif yang belum memilih');
    html += statCard('SEDANG DIPROSES', stats.pending || 0, 'Transaksi yang perlu diselesaikan');
    html += statCard('PARTISIPASI', stats.participation + '%', 'Persentase pemilih aktif');
    html += statCard('STATUS', statusLabel(stats.config.status), 'Status pemungutan suara');
    html += '</div><section class="admin-panel"><div class="eyebrow">KONDISI SISTEM</div><h2>Ringkasan teknis</h2>';
    html += '<p>Penyimpanan akun, partisipasi, dan surat suara: <b>Netlify Blobs</b><br>Skema: <b>Ketua dan Wakil dipilih terpisah</b><br>Kerahasiaan: <b>identitas dan pilihan disimpan terpisah</b></p>';
    if (stats.pending) html += '<div class="notice-error">Ada transaksi suara yang sedang diproses. Selesaikan sebelum menutup pemilihan. Setelah status DITUTUP, Reset hasil akan menghapus transaksi tertunda bersama seluruh hasil aktif.</div>';
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
    const locked = stats.config.status === 'open' || stats.config.status === 'closing';
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
    html += '</div><section class="admin-panel"><p>Ketentuan sebelum membuka pemilihan: nama dan foto seluruh empat calon harus lengkap. Penyimpanan menggunakan Netlify Blobs. Setelah status dibuka, identitas calon terkunci.</p><div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.saveConfig()">Simpan seluruh perubahan</button></div></section>';
    $('#adminContent').innerHTML = html; $('#cfgStatus').value = draftConfig.status || 'scheduled';
  }

  function renderVoterRows() {
    if (!stats) return;
    const search = ($('#voterSearch') ? $('#voterSearch').value : '').trim().toLowerCase();
    const rows = stats.users.filter(user => (String(user.name) + ' ' + String(user.username)).toLowerCase().includes(search));
    let html = '';
    rows.forEach((user, index) => {
      const state = user.votePending
        ? '<span class="status-pill pending">TRANSAKSI SUARA DIPROSES</span>'
        : !user.active ? '<span class="status-pill disabled">DINONAKTIFKAN</span>'
        : user.hasVoted ? '<span class="status-pill done">SUDAH MEMILIH</span>'
        : '<span class="status-pill pending">BELUM MEMILIH</span>';
      const deleteButton = user.votePending
        ? (user.active ? '<button class="small-button warn" type="button" data-action="delete" data-id="' + esc(user.id) + '">Kunci akun</button>' : '<span class="inline-note">Tunggu transaksi selesai</span>')
        : user.hasVoted && !user.canDeleteVote
          ? '<button class="small-button warn" type="button" disabled>Reset dulu</button>'
          : '<button class="small-button warn" type="button" data-action="delete" data-id="' + esc(user.id) + '">' + (user.hasVoted ? 'Hapus akun + suara' : 'Hapus') + '</button>';
      const voteNote = user.hasVoted
        ? (user.canDeleteVote ? '<span class="inline-note">Suara dapat dicabut saat akun dihapus</span>' : '<span class="inline-note">Suara lama: reset hasil dahulu</span>')
        : '';
      const actions = user.active
        ? '<button class="small-button" type="button" data-action="edit" data-id="' + esc(user.id) + '">Edit</button> ' +
          (user.votePending ? '<span class="inline-note">Hak akses dapat dikunci</span>' : user.hasVoted ? voteNote : '<button class="small-button warn" type="button" data-action="deactivate" data-id="' + esc(user.id) + '">Nonaktifkan</button> ') + deleteButton
        : (user.votePending ? '<span class="inline-note">Akun dikunci; menunggu transaksi</span>' : '<button class="small-button" type="button" data-action="activate" data-id="' + esc(user.id) + '">Aktifkan kembali</button> ') + voteNote + deleteButton;
      html += '<tr><td>' + (index + 1) + '</td><td>' + esc(user.name) + '</td><td>' + esc(user.username) + '</td><td>' + state + '</td><td>' + (user.votedAt ? esc(new Date(user.votedAt).toLocaleString('id-ID')) : '—') + '</td><td>' + actions + '</td></tr>';
    });
    $('#voterRows').innerHTML = html || '<tr><td colspan="6">Tidak ada data pemilih.</td></tr>';
  }

  function renderVoters() {
    let html = heading('MANAJEMEN PEMILIH', 'Data pemilih', 'Admin dapat mengunci dan menghapus akun selama pemilihan berlangsung. Untuk suara baru, penghapusan akun juga mencabut surat suara terkait dari rekap. Suara lama sebelum fitur ini hanya dapat dibersihkan melalui Reset hasil.');
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
      else if (button.dataset.action === 'delete') deleteVoter(id);
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
    if (!stats.resultsVisible) html += '<div class="notice-error">Perolehan suara setiap calon disembunyikan selama pemungutan suara berlangsung atau ketika transaksi masih dipulihkan. Rekap akan dibuka setelah pemilihan ditutup dan seluruh transaksi selesai.</div>';
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
    let html = heading('PENGATURAN SISTEM', 'Keamanan dan reset', 'Atur kredensial admin dan kelola hasil pemilihan.');
    html += '<section class="admin-panel"><div class="eyebrow">KREDENSIAL ADMIN</div><h2>Ganti password admin</h2><div class="admin-form-grid"><label>Password saat ini<input id="oldAdminPassword" type="password" autocomplete="current-password"></label><label>Password baru<input id="newAdminPassword" type="password" autocomplete="new-password" minlength="12"></label></div><div class="admin-actions"><button class="small-button gold" type="button" onclick="window.EvotingAdmin.changePassword()">Ganti password</button></div><p class="inline-note">Gunakan password minimal 12 karakter. Kode bootstrap dapat digunakan untuk pemulihan jika password admin terlupa.</p></section>';
    const canReset = stats.deployContext === 'production' && stats.config.status === 'closed';
    const resetLabel = stats.deployContext !== 'production' ? 'Reset hanya tersedia di Production' : stats.config.status !== 'closed' ? 'Tutup pemilihan untuk reset' : 'Reset hasil pemilihan';
    html += '<section class="admin-panel"><div class="eyebrow">RESET PEMILIHAN</div><h2>Reset hasil pemilihan</h2><p>Reset dapat dijalankan kapan saja setelah status pemilihan DITUTUP. Tidak perlu menunggu semua pemilih menggunakan hak suara; akun aktif dan akun yang belum memilih tidak menghalangi reset. Seluruh surat suara, transaksi tertunda, dan penanda partisipasi akan dihapus tanpa arsip. Akun pemilih, data calon, dan riwayat audit tetap dipertahankan.</p><p class="inline-note">Deploy context: <b>' + esc(stats.deployContext || 'belum diatur') + '</b> · Penyimpanan aktif: <b>' + esc(stats.storageNamespace || 'preview') + '</b></p><div class="admin-actions"><button class="small-button warn" type="button" ' + (canReset ? '' : 'disabled') + ' onclick="window.EvotingAdmin.resetElection()">' + resetLabel + '</button></div></section>';
    html += '<section class="admin-panel"><div class="eyebrow">INFRASTRUKTUR</div><h2>Penyimpanan aplikasi</h2><p>Platform: <b>Netlify Functions 2.0</b><br>Object storage: <b>Netlify Blobs</b><br>Deploy context: <b>' + esc(stats.deployContext || 'belum diatur') + '</b><br>Namespace data: <b>' + esc(stats.storageNamespace || 'preview') + '</b><br>Skema suara: <b>surat suara terpisah dengan ID referensi acak untuk pencabutan suara oleh admin</b></p><div class="notice-error">Dashboard tidak menampilkan pilihan per pemilih. Namun, ID referensi pada status partisipasi memungkinkan sistem menghapus surat suara saat akun dihapus; karena itu keterkaitan teknis akun dan surat suara tetap ada. Reset menghapus semua surat suara, transaksi tertunda, dan status partisipasi tanpa menghapus akun maupun konfigurasi calon.</div></section>';
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

  async function pickPhoto(input, role, index) {
    const file = input.files && input.files[0]; if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { alert('Gunakan foto JPG, PNG, atau WebP.'); input.value=''; return; }
    if (file.size > 8 * 1024 * 1024) { alert('Ukuran file awal maksimal 8 MB.'); input.value=''; return; }
    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Foto tidak dapat dibaca.'));
        reader.readAsDataURL(file);
      });
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Format foto tidak dapat diproses.'));
        img.src = source;
      });
      const scale = Math.min(1, 1100 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      let quality = 0.82;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > 650000 && quality > 0.45) {
        quality -= 0.08;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrl.length > 700000) throw new Error('Foto masih terlalu besar setelah kompresi.');
      if (!draftConfig) return;
      draftConfig.candidates[role][index].photo = dataUrl;
      const preview = $('#preview-' + role + '-' + index);
      if (preview) {
        if (preview.tagName === 'IMG') preview.src = dataUrl;
        else { const img = document.createElement('img'); img.id = preview.id; img.alt = 'Foto calon'; img.src = dataUrl; preview.replaceWith(img); }
      }
    } catch (error) {
      alert(error.message || 'Foto gagal diproses.');
      input.value = '';
    }
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

  async function deleteVoter(id) {
    const user = stats.users.find(item => item.id === id);
    if (!user) return;
    let message;
    if (user.votePending) {
      message = 'Akun ' + user.name + ' akan langsung dikunci dan semua sesi login dicabut. Jika transaksi suara selesai, tekan Hapus akun kembali agar penghapusan suara dan akun dituntaskan.';
    } else if (user.hasVoted && user.canDeleteVote) {
      message = 'Hapus akun ' + user.name + ' (' + user.username + ') sekaligus cabut surat suara yang terkait dari perhitungan hasil? Total suara akan berkurang satu. Tindakan dicatat pada audit admin dan tidak dapat dibatalkan.';
    } else if (user.hasVoted) {
      message = 'Akun ini sudah memilih sebelum fitur pencabutan suara tersedia. Surat suara lamanya tidak dapat dihubungkan kembali ke akun. Tutup pemilihan lalu gunakan Reset hasil untuk menghapus seluruh suara.';
    } else {
      message = 'Hapus permanen akun ' + user.name + ' (' + user.username + ')? Akun dan sesi login akan dihapus. Tindakan ini tidak dapat dibatalkan.';
    }
    if (user.hasVoted && !user.canDeleteVote) return feedback(message);
    if (!confirm(message)) return;
    try {
      const result = await api('/admin/users/delete', { method:'POST', body:JSON.stringify({id}) });
      await loadStats();
      renderTab('voters');
      if (result.deferred) {
        feedback('Akun langsung dikunci dan sesi dicabut. Tunggu transaksi selesai, lalu hapus kembali agar surat suara terkait ikut dicabut.', 'success');
      } else if (result.ballotDeleted) {
        feedback('Akun berhasil dihapus dan satu surat suara terkait telah dikeluarkan dari hasil.', 'success');
      } else {
        feedback('Akun pemilih berhasil dihapus.', 'success');
      }
    } catch (error) { feedback(error.message); }
  }

  async function archiveLegacy() {
    if (!confirm('Buat salinan arsip privat dari data trial lama? Data sumber tidak akan dihapus. Pada deploy preview, fitur ini memang dinonaktifkan.')) return;
    try {
      const result = await api('/admin/legacy-archive', { method:'POST', body:'{}' });
      feedback('Backup berhasil dibuat: ' + result.manifest.backupId + '. User: ' + result.manifest.userRecordsCopied + ', mapping username: ' + result.manifest.usernameMappingsCopied + ', voter-lock: ' + result.manifest.voterLockRecordsCopied + ', ballot: ' + result.manifest.ballotRecordsCopied + '. SHA-256: ' + result.manifest.sha256, 'success');
      await loadStats(); renderTab('settings');
    } catch (error) { feedback(error.message); }
  }

  async function migrateProductionData() {
    if (!confirm('Salin semua data dari namespace Preview ke namespace Production? Data sumber Preview tidak akan dihapus. Proses akan dibatalkan jika menemukan konflik atau transaksi tertunda.')) return;
    try {
      const result = await api('/admin/migrate-production', { method:'POST', body:'{}' });
      await loadStats(); renderTab('settings');
      feedback('Salinan data terverifikasi. Total record: ' + result.totalRecordsCopied + '. Rincian: ' + JSON.stringify(result.copied) + '. SHA-256: ' + result.sha256 + '. Data sumber tidak dihapus. Langkah berikutnya: ubah EVOTING_STORE_NAMESPACE pada konteks Production menjadi production, lalu deploy ulang.', 'success');
    } catch (error) { feedback(error.message); }
  }

  async function resetElection() {
    if (stats.deployContext !== 'production') return feedback('Reset hanya tersedia pada website Production.');
    if (stats.config.status !== 'closed') return feedback('Pemilihan harus berstatus DITUTUP sebelum reset.');
    if (!confirm('RESET PERMANEN: seluruh surat suara, transaksi tertunda, dan status partisipasi akan dihapus sekarang. Tidak perlu menunggu seluruh akun memilih. Akun pemilih, data calon, dan riwayat audit tetap dipertahankan. Tindakan ini tidak dapat dibatalkan. Lanjutkan?')) return;
    try {
      const result = await api('/admin/reset-practice', { method:'POST', body:'{}' });
      await loadStats();
      renderTab('settings');
      feedback('Reset selesai. Surat suara dihapus: ' + result.ballotRecordsDeleted + '. Transaksi tertunda dihapus: ' + result.pendingRecordsDeleted + '. Status partisipasi dihapus: ' + result.participationRecordsDeleted + '. Akun pemilih dan data calon tetap tersimpan.', 'success');
    } catch (error) { feedback(error.message); }
  }

  async function changePassword() {
    const oldPassword = $('#oldAdminPassword').value; const newPassword = $('#newAdminPassword').value;
    if (!newPassword || newPassword.length < 12) return feedback('Password baru minimal 12 karakter.');
    try {
      await api('/admin/password', { method:'POST', body:JSON.stringify({oldPassword,newPassword}) });
      window.location.href = '/admin';
    } catch (error) { feedback(error.message); }
  }

  async function recoverAdminPassword(event) {
    event.preventDefault();
    const bootstrapPassword = $('#adminBootstrapCode').value;
    const newPassword = $('#adminRecoveryPassword').value;
    const confirmPassword = $('#adminRecoveryConfirm').value;
    if (newPassword.length < 12) return feedback('Password baru minimal 12 karakter.', 'error', '#adminRecoveryFeedback');
    if (newPassword !== confirmPassword) return feedback('Konfirmasi password tidak sama.', 'error', '#adminRecoveryFeedback');
    const button = $('#adminRecoveryButton');
    button.disabled = true; button.textContent = 'Memperbarui password...';
    try {
      await api('/admin/recover', { method:'POST', body:JSON.stringify({bootstrapPassword,newPassword}) });
      $('#adminRecoveryForm').classList.add('hidden');
      $('#adminLoginForm').classList.remove('hidden');
      $('#adminRecoveryForm').reset();
      feedback('Password admin berhasil diperbarui. Silakan masuk menggunakan password baru.', 'success', '#adminLoginFeedback');
    } catch (error) {
      feedback(error.message, 'error', '#adminRecoveryFeedback');
    } finally {
      button.disabled = false; button.innerHTML = 'Perbarui password <span>→</span>';
    }
  }

  async function checkBootstrapStatus() {
    try {
      const status = await api('/admin/setup-status');
      if (status.setupRequired && !status.bootstrapConfigured) {
        feedback('Project belum memiliki ADMIN_BOOTSTRAP_PASSWORD. Atur satu variabel tersebut di Environment variables Netlify, lalu deploy ulang.', 'error', '#adminLoginFeedback');
      }
    } catch (error) {
      feedback('Tidak dapat memeriksa status autentikasi: ' + error.message, 'error', '#adminLoginFeedback');
    }
  }

  function exportCsv() {
    if (!stats || stats.setupRequired || !stats.resultsVisible) return;
    const rows = [['JENIS','NOMOR','NAMA CALON','JUMLAH SUARA'],
      ...stats.config.candidates.ketua.map(candidate => ['Ketua',candidate.number,candidate.name,stats.chairCounts[candidate.id]||0]),
      ...stats.config.candidates.wakil.map(candidate => ['Wakil',candidate.number,candidate.name,stats.viceCounts[candidate.id]||0]),
      [],['DAFTAR PARTISIPASI'],['NAMA PEMILIH','USERNAME','STATUS','WAKTU']];
    stats.users.forEach(user => rows.push([user.name,user.username,!user.active?'Dinonaktifkan':user.votePending?'Sedang diproses':user.hasVoted?'Sudah memilih':'Belum memilih',user.votedAt?new Date(user.votedAt).toLocaleString('id-ID'):'']));
    const csv = rows.map(row => row.map(value => '"' + String(value == null ? '' : value).replace(/"/g,'""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href=url; link.download='rekap-evoting-dpt-v2.csv'; link.click(); URL.revokeObjectURL(url);
  }

  async function logout() {
    try { await api('/admin/logout', {method:'POST',body:'{}'}); } catch (_) {}
    window.location.href='/admin';
  }

  function init() {
    $('#adminLoginForm').addEventListener('submit', login);
    $('#adminRecoveryForm').addEventListener('submit', recoverAdminPassword);
    $('#showRecoveryButton').addEventListener('click', () => {
      $('#adminLoginForm').classList.add('hidden');
      $('#adminRecoveryForm').classList.remove('hidden');
      feedback('', 'error', '#adminRecoveryFeedback');
    });
    $('#hideRecoveryButton').addEventListener('click', () => {
      $('#adminRecoveryForm').classList.add('hidden');
      $('#adminLoginForm').classList.remove('hidden');
    });
    $('#logoutButton').addEventListener('click', logout);
    document.querySelectorAll('.admin-nav button').forEach(button => button.addEventListener('click', () => renderTab(button.dataset.tab)));
    checkBootstrapStatus();
    loadStats().catch(() => {});
  }

  window.EvotingAdmin = {openTab:renderTab,saveConfig,pickPhoto,addVoter,bulkImport,editUser,deactivateUser,activateUser,deleteVoter,archiveLegacy,migrateProductionData,resetElection,changePassword,exportCsv,filterVoters:renderVoterRows};
  init();
})();
(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let config = null;
  let currentUser = null;
  let selectedChair = '';
  let selectedVice = '';
  let sending = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
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

  function notice(message, kind = 'info') {
    const el = $('#systemNotice');
    el.textContent = message;
    el.className = 'notice' + (kind === 'error' ? ' error' : '');
  }

  function feedback(id, message, kind = 'error') {
    const el = $(id);
    el.textContent = message || '';
    el.style.color = kind === 'success' ? '#69d6a3' : '';
  }

  function statusMessage(message) {
    $('#voterState').textContent = message;
    $('#voterState').classList.toggle('hidden', !message);
  }

  function showView(view) {
    ['#loginView', '#ballotView', '#doneView'].forEach(id => $(id).classList.add('hidden'));
    $(view).classList.remove('hidden');
  }

  function candidateCard(candidate, role, selectedId) {
    const selected = candidate.id === selectedId;
    const photo = candidate.photo
      ? '<img src="' + esc(candidate.photo) + '" alt="Foto ' + esc(candidate.name) + '">'
      : '<div class="candidate-photo-fallback" aria-hidden="true">' + esc(candidate.number) + '</div>';
    return '<button class="candidate-card' + (selected ? ' selected' : '') + '" type="button" data-role="' + role + '" data-id="' + esc(candidate.id) + '" aria-pressed="' + selected + '">' +
      photo +
      '<span class="candidate-info"><span class="candidate-number">NOMOR URUT ' + esc(candidate.number) + '</span>' +
      '<strong>' + esc(candidate.name || 'Nama calon belum diatur') + '</strong>' +
      '<span class="choose-state">' + (selected ? 'Pilihan Anda' : 'Pilih calon ini') + '</span></span></button>';
  }

  function renderCandidates() {
    if (!config) return;
    $('#chairGrid').innerHTML = config.candidates.ketua.map(candidate => candidateCard(candidate, 'ketua', selectedChair)).join('');
    $('#viceGrid').innerHTML = config.candidates.wakil.map(candidate => candidateCard(candidate, 'wakil', selectedVice)).join('');
    $('#reviewButton').disabled = !selectedChair || !selectedVice || sending;
  }

  function findCandidate(role, id) {
    return (config.candidates[role] || []).find(candidate => candidate.id === id);
  }

  function showDone() {
    showView('#doneView');
    $('#confirmModal').classList.add('hidden');
    sessionStorage.removeItem('evoting-v2-submit-key:' + (currentUser?.username || ''));
  }

  async function loadElection() {
    config = await api('/election');
    $('#electionHeading').textContent = config.title || 'Pemilihan Ketua dan Wakil Ketua DPT';
    $('#electionSubheading').textContent = (config.institution || '') + ' · Periode ' + (config.period || '');
    if (config.setupRequired) {
      notice('Sistem pemungutan suara belum terhubung ke database. Panitia belum dapat membuka pemilihan.', 'error');
    } else if (config.status === 'open') {
      notice('Pemungutan suara dibuka. Pilih satu calon Ketua dan satu calon Wakil.');
    } else if (config.status === 'closed') {
      notice('Pemungutan suara telah ditutup.');
    } else {
      notice('Pemungutan suara belum dimulai. Silakan menunggu pengumuman panitia.');
    }
  }

  async function loadMe() {
    const result = await api('/me');
    if (!result.loggedIn) return false;
    currentUser = result.user;
    $('#welcomeName').textContent = currentUser.name;
    $('#welcomeUsername').textContent = 'Username: ' + currentUser.username;
    showView('#ballotView');

    if (result.setupRequired || currentUser.hasVoted === null) {
      statusMessage('Database pemilihan belum siap. Hak suara belum dapat dikirim.');
      $('#chairGrid').innerHTML = '';
      $('#viceGrid').innerHTML = '';
      $('#reviewButton').disabled = true;
      return true;
    }
    if (currentUser.hasVoted) {
      showDone();
      return true;
    }
    if (config.status !== 'open') {
      statusMessage(config.status === 'closed'
        ? 'Pemungutan suara telah ditutup. Anda tidak dapat mengirim suara.'
        : 'Pemungutan suara belum dibuka. Pilihan akan tersedia setelah panitia membuka sistem.');
      $('#chairGrid').innerHTML = '';
      $('#viceGrid').innerHTML = '';
      $('#reviewButton').disabled = true;
      return true;
    }
    statusMessage('Pilih tepat satu calon Ketua dan satu calon Wakil Ketua.');
    renderCandidates();
    return true;
  }

  async function login(event) {
    event.preventDefault();
    feedback('#loginFeedback', '');
    const button = $('#loginButton');
    button.disabled = true;
    button.textContent = 'Memeriksa akun...';
    try {
      await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#voterUsername').value.trim(),
          password: $('#voterPassword').value
        })
      });
      $('#voterPassword').value = '';
      await loadElection();
      await loadMe();
    } catch (error) {
      feedback('#loginFeedback', error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = 'Masuk ke pemilihan <span>→</span>';
    }
  }

  function chooseCandidate(role, id) {
    if (sending || !config || config.status !== 'open') return;
    if (role === 'ketua') selectedChair = id;
    if (role === 'wakil') selectedVice = id;
    renderCandidates();
  }

  function reviewSelection() {
    if (!selectedChair || !selectedVice) return;
    const chair = findCandidate('ketua', selectedChair);
    const vice = findCandidate('wakil', selectedVice);
    if (!chair || !vice) return;
    $('#confirmSummary').innerHTML =
      '<div class="summary-row"><span>CALON KETUA · NOMOR ' + esc(chair.number) + '</span><b>' + esc(chair.name) + '</b></div>' +
      '<div class="summary-row"><span>CALON WAKIL KETUA · NOMOR ' + esc(vice.number) + '</span><b>' + esc(vice.name) + '</b></div>';
    $('#agree').checked = false;
    $('#sendVote').disabled = true;
    feedback('#voteError', '');
    $('#confirmModal').classList.remove('hidden');
  }

  function getSubmissionKey() {
    const storageKey = 'evoting-v2-submit-key:' + (currentUser?.username || 'unknown');
    let key = sessionStorage.getItem(storageKey);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
    }
    return key;
  }

  async function submitVote() {
    if (sending || !selectedChair || !selectedVice || !$('#agree').checked) return;
    sending = true;
    const button = $('#sendVote');
    button.disabled = true;
    button.textContent = 'Mengirim suara...';
    feedback('#voteError', '');
    try {
      await api('/vote', {
        method: 'POST',
        body: JSON.stringify({
          chairCandidateId: selectedChair,
          viceCandidateId: selectedVice,
          idempotencyKey: getSubmissionKey()
        })
      });
      showDone();
    } catch (error) {
      feedback('#voteError', error.message);
      try {
        const me = await api('/me');
        if (me.loggedIn && me.user.hasVoted) showDone();
      } catch (_) {}
    } finally {
      sending = false;
      if (!$('#doneView').classList.contains('hidden')) return;
      button.disabled = !$('#agree').checked;
      button.innerHTML = 'Kirim suara <span>→</span>';
    }
  }

  async function logout() {
    try { await api('/logout', { method: 'POST', body: '{}' }); } catch (_) {}
    currentUser = null;
    selectedChair = '';
    selectedVice = '';
    $('#voterUsername').value = '';
    $('#voterPassword').value = '';
    showView('#loginView');
    notice('Anda telah keluar dari sesi pemilihan.');
  }

  function init() {
    $('#loginForm').addEventListener('submit', login);
    $('#chairGrid').addEventListener('click', event => {
      const card = event.target.closest('[data-role="ketua"]');
      if (card) chooseCandidate('ketua', card.dataset.id);
    });
    $('#viceGrid').addEventListener('click', event => {
      const card = event.target.closest('[data-role="wakil"]');
      if (card) chooseCandidate('wakil', card.dataset.id);
    });
    $('#reviewButton').addEventListener('click', reviewSelection);
    $('#agree').addEventListener('change', event => {
      $('#sendVote').disabled = !event.target.checked || sending;
    });
    $('#sendVote').addEventListener('click', submitVote);
    $('#closeModal').addEventListener('click', () => $('#confirmModal').classList.add('hidden'));
    $('#changeSelection').addEventListener('click', () => $('#confirmModal').classList.add('hidden'));
    $('#confirmModal').addEventListener('click', event => {
      if (event.target === $('#confirmModal')) $('#confirmModal').classList.add('hidden');
    });
    $('#logoutButton').addEventListener('click', logout);
    $('#doneLogoutButton').addEventListener('click', logout);

    loadElection().then(async () => {
      try {
        const loggedIn = await loadMe();
        if (!loggedIn) showView('#loginView');
      } catch (error) {
        notice(error.message, 'error');
      }
    }).catch(error => {
      notice('Tidak dapat menghubungi server pemilihan: ' + error.message, 'error');
    });
  }

  init();
})();
(function () {
  'use strict';
  var API = '/api';
  var config = null;
  var selectedId = null;
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

  function feedback(id, message, type) {
    var target = document.getElementById(id);
    if (!target) return;
    target.innerHTML = message ? '<div class="toast ' + (type || 'error') + '">' + esc(message) + '</div>' : '';
  }

  function fallbackPhoto(id, role) {
    var n = String(id) === '02' ? '2' : '1';
    return '/assets/paslon' + n + '-' + role + '.jpg';
  }

  function setElectionStatus() {
    var status = config && config.status ? config.status : 'scheduled';
    var chip = $('#siteStatus');
    if (!chip) return;
    chip.className = 'status-chip ' + (status === 'open' ? 'open' : status === 'closed' ? 'closed' : '');
    chip.textContent = status === 'open' ? 'PEMILIHAN DIBUKA' : status === 'closed' ? 'PEMILIHAN DITUTUP' : 'BELUM DIMULAI';
    if ($('#electionHeading')) $('#electionHeading').textContent = config.title || 'Pilih pasangan calon';
    if ($('#electionSubheading')) $('#electionSubheading').textContent = (config.institution || 'Politeknik Agraria STPN') + ' • Periode ' + (config.period || '2026–2027');
  }

  function photoCard(src, label, role) {
    return '<div class="person-card"><img src="' + esc(src) + '" alt="' + esc(label) + '" loading="lazy"><div class="person-caption"><small>' + esc(role) + '</small><strong>' + esc(label) + '</strong></div></div>';
  }

  function candidateCard(candidate) {
    var id = String(candidate.id || '');
    var ketuaPhoto = candidate.photoKetua || fallbackPhoto(id, 'ketua');
    var wakilPhoto = candidate.photoWakil || fallbackPhoto(id, 'wakil');
    var disabled = config.status !== 'open' ? ' disabled' : '';
    var html = '<article class="candidate-card">';
    html += '<div class="candidate-top"><div class="candidate-number">' + esc(id) + '</div><div class="candidate-label">PASANGAN CALON ' + esc(id) + '</div></div>';
    html += '<div class="people-grid">';
    html += photoCard(ketuaPhoto, candidate.ketua || 'Calon Ketua', 'CALON KETUA');
    html += photoCard(wakilPhoto, candidate.wakil || 'Calon Wakil Ketua', 'CALON WAKIL KETUA');
    html += '</div>';
    html += '<div class="candidate-copy">';
    html += '<div><span class="eyebrow">VISI</span><p>' + esc(candidate.visi || 'Visi belum diisi.') + '</p></div>';
    html += '<div><span class="eyebrow">MISI</span><p>' + esc(candidate.misi || 'Misi belum diisi.').replace(/\r?\n/g, '<br>') + '</p></div>';
    html += '<blockquote>“' + esc(candidate.slogan || 'Bersama membangun DPT.') + '”</blockquote>';
    html += '</div>';
    html += '<button class="btn btn-gold btn-vote" type="button" onclick="window.Evoting.confirmVote(\'' + esc(id) + '\')"' + disabled + '>Pilih Paslon ' + esc(id) + ' <span>→</span></button>';
    html += '</article>';
    return html;
  }

  function showState(message, type) {
    var state = $('#voterState');
    if (!state) return;
    state.className = 'state-banner ' + (type || 'open');
    state.textContent = message;
  }

  function showVoter(user) {
    $('#loginView').classList.add('hidden');
    $('#doneView').classList.add('hidden');
    $('#ballotView').classList.remove('hidden');
    $('#welcomeName').textContent = user.name || 'Pemilih';
    $('#welcomeUsername').textContent = 'Username / NIT: ' + (user.username || '-');
    if (user.hasVoted) {
      showState('Hak suara akun ini sudah digunakan. Terima kasih telah berpartisipasi.', 'done');
      $('#candidateGrid').innerHTML = '';
      return;
    }
    if (config.status !== 'open') {
      showState(config.status === 'closed' ? 'Pemungutan suara telah ditutup.' : 'Pemungutan suara belum dimulai.', 'closed');
      $('#candidateGrid').innerHTML = '';
      return;
    }
    showState('Status hak suara: BELUM DIGUNAKAN. Silakan pelajari kedua pasangan calon.', 'open');
    $('#candidateGrid').innerHTML = (config.candidates || []).map(candidateCard).join('');
  }

  async function login(event) {
    event.preventDefault();
    feedback('loginFeedback', '');
    var button = $('#loginButton');
    button.disabled = true;
    button.textContent = 'Memeriksa akun...';
    try {
      var result = await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#voterUsername').value.trim(),
          password: $('#voterPassword').value
        })
      });
      $('#voterPassword').value = '';
      showVoter(result.user);
    } catch (error) {
      feedback('loginFeedback', error.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = 'Masuk ke pemilihan <span>→</span>';
    }
  }

  function confirmVote(id) {
    selectedId = String(id);
    var candidate = (config.candidates || []).find(function (item) { return String(item.id) === selectedId; });
    if (!candidate) return;

    $('#confirmText').innerHTML =
      '<div class="selection-number">PASLON ' + esc(candidate.id) + '</div>' +
      '<div class="selection-names"><span><small>CALON KETUA</small><b>' + esc(candidate.ketua || '-') + '</b></span>' +
      '<span><small>CALON WAKIL KETUA</small><b>' + esc(candidate.wakil || '-') + '</b></span></div>';

    $('#agree').checked = false;
    $('#sendVote').disabled = true;
    $('#sendVote').innerHTML = 'Kirim suara <span>→</span>';
    $('#voteError').textContent = '';
    $('#voteError').classList.add('hidden');
    $('#confirmModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
    $('#agree').focus();
  }

  function closeModal() {
    $('#confirmModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
    selectedId = null;
  }

  async function submitVote() {
    if (!selectedId || !$('#agree').checked) return;
    var button = $('#sendVote');
    button.disabled = true;
    button.textContent = 'Mengirim suara...';
    $('#voteError').textContent = '';
    $('#voteError').classList.add('hidden');
    try {
      await api('/vote', { method: 'POST', body: JSON.stringify({ candidateId: selectedId }) });
      $('#confirmModal').classList.add('hidden');
      document.body.classList.remove('modal-open');
      $('#ballotView').classList.add('hidden');
      $('#doneView').classList.remove('hidden');
      selectedId = null;
    } catch (error) {
      $('#voteError').textContent = error.message || 'Suara belum berhasil dikirim. Silakan coba kembali.';
      $('#voteError').classList.remove('hidden');
      button.disabled = !$('#agree').checked;
      button.innerHTML = 'Coba kirim lagi <span>→</span>';
    }
  }

  async function voterLogout() {
    try { await api('/logout', { method: 'POST', body: '{}' }); } catch (error) {}
    window.location.reload();
  }

  async function init() {
    $('#loginForm').addEventListener('submit', login);
    $('#agree').addEventListener('change', function () {
      $('#sendVote').disabled = !this.checked;
      if (this.checked) $('#sendVote').innerHTML = 'Kirim suara <span>→</span>';
    });
    $('#confirmModal').addEventListener('click', function (event) {
      if (event.target === $('#confirmModal')) closeModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !$('#confirmModal').classList.contains('hidden')) closeModal();
    });
    config = await api('/election');
    setElectionStatus();
    var session = await api('/me');
    if (session.loggedIn && session.user) showVoter(session.user);
  }

  window.Evoting = {
    confirmVote: confirmVote,
    closeModal: closeModal,
    submitVote: submitVote,
    voterLogout: voterLogout
  };

  init().catch(function (error) {
    feedback('loginFeedback', 'Sistem belum dapat dimuat: ' + error.message, 'error');
    var chip = $('#siteStatus');
    if (chip) { chip.className = 'status-chip closed'; chip.textContent = 'GANGGUAN SISTEM'; }
  });
})();
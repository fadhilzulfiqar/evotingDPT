(function(){
  function installAdminV2(){
    const tableHead=document.querySelector('#pemilih thead tr');
    if(tableHead && !tableHead.querySelector('[data-action-col]')){
      const th=document.createElement('th');
      th.textContent='Aksi';
      th.setAttribute('data-action-col','1');
      tableHead.appendChild(th);
    }
    const titleRow=document.querySelector('#pemilih .section-title');
    if(titleRow && !document.querySelector('#resetPracticeBtn')){
      const btn=document.createElement('button');
      btn.id='resetPracticeBtn';
      btn.className='btn btn-danger';
      btn.textContent='RESET DATA LATIHAN';
      btn.onclick=resetPractice;
      titleRow.appendChild(btn);
    }
  }

  window.deleteUser=async function(id){
    const u=data?.users?.find(x=>x.id===id);
    if(!u)return;
    if(u.hasVoted){alert('Pemilih yang sudah memilih tidak bisa langsung dihapus. Gunakan Reset Data Latihan terlebih dahulu.');return;}
    if(!confirm(`Hapus pemilih ${u.name} (${u.username})?`))return;
    try{
      await api('/api/admin/users/delete',{method:'POST',body:JSON.stringify({id})});
      await loadStats();
      alert('Pemilih berhasil dihapus.');
    }catch(e){alert(e.message)}
  };

  window.resetPractice=async function(){
    if(!confirm('Reset latihan akan menghapus seluruh perolehan suara dan mengubah semua akun menjadi BELUM MEMILIH. Lanjutkan?'))return;
    if(!confirm('Konfirmasi sekali lagi: reset seluruh hasil latihan sekarang?'))return;
    try{
      await api('/api/admin/reset-practice',{method:'POST',body:'{}'});
      await loadStats();
      alert('Data latihan berhasil direset. Daftar pemilih tetap tersimpan.');
    }catch(e){alert(e.message)}
  };

  window.renderUsers=function(){
    if(!data)return;
    installAdminV2();
    const q=(document.querySelector('#searchUser')?.value||'').toLowerCase();
    const rows=data.users.filter(u=>(u.name+' '+u.username).toLowerCase().includes(q));
    document.querySelector('#userRows').innerHTML=rows.map((u,i)=>`<tr>
      <td>${i+1}</td>
      <td>${esc(u.name)}</td>
      <td>${esc(u.username)}</td>
      <td><span class="badge ${u.hasVoted?'open':''}">${u.hasVoted?'SUDAH MEMILIH':'BELUM MEMILIH'}</span></td>
      <td>${u.votedAt?new Date(u.votedAt).toLocaleString('id-ID'):'-'}</td>
      <td>${u.hasVoted?'<span class="mini">Terkunci</span>':`<button class="btn btn-danger" onclick="deleteUser('${u.id}')">Hapus</button>`}</td>
    </tr>`).join('');
  };

  installAdminV2();
  setTimeout(()=>{installAdminV2(); if(typeof data!=='undefined'&&data)renderUsers();},500);
})();

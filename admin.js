async function login(){
  const user=document.getElementById("user").value;
  const password=document.getElementById("password").value;
  const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user,password})});
  const d=await r.json();
  if(!r.ok){document.getElementById("loginMsg").textContent=d.error;return}
  document.getElementById("login").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  loadAll();
}

async function loadAll(){
  const s=await (await fetch("/api/admin/dashboard")).json();
  document.getElementById("stats").innerHTML=`
    <div class="stat-box"><small>Empresas cadastradas</small><strong>${s.empresas}</strong></div>
    <div class="stat-box"><small>Pendências em aberto</small><strong>${s.pendencias}</strong></div>
    <div class="stat-box"><small>Total pendente</small><strong>R$ ${s.total.replace(".",",")}</strong></div>`;
  const rows=await (await fetch("/api/admin/empresas")).json();
  document.getElementById("table").innerHTML=rows.map(x=>`
    <tr><td>${esc(x.cnpj)}</td><td>${esc(x.nome||"-")}</td><td>${esc(x.status||"-")}</td><td>${x.qtd_pendencias}</td><td>R$ ${x.total_pendente.replace(".",",")}</td></tr>`).join("");
}
document.getElementById("uploadForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const form=new FormData(e.target);
  const r=await fetch("/api/admin/importar",{method:"POST",body:form});
  const d=await r.json();
  const m=document.getElementById("uploadMsg");
  if(!r.ok){m.textContent=d.error;return}
  m.style.color="#15803d";m.textContent=`Importação concluída: ${d.importadas} registros processados.`;
  loadAll();
});
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

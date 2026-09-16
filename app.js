const form = document.getElementById("consultaForm");
const cnpjInput = document.getElementById("cnpj");
const msg = document.getElementById("msg");

cnpjInput.addEventListener("input", () => {
  let v = cnpjInput.value.replace(/\D/g, "").slice(0, 14);
  if (v.length > 12) v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/, "$1.$2.$3/$4-$5");
  else if (v.length > 8) v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4}).*/, "$1.$2.$3/$4");
  else if (v.length > 5) v = v.replace(/^(\d{2})(\d{3})(\d{0,3}).*/, "$1.$2.$3");
  else if (v.length > 2) v = v.replace(/^(\d{2})(\d{0,3}).*/, "$1.$2");
  cnpjInput.value = v;
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  msg.textContent = "Consultando...";
  const res = await fetch("/api/consulta", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({cnpj:cnpjInput.value})
  });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || "Erro na consulta."; return; }
  msg.textContent = "";
  renderResult(data);
});

function esc(s=""){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderResult(data){
  document.getElementById("resultado").classList.remove("hidden");
  document.getElementById("empresaCard").innerHTML = `
    <div><div class="label">Empresa</div><div class="big">${esc(data.empresa.nome || "Não informado")}</div><p>${esc(data.empresa.cidade || "")}</p></div>
    <div><div class="label">CNPJ</div><div class="big">${esc(data.empresa.cnpj)}</div></div>
    <div><div class="label">Situação</div><p><span class="status">${esc(data.empresa.status || "Ativo")}</span></p></div>
  `;
  const area = document.getElementById("pendencias");
  if (!data.pendencias.length) {
    area.innerHTML = `<div class="company-card"><b>Nenhuma pendência cadastrada na demonstração.</b></div>`;
  } else {
    area.innerHTML = `<div class="pend-grid">${data.pendencias.map(p => `
      <article class="pend-card">
        <div class="label">Competência</div><h3>${esc(p.competencia)}</h3>
        <p>Valor: <b>R$ ${Number(p.valor).toFixed(2).replace(".", ",")}</b></p>
        <p>Vencimento: ${esc(p.vencimento || "-")}</p>
        <p>Situação: <b>${esc(p.situacao)}</b></p>
        ${p.situacao !== "Pago" ? `<button class="button" onclick="openPayment(${p.id})">Regularizar</button>` : ""}
      </article>`).join("")}</div>`;
  }
  document.getElementById("resultado").scrollIntoView({behavior:"smooth"});
}

async function openPayment(id){
  const res = await fetch("/api/pagamento", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pendenciaId:id})});
  const p = await res.json();
  if (!res.ok) return alert(p.error);
  document.getElementById("payment").innerHTML = `
    <div class="pix">
      <div class="label">Beneficiário</div><h3>${esc(p.beneficiario)}</h3>
      <p><b>Pagador:</b> ${esc(p.pagador)}</p>
      <p><b>Valor:</b> R$ ${p.valor.replace(".", ",")} &nbsp; <b>Vencimento:</b> ${esc(p.vencimento || "-")}</p>
      <img src="${p.qrCode}" alt="QR Code PIX de demonstração">
      <p class="label">Código PIX demonstrativo</p>
      <div id="pixCode" class="pix-code">${esc(p.pix)}</div>
      <button class="button copy" onclick="copyPix()">Copiar código PIX</button>
      <p><small>Este QR Code é exclusivamente demonstrativo e não realiza cobrança real.</small></p>
    </div>`;
  document.getElementById("paymentModal").classList.remove("hidden");
}
function copyPix(){
  navigator.clipboard.writeText(document.getElementById("pixCode").innerText);
  alert("Código copiado.");
}
function closeModal(){document.getElementById("paymentModal").classList.add("hidden")}

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const XLSX = require("xlsx");
const QRCode = require("qrcode");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const db = new Database(path.join(__dirname, "cnpj360.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj TEXT UNIQUE NOT NULL,
  nome TEXT,
  cpf TEXT,
  telefone TEXT,
  email TEXT,
  cidade TEXT,
  status TEXT DEFAULT 'Ativo'
);

CREATE TABLE IF NOT EXISTS pendencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  competencia TEXT NOT NULL,
  valor REAL DEFAULT 0,
  vencimento TEXT,
  situacao TEXT DEFAULT 'Pendente',
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  UNIQUE(empresa_id, competencia)
);
`);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

function cleanCnpj(value = "") {
  return String(value).replace(/\D/g, "");
}

function validCnpj(value) {
  const cnpj = cleanCnpj(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  let sum = 0, pos = 5;
  for (let i = 0; i < 12; i++) {
    sum += Number(cnpj[i]) * pos--;
    if (pos < 2) pos = 9;
  }
  let digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (digit !== Number(cnpj[12])) return false;

  sum = 0; pos = 6;
  for (let i = 0; i < 13; i++) {
    sum += Number(cnpj[i]) * pos--;
    if (pos < 2) pos = 9;
  }
  digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return digit === Number(cnpj[13]);
}

function money(v) {
  return Number(v || 0).toFixed(2);
}

function normalizeHeader(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findColumn(row, names) {
  const keys = Object.keys(row);
  for (const wanted of names) {
    const found = keys.find(k => normalizeHeader(k) === normalizeHeader(wanted));
    if (found) return row[found];
  }
  return "";
}

// Consulta pública
app.post("/api/consulta", (req, res) => {
  const cnpj = cleanCnpj(req.body.cnpj);
  if (!validCnpj(cnpj)) {
    return res.status(400).json({ error: "CNPJ inválido. Use um CNPJ válido de 14 dígitos." });
  }

  const empresa = db.prepare("SELECT * FROM empresas WHERE cnpj = ?").get(cnpj);
  if (!empresa) return res.status(404).json({ error: "CNPJ não encontrado na base de demonstração." });

  const pendencias = db.prepare(`
    SELECT id, competencia, valor, vencimento, situacao
    FROM pendencias
    WHERE empresa_id = ?
    ORDER BY competencia
  `).all(empresa.id);

  res.json({ empresa, pendencias });
});

// Gerar pagamento demonstrativo
app.post("/api/pagamento", async (req, res) => {
  const { pendenciaId } = req.body;
  const p = db.prepare(`
    SELECT p.*, e.cnpj, e.nome
    FROM pendencias p
    JOIN empresas e ON e.id = p.empresa_id
    WHERE p.id = ?
  `).get(pendenciaId);

  if (!p) return res.status(404).json({ error: "Pendência não encontrada." });

  const valor = money(p.valor);
  const pix = `DEMO-CNPJ360|CNPJ=${p.cnpj}|VALOR=${valor}|COMP=${p.competencia}`;
  const qr = await QRCode.toDataURL(pix);

  res.json({
    beneficiario: "CNPJ360 - DEMONSTRAÇÃO ACADÊMICA",
    cnpj: p.cnpj,
    pagador: p.nome,
    valor,
    vencimento: p.vencimento,
    competencia: p.competencia,
    pix,
    qrCode: qr
  });
});

// Login administrativo simples para demonstração
app.post("/api/admin/login", (req, res) => {
  const { user, password } = req.body;
  if (user === ADMIN_USER && password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Usuário ou senha inválidos." });
});

// Dashboard
app.get("/api/admin/dashboard", (req, res) => {
  const empresas = db.prepare("SELECT COUNT(*) AS n FROM empresas").get().n;
  const pendencias = db.prepare("SELECT COUNT(*) AS n FROM pendencias WHERE situacao != 'Pago'").get().n;
  const total = db.prepare("SELECT COALESCE(SUM(valor),0) AS n FROM pendencias WHERE situacao != 'Pago'").get().n;
  res.json({ empresas, pendencias, total: money(total) });
});

// Lista administrativa
app.get("/api/admin/empresas", (req, res) => {
  const rows = db.prepare(`
    SELECT e.*,
      COUNT(p.id) AS qtd_pendencias,
      COALESCE(SUM(CASE WHEN p.situacao != 'Pago' THEN p.valor ELSE 0 END),0) AS total_pendente
    FROM empresas e
    LEFT JOIN pendencias p ON p.empresa_id = e.id
    GROUP BY e.id
    ORDER BY e.nome
  `).all();

  res.json(rows.map(r => ({ ...r, total_pendente: money(r.total_pendente) })));
});

// Importar Excel
app.post("/api/admin/importar", upload.single("arquivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Envie um arquivo Excel." });

  try {
    const workbook = XLSX.readFile(req.file.path, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const upsertEmpresa = db.prepare(`
      INSERT INTO empresas (cnpj, nome, cpf, telefone, email, cidade, status)
      VALUES (@cnpj, @nome, @cpf, @telefone, @email, @cidade, @status)
      ON CONFLICT(cnpj) DO UPDATE SET
        nome=excluded.nome,
        cpf=excluded.cpf,
        telefone=excluded.telefone,
        email=excluded.email,
        cidade=excluded.cidade,
        status=excluded.status
    `);

    const getEmpresa = db.prepare("SELECT id FROM empresas WHERE cnpj = ?");
    const upsertPendencia = db.prepare(`
      INSERT INTO pendencias (empresa_id, competencia, valor, vencimento, situacao)
      VALUES (@empresa_id, @competencia, @valor, @vencimento, @situacao)
      ON CONFLICT(empresa_id, competencia) DO UPDATE SET
        valor=excluded.valor,
        vencimento=excluded.vencimento,
        situacao=excluded.situacao
    `);

    let importadas = 0;
    const tx = db.transaction(() => {
      for (const row of rows) {
        const cnpj = cleanCnpj(findColumn(row, ["CNPJ"]));
        if (!validCnpj(cnpj)) continue;

        upsertEmpresa.run({
          cnpj,
          nome: findColumn(row, ["Nome", "Razao Social", "Razão Social", "Nome Fantasia"]),
          cpf: findColumn(row, ["CPF"]),
          telefone: findColumn(row, ["Telefone", "Celular"]),
          email: findColumn(row, ["Email", "E-mail"]),
          cidade: findColumn(row, ["Cidade", "Municipio", "Município"]),
          status: findColumn(row, ["Status", "Situacao", "Situação"]) || "Ativo"
        });

        const empresa = getEmpresa.get(cnpj);
        const competencia = findColumn(row, ["Competencia", "Competência", "Periodo", "Período"]);
        if (competencia) {
          const rawValue = findColumn(row, ["Valor", "Valor Total", "Valor Total R$"]);
          const valor = Number(String(rawValue).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
          upsertPendencia.run({
            empresa_id: empresa.id,
            competencia: String(competencia),
            valor,
            vencimento: findColumn(row, ["Vencimento", "Data de Vencimento"]),
            situacao: findColumn(row, ["Situacao", "Situação"]) || "Pendente"
          });
        }
        importadas++;
      }
    });
    tx();

    fs.unlinkSync(req.file.path);
    res.json({ ok: true, importadas });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: "Não foi possível processar a planilha: " + err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`CNPJ360 rodando em http://localhost:${PORT}`);
});

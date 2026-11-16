import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const publicRoot = path.join(here, "public");
const runRoot = path.join(here, "data", "runs");
const exportRoot = path.join(projectRoot, "outputs", "pet-lead-hunt");
const headquartersRoot = path.resolve(projectRoot, "..", "CEO助理", "agent-command-center");
const companyRoot = path.resolve(headquartersRoot, "..");
const configPath = path.join(here, "workflow.json");
const host = "127.0.0.1";
const port = Number(process.env.PET_LEAD_HUNT_PORT || 4179);
const bodyLimit = 1024 * 1024;
const runLocks = new Set();
const queuedRuns = new Set();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const stageAgents = {
  hq_intake: "hq",
  research: "e03-buyer-researcher",
  score: "e08-customer-grader",
  draft: "e05-outreach-writer",
  archive: "e09-crm-archivist"
};

const stagePrompts = {
  hq_intake: path.join(here, "prompts", "hq-intake.md"),
  research: path.join(here, "prompts", "research.md"),
  score: path.join(here, "prompts", "score.md"),
  draft: path.join(here, "prompts", "draft.md"),
  archive: path.join(here, "prompts", "archive.md")
};

const stageSchemas = {
  hq_intake: path.join(here, "schemas", "hq-intake.schema.json"),
  research: path.join(here, "schemas", "research.schema.json"),
  score: path.join(here, "schemas", "score.schema.json"),
  draft: path.join(here, "schemas", "draft.schema.json"),
  archive: path.join(here, "schemas", "archive.schema.json")
};

const roleFiles = {
  hq: path.join(headquartersRoot, "agents", "main", "agent-spec.md"),
  "e03-buyer-researcher": path.join(headquartersRoot, "agents", "employees", "e03-buyer-researcher", "agent-spec.md"),
  "e08-customer-grader": path.join(headquartersRoot, "agents", "employees", "e08-customer-grader", "agent-spec.md"),
  "e05-outreach-writer": path.join(headquartersRoot, "agents", "employees", "e05-outreach-writer", "agent-spec.md"),
  "e09-crm-archivist": path.join(headquartersRoot, "agents", "employees", "e09-crm-archivist", "agent-spec.md")
};

const projectSkillRoot = path.join(projectRoot, ".agents", "skills", "domestic-overseas-customer-development");
const projectSkillFiles = [
  path.join(projectSkillRoot, "SKILL.md"),
  path.join(projectSkillRoot, "references", "domestic-and-overseas-sourcing.md"),
  path.join(projectSkillRoot, "references", "evidence-and-lead-record.md"),
  path.join(projectSkillRoot, "references", "outreach-and-sales-followup.md")
];
const sharedFiles = {
  hqMasterPrompt: path.join(companyRoot, "ceo-ai-executive-assistant", "master-prompt.md"),
  hqRouterSkill: path.join(companyRoot, "ceo-assistant-unified-router", "SKILL.md"),
  hqMasterRouterPrompt: path.join(companyRoot, "ceo-assistant-unified-router", "prompts", "master-router-prompt.md"),
  hqRouteBuyerBackground: path.join(companyRoot, "ceo-assistant-unified-router", "prompts", "routes", "buyer-background.md"),
  hqRouteConfig: path.join(companyRoot, "ceo-assistant-unified-router", "config", "routes.yaml"),
  hqInputSchema: path.join(companyRoot, "ceo-assistant-unified-router", "schemas", "input-fields.yaml"),
  hqOutputSchema: path.join(companyRoot, "ceo-assistant-unified-router", "schemas", "output-formats.yaml"),
  salesCenterSpec: path.join(headquartersRoot, "agents", "departments", "sales-center", "agent-spec.md"),
  businessProfile: path.join(headquartersRoot, "knowledge", "shared", "business-profile.md"),
  productCatalogIndex: path.join(headquartersRoot, "knowledge", "shared", "product-catalog-index.md"),
  customerDbContract: path.join(headquartersRoot, "knowledge", "shared", "customer-db-contract.md"),
  skillBindings: path.join(headquartersRoot, "config", "skill-bindings.json"),
  petProductFacts: path.join(companyRoot, "social-outreach-control-tower", "knowledge", "pet-product-facts.json"),
  firstContact: path.join(companyRoot, "social-outreach-control-tower", "prompts", "first-contact.md")
};

const roleSkillFilters = {
  hq_intake: [],
  research: ["pet-buyer-research-analyst", "trade-buyer-segmentation"],
  score: ["pet-buyer-risk-scorer", "trade-buyer-segmentation"],
  draft: ["trade-prospecting-and-icebreak"],
  archive: ["trade-sales-lifecycle-orchestrator"]
};

function nowIso() {
  return new Date().toISOString();
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function runFile(id) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return null;
  return path.join(runRoot, `${id}.json`);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadConfig() {
  return readJson(configPath);
}

function jsonResponse(res, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(data);
}

function safeLog(run, message, level = "info") {
  run.activity ??= [];
  run.activity.push({ at: nowIso(), level, message: String(message).slice(0, 500) });
  if (run.activity.length > 80) run.activity = run.activity.slice(-80);
}

function updateStage(run, id, status, detail = "") {
  const stage = run.stages.find((item) => item.id === id);
  if (!stage) return;
  const time = nowIso();
  stage.status = status;
  stage.detail = detail;
  if (status === "running") stage.started_at = time;
  if (["done", "blocked", "failed", "skipped"].includes(status)) stage.finished_at = time;
  setProgress(run);
}

async function saveRun(run) {
  run.updated_at = nowIso();
  await writeJson(runFile(run.id), run);
}

async function listRuns() {
  await fs.mkdir(runRoot, { recursive: true });
  const files = (await fs.readdir(runRoot)).filter((name) => /^PLH-[A-Za-z0-9_-]+\.json$/.test(name));
  const runs = [];
  for (const file of files) {
    try { runs.push(await readJson(path.join(runRoot, file))); } catch { /* Ignore incomplete state files. */ }
  }
  return runs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 40);
}

function csvCell(value) {
  let text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function makeCsv(headers, rows) {
  return `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function columnName(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function leadRows(run) {
  return (run.leads || []).map((lead) => {
    const contact = (lead.contacts || [])[0] || {};
    const score = lead.score || {};
    const draft = lead.draft || {};
    const crm = lead.crm_record || {};
    return [
      lead.lead_id, lead.company, lead.country, lead.market_region, lead.product_family, lead.customer_type,
      lead.website, lead.identity_status, lead.summary, lead.fit_reason,
      contact.name || "", contact.role || "", contact.role_status || "未知", contact.email || "",
      contact.email_status || "未知", contact.whatsapp || "", contact.whatsapp_status || "未知",
      contact.linkedin || "", contact.official_business_route || "", score.total_score ?? "",
      score.tier || "", score.confidence ?? "", score.big_fish || "", score.product_family_fit_basis || lead.fit_reason || "", score.reason || "",
      (score.risk_flags || []).join("；"), draft.eligibility || "无草稿", draft.channel || "none",
      draft.subject || "", draft.body || "", draft.chinese_purpose || "", draft.product_summary || "",
      crm.stage || "prospecting_review", crm.next_action || "人工复核联系人与草稿", crm.next_due_at || "unknown",
      (lead.sources || []).map((source) => `${source.title}: ${source.url}`).join("\n"),
      (lead.facts || []).join("；"), (lead.inferences || []).join("；"), (lead.unknowns || []).join("；")
    ];
  });
}

const leadHeaders = [
  "Lead ID", "公司", "国家", "市场区域", "产品族", "客户类型", "官网", "企业身份状态", "公司简介", "匹配依据",
  "联系人", "职位", "职位核验", "邮箱", "邮箱核验", "WhatsApp", "WhatsApp核验", "LinkedIn", "官方业务入口",
  "总分", "等级", "评分置信度", "大客户潜力", "品类匹配评分依据", "评级依据", "风险", "草稿状态", "渠道", "主题", "英文草稿",
  "中文目的", "非报价产品摘要", "CRM阶段", "下一步", "下一日期", "来源", "事实", "推断", "未知"
];

async function exportWorkbook(run, filePath) {
  const { SpreadsheetFile, Workbook } = await import("@oai/artifact-tool");
  const workbook = Workbook.create();
  const overview = workbook.worksheets.add("运行总览");
  const leadsSheet = workbook.worksheets.add("潜客审核");
  const evidenceSheet = workbook.worksheets.add("来源证据");
  const draftsSheet = workbook.worksheets.add("开发草稿");
  const palette = { dark: "#172C4D", teal: "#1C827D", orange: "#E86632", pale: "#F2F6FA", ink: "#26354A" };
  for (const sheet of [overview, leadsSheet, evidenceSheet, draftsSheet]) sheet.showGridLines = false;

  overview.getRange("A1:F1").merge();
  overview.getRange("A1").values = [[" B2B 获客试跑｜本地人工复核版"]];
  overview.getRange("A1:F1").format = { fill: palette.dark, font: { bold: true, size: 17, color: "#FFFFFF" }, verticalAlignment: "center" };
  overview.getRange("A1:F1").format.rowHeight = 36;
  overview.getRange("A3:B10").values = [
    ["运行编号", run.id], ["运行时间 UTC", run.created_at], ["状态", run.status],
    ["目标上限", run.limit], ["候选数", (run.leads || []).length], ["重复跳过", (run.duplicates || []).length],
    ["市场范围", (run.markets || []).join("、")],
    ["产品族", (run.product_families || []).join("、")]
  ];
  overview.getRange("A11:B12").values = [["执行模型", run.model_label || run.model || "未记录"], ["推理强度", run.reasoning_effort_label || run.reasoning_effort || "未记录"]];
  overview.getRange("A3:A12").format = { fill: palette.pale, font: { bold: true, color: palette.ink } };
  overview.getRange("A:A").format.columnWidth = 22;
  overview.getRange("B:B").format.columnWidth = 70;
  overview.getRange("A3:B12").format.wrapText = true;
  overview.getRange("A14:F14").merge();
  overview.getRange("A14").values = [["草稿与潜客仅供人工复核；本文件不代表已发送、已导入 CRM 或存在真实采购需求。"]];
  overview.getRange("A14:F14").format = { fill: "#FFF1E9", font: { color: "#93451F", bold: true }, wrapText: true };

  const rows = leadRows(run);
  leadsSheet.getRange(`A1:${columnName(leadHeaders.length - 1)}1`).values = [leadHeaders];
  if (rows.length) leadsSheet.getRange(`A2:${columnName(leadHeaders.length - 1)}${rows.length + 1}`).values = rows;
  leadsSheet.getRange(`A1:${columnName(leadHeaders.length - 1)}1`).format = { fill: palette.teal, font: { bold: true, color: "#FFFFFF" }, wrapText: true, verticalAlignment: "center" };
  leadsSheet.getRange(`A1:${columnName(leadHeaders.length - 1)}1`).format.rowHeight = 38;
  leadsSheet.getRange(`A2:${columnName(leadHeaders.length - 1)}${Math.max(rows.length + 1, 2)}`).format = { wrapText: true, verticalAlignment: "top" };
  leadsSheet.freezePanes.freezeRows(1);
  leadsSheet.freezePanes.freezeColumns(2);
  for (const col of ["A", "B", "C", "D", "E", "F", "H", "M", "O", "Q", "T", "U", "V", "W"]) leadsSheet.getRange(`${col}:${col}`).format.columnWidth = 16;
  for (const col of ["G", "I", "J", "R", "S", "X", "Y", "Z", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM"]) leadsSheet.getRange(`${col}:${col}`).format.columnWidth = 32;

  const evidenceRows = [];
  for (const lead of run.leads || []) for (const source of lead.sources || []) {
    evidenceRows.push([lead.lead_id, lead.company, source.title, source.source_type, source.url, source.checked_at, (source.supports || []).join("；")]);
  }
  const evidenceHeaders = ["Lead ID", "公司", "来源标题", "来源类型", "URL", "核验日期", "支持的字段"];
  evidenceSheet.getRange("A1:G1").values = [evidenceHeaders];
  if (evidenceRows.length) evidenceSheet.getRange(`A2:G${evidenceRows.length + 1}`).values = evidenceRows;
  evidenceSheet.getRange("A1:G1").format = { fill: palette.dark, font: { bold: true, color: "#FFFFFF" }, wrapText: true };
  evidenceSheet.getRange("C:C").format.columnWidth = 30;
  evidenceSheet.getRange("E:E").format.columnWidth = 54;
  evidenceSheet.getRange("G:G").format.columnWidth = 48;
  evidenceSheet.getRange(`A1:G${Math.max(evidenceRows.length + 1, 2)}`).format.wrapText = true;
  evidenceSheet.freezePanes.freezeRows(1);

  const draftRows = (run.leads || []).map((lead) => [lead.lead_id, lead.company, lead.draft?.eligibility || "无草稿", lead.draft?.channel || "none", lead.draft?.subject || "", lead.draft?.body || "", lead.draft?.chinese_purpose || "", lead.draft?.product_summary || ""]);
  const draftHeaders = ["Lead ID", "公司", "草稿资格", "渠道", "主题", "英文草稿", "中文目的", "产品摘要（非报价）"];
  draftsSheet.getRange("A1:H1").values = [draftHeaders];
  if (draftRows.length) draftsSheet.getRange(`A2:H${draftRows.length + 1}`).values = draftRows;
  draftsSheet.getRange("A1:H1").format = { fill: palette.orange, font: { bold: true, color: "#FFFFFF" }, wrapText: true };
  draftsSheet.getRange(`A2:H${Math.max(draftRows.length + 1, 2)}`).format.wrapText = true;
  for (const col of ["A", "B", "C", "D"]) draftsSheet.getRange(`${col}:${col}`).format.columnWidth = 18;
  for (const col of ["E", "F", "G", "H"]) draftsSheet.getRange(`${col}:${col}`).format.columnWidth = 42;
  draftsSheet.freezePanes.freezeRows(1);

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(filePath);
}

async function walkFiles(dir, depth = 0) {
  if (depth > 5) return [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const results = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "__pycache__"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await walkFiles(full, depth + 1));
    else results.push(full);
  }
  return results;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); if (row.some((cell) => cell.trim())) rows.push(row); }
  return rows;
}

function normalizedHeader(value) {
  return String(value || "").toLowerCase().replace(/[\s_\-()（）【】\[\]：:/\\.]/g, "");
}

const companyHeaderPatterns = ["company", "companyname", "customername", "企业名称", "公司名称", "公司名", "客户名称", "客户公司", "品牌名称"];
const countryHeaderPatterns = ["country", "countryregion", "国家", "国家地区", "国家/地区"];
const websiteHeaderPatterns = ["website", "companywebsite", "官网", "公司官网", "网站", "url"];

function columnFor(headers, patterns) {
  return headers.findIndex((value) => patterns.some((pattern) => {
    const normalized = normalizedHeader(value);
    return normalized === normalizedHeader(pattern) || normalized.includes(normalizedHeader(pattern));
  }));
}

function normalizeCompany(value) {
  return String(value || "").toLocaleLowerCase()
    .replace(/\b(incorporated|corporation|company|limited|ltd|llc|inc|corp|gmbh|co|pte|pty|bv|srl|sa|plc)\b/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function normalizeDomain(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

function accountKeys(account) {
  const name = normalizeCompany(account.company);
  const country = String(account.country || "").trim().toLowerCase();
  const domain = normalizeDomain(account.website);
  return { name, country, domain, key: `${name}|${country}` };
}

async function collectExistingAccounts(run) {
  const files = await walkFiles(projectRoot);
  const relevant = files.filter((file) => {
    const extension = path.extname(file).toLowerCase();
    const normalized = file.toLowerCase();
    const isLeadFile = /pet|宠物|customer|客户/.test(normalized);
    return isLeadFile && (extension === ".csv" || extension === ".xlsx") && !normalized.endsWith(".inspect.xlsx");
  }).slice(0, 120);
  const accounts = [];
  const issues = [];

  for (const file of relevant) {
    try {
      if (path.extname(file).toLowerCase() === ".csv") {
        const rows = parseCsv(await fs.readFile(file, "utf8"));
        if (!rows.length) continue;
        const headerIndex = Math.max(0, rows.slice(0, 4).findIndex((row) => columnFor(row, companyHeaderPatterns) >= 0));
        const headers = rows[headerIndex] || rows[0];
        const nameIndex = columnFor(headers, companyHeaderPatterns);
        if (nameIndex < 0) continue;
        const countryIndex = columnFor(headers, countryHeaderPatterns);
        const websiteIndex = columnFor(headers, websiteHeaderPatterns);
        for (const row of rows.slice(headerIndex + 1)) {
          const company = String(row[nameIndex] || "").trim();
          if (!company) continue;
          accounts.push({ company, country: countryIndex >= 0 ? String(row[countryIndex] || "") : "", website: websiteIndex >= 0 ? String(row[websiteIndex] || "") : "", source_file: path.relative(projectRoot, file) });
        }
      } else {
        const { FileBlob, SpreadsheetFile } = await import("@oai/artifact-tool");
        const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
        const count = workbook.worksheets.getSheetCount();
        for (let sheetIndex = 0; sheetIndex < count; sheetIndex++) {
          const sheet = workbook.worksheets.getItemAt(sheetIndex);
          const used = sheet.getUsedRange(true);
          const matrix = used?.values || [];
          const headerIndex = matrix.slice(0, 8).findIndex((row) => columnFor(row, companyHeaderPatterns) >= 0);
          if (headerIndex < 0) continue;
          const headers = matrix[headerIndex] || [];
          const nameIndex = columnFor(headers, companyHeaderPatterns);
          const countryIndex = columnFor(headers, countryHeaderPatterns);
          const websiteIndex = columnFor(headers, websiteHeaderPatterns);
          for (const row of matrix.slice(headerIndex + 1)) {
            const company = String(row[nameIndex] ?? "").trim();
            if (!company) continue;
            accounts.push({ company, country: countryIndex >= 0 ? String(row[countryIndex] ?? "") : "", website: websiteIndex >= 0 ? String(row[websiteIndex] ?? "") : "", source_file: path.relative(projectRoot, file) });
          }
        }
      }
    } catch (error) {
      issues.push(`${path.relative(projectRoot, file)}: ${String(error?.message || error).slice(0, 180)}`);
    }
  }

  const seen = new Set();
  const unique = [];
  for (const item of accounts) {
    const keys = accountKeys(item);
    if (!keys.name) continue;
    const signature = keys.domain ? `d:${keys.domain}` : `n:${keys.key}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push({ company: item.company, country: item.country, domain: keys.domain, source_file: item.source_file });
  }
  run.preflight = { files_scanned: relevant.length, accounts_found: unique.length, issues };
  return unique;
}

function findDuplicate(candidate, accounts) {
  const candidateKeys = accountKeys(candidate);
  for (const existing of accounts) {
    const existingKeys = accountKeys(existing);
    const sameDomain = candidateKeys.domain && existingKeys.domain && candidateKeys.domain === existingKeys.domain;
    const sameNameAndCountry = candidateKeys.name && existingKeys.name && candidateKeys.name === existingKeys.name && (!candidateKeys.country || !existingKeys.country || candidateKeys.country === existingKeys.country);
    if (sameDomain || sameNameAndCountry) return existing;
  }
  return null;
}

function stableLeadId(company, country) {
  const digest = createHash("sha256").update(`${normalizeCompany(company)}|${String(country || "").toLowerCase()}`).digest("hex").slice(0, 10).toUpperCase();
  return `PET-${digest}`;
}

function trimString(value, limit = 3000) {
  return String(value ?? "").trim().slice(0, limit);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!(["http:", "https:"].includes(url.protocol))) return "";
    return url.href.slice(0, 1000);
  } catch { return ""; }
}

function normalizeResearchLead(raw) {
  const website = safeUrl(raw.website);
  const sources = (raw.sources || []).map((source) => ({
    title: trimString(source.title, 300),
    url: safeUrl(source.url),
    source_type: trimString(source.source_type, 100),
    checked_at: trimString(source.checked_at, 40),
    supports: Array.isArray(source.supports) ? source.supports.map((value) => trimString(value, 500)).slice(0, 12) : []
  })).filter((source) => source.url);
  const contacts = (raw.contacts || []).slice(0, 5).map((contact) => ({
    name: trimString(contact.name, 160), role: trimString(contact.role, 200),
    role_status: contact.role_status || "未知", email: trimString(contact.email, 254), email_status: contact.email_status || "未知",
    phone: trimString(contact.phone, 80), whatsapp: trimString(contact.whatsapp, 80), whatsapp_status: contact.whatsapp_status || "未知",
    linkedin: safeUrl(contact.linkedin), official_business_route: trimString(contact.official_business_route, 500), evidence_url: safeUrl(contact.evidence_url)
  }));
  return {
    lead_id: stableLeadId(raw.company, raw.country),
    company: trimString(raw.company, 200), country: trimString(raw.country, 120), market_region: trimString(raw.market_region, 120),
    product_family: trimString(raw.product_family, 120), customer_type: trimString(raw.customer_type, 160), website,
    summary: trimString(raw.summary, 1500), fit_reason: trimString(raw.fit_reason, 1500), identity_status: raw.identity_status || "未知",
    facts: (raw.facts || []).map((value) => trimString(value, 700)).slice(0, 20),
    inferences: (raw.inferences || []).map((value) => trimString(value, 700)).slice(0, 20),
    unknowns: (raw.unknowns || []).map((value) => trimString(value, 700)).slice(0, 20),
    contacts, sources, search_queries: (raw.search_queries || []).map((value) => trimString(value, 300)).slice(0, 12),
    buying_signal: trimString(raw.buying_signal, 800), exclusion_reason: trimString(raw.exclusion_reason, 500)
  };
}

function sumDimensions(dimensions = {}) {
  return Object.values(dimensions).reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

function capTier(tier, maxTier) {
  const order = ["C", "B", "A", "S"];
  return order[Math.min(order.indexOf(tier) >= 0 ? order.indexOf(tier) : 0, order.indexOf(maxTier))];
}

function mergeScore(lead, rawScore) {
  const dimensionScores = rawScore?.dimension_scores || {};
  const total = Math.max(0, Math.min(100, Math.round(sumDimensions(dimensionScores))));
  let tier = rawScore?.tier || (total >= 85 ? "S" : total >= 70 ? "A" : total >= 50 ? "B" : "C");
  if (lead.identity_status !== "已验证") tier = capTier(tier, "B");
  // Newly found accounts have no confirmed active demand or buyer engagement yet.
  if (tier === "S") tier = "A";
  return {
    dimension_scores: dimensionScores, total_score: total, tier,
    confidence: Math.max(0, Math.min(100, Number(rawScore?.confidence) || 0)),
    provisional: (Number(rawScore?.confidence) || 0) < 60,
    big_fish: rawScore?.big_fish || "Low",
    product_family_fit_basis: trimString(rawScore?.product_family_fit_basis, 1600) || lead.fit_reason,
    reason: trimString(rawScore?.reason, 1600),
    risk_flags: Array.isArray(rawScore?.risk_flags) ? rawScore.risk_flags.map((value) => trimString(value, 400)).slice(0, 12) : [],
    next_action: trimString(rawScore?.next_action, 500)
  };
}

function draftChannelIssue(lead, draft) {
  const contacts = lead.contacts || [];
  if (draft.channel === "none") return "未核验到可使用的联系渠道。";
  if (draft.channel === "email" && !contacts.some((contact) => contact.email && contact.email_status === "已验证")) {
    return "邮箱没有被来源明确核验，已移除邮件渠道草稿。";
  }
  if (draft.channel === "whatsapp" && !contacts.some((contact) => contact.whatsapp && contact.whatsapp_status === "已验证")) {
    return "WhatsApp 没有被来源明确核验，已移除该渠道草稿。";
  }
  if (draft.channel === "linkedin" && !contacts.some((contact) => contact.linkedin && contact.role_status === "已验证")) {
    return "LinkedIn 联系人或职位没有充分核验，已移除该渠道草稿。";
  }
  if (draft.channel === "official_route") {
    const siteDomain = normalizeDomain(lead.website);
    const officialSourceExists = siteDomain && (lead.sources || []).some((source) => normalizeDomain(source.url) === siteDomain);
    if (!contacts.some((contact) => contact.official_business_route) || !officialSourceExists) {
      return "官网业务入口缺少同域名来源证据，已移除该渠道草稿。";
    }
  }
  return "";
}

function enforceDraftChannelPolicy(run) {
  let changed = false;
  for (const lead of run.leads || []) {
    if (!lead.draft) continue;
    const issue = draftChannelIssue(lead, lead.draft);
    if (!issue) continue;
    lead.draft = { eligibility: "无合适渠道", channel: "none", subject: "", body: "", chinese_purpose: "", product_summary: "", reason: issue, sent: false, approval_status: "draft_only" };
    changed = true;
  }
  return changed;
}

async function readRoleBindings() {
  try { return await readJson(sharedFiles.skillBindings); } catch { return { bindings: {} }; }
}

function resolveBindingPath(value) {
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return path.normalize(value);
  return path.resolve(companyRoot, value);
}

async function readExistingText(file, limit = 35000) {
  try { return (await fs.readFile(file, "utf8")).slice(0, limit); } catch { return ""; }
}

async function getRoleMaterials(stage, petPreset) {
  const agentId = stageAgents[stage];
  const bindingConfig = await readRoleBindings();
  const bindings = bindingConfig.bindings?.[agentId] || [];
  const filters = roleSkillFilters[stage] || [];
  const selected = bindings.filter((file) => (petPreset || !/pet-buyer/i.test(file)) && filters.some((filter) => file.toLowerCase().includes(filter.toLowerCase())));
  const files = [[`岗位合同 ${agentId}`, roleFiles[agentId]]];
  for (const file of selected) files.push([`技能绑定 ${path.basename(file)}`, resolveBindingPath(file)]);

  if (stage === "hq_intake") {
    files.push(["外贸销售中心主Agent岗位合同", sharedFiles.salesCenterSpec]);
    files.push(["CEO总控助手主提示词", sharedFiles.hqMasterPrompt]);
    files.push(["统一路由 Skill", sharedFiles.hqRouterSkill]);
    files.push(["统一路由主提示词", sharedFiles.hqMasterRouterPrompt]);
    files.push(["客户背调路由提示词", sharedFiles.hqRouteBuyerBackground]);
    files.push(["统一路由配置", sharedFiles.hqRouteConfig]);
    files.push(["统一路由输入字段", sharedFiles.hqInputSchema]);
    files.push(["统一路由输出格式", sharedFiles.hqOutputSchema]);
  }

  if (petPreset && ["research", "draft"].includes(stage)) {
    for (const file of projectSkillFiles) files.push([`项目获客规则 ${path.basename(file)}`, file]);
    files.push(["共享企业画像", sharedFiles.businessProfile]);
    files.push(["共享产品资料索引", sharedFiles.productCatalogIndex]);
  }
  if (petPreset && stage === "research") files.push(["宠物买家调研来源提示", path.join(companyRoot, "pet-export-business-skills-pack", "pet-buyer-research-analyst", "SKILL.md")]);
  if (petPreset && stage === "score") files.push(["宠物买家风险评分", path.join(companyRoot, "pet-export-business-skills-pack", "pet-buyer-risk-scorer", "SKILL.md")]);
  if (stage === "score") files.push(["SABC 评分卡", path.join(os.homedir(), ".codex", "skills", "trade-buyer-segmentation", "references", "sabc-scorecard.md")]);
  if (petPreset && stage === "draft") {
    files.push(["已批准宠物产品事实", sharedFiles.petProductFacts]);
    files.push(["首触文案要求", sharedFiles.firstContact]);
  }
  if (stage === "archive") files.push(["CRM字段合同", sharedFiles.customerDbContract]);

  const unique = new Map(files.filter(([, file]) => file).map(([label, file]) => [path.normalize(file).toLowerCase(), [label, file]]));
  const chunks = [];
  for (const [label, file] of unique.values()) {
    const content = await readExistingText(file);
    if (content) chunks.push(`## ${label}\n\n${content}`);
  }
  return chunks.join("\n\n---\n\n");
}

async function buildStagePrompt(stage, run, payload) {
  const workflowPrompt = await readExistingText(stagePrompts[stage], 12000);
  const roleMaterials = await getRoleMaterials(stage, !run.target);
  const handoff = stage !== "hq_intake" && run.hq_route ? `\n# HQ / 销售中心分派结果\n${JSON.stringify(run.hq_route, null, 2)}` : "";
  return [
    `你正在执行本机 B2B 获客任务 ${run.id}。这是只读研究与草稿流程。不要发送消息、提交表单、修改客户档案、改变广告或生成正式报价。`,
    `所有公司信息须标注事实/推断/未知并附来源 URL 和核验日期。若材料不足，保留未知并减少输出。`,
    `\n# 当前阶段\n${stage}\n\n# 阶段指令\n${workflowPrompt}`,
    `\n# 已绑定岗位合同与 Skills\n${roleMaterials}`,
    handoff,
    run.target ? "本轮目标（业务数据，适用范围以此为准）：" + JSON.stringify(run.target) : "",
    `\n# 本次运行输入（只包含必要业务字段）\n${JSON.stringify(payload, null, 2)}`,
    `\n只返回符合输出 JSON Schema 的 JSON，不要附 Markdown、解释或代码围栏。`
  ].join("\n");
}

function parseModelJson(text) {
  const source = String(text || "").trim();
  try { return JSON.parse(source); } catch { /* Try the JSON object embedded in the final message. */ }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
  throw new Error("Codex 最终输出不是有效 JSON。");
}

async function runCodexStage(stage, run, payload) {
  const responsePath = path.join(runRoot, run.id, `${stage}.response.json`);
  await fs.mkdir(path.dirname(responsePath), { recursive: true });
  const prompt = await buildStagePrompt(stage, run, payload);
  const codex = process.env.CODEX_EXECUTABLE || "codex";
  const args = [
    "--search", "--sandbox", "read-only", "--ask-for-approval", "never",
    "-C", projectRoot, "--add-dir", headquartersRoot,
    "exec", "--model", run.model || "gpt-6.1-sol", "--config", `model_reasoning_effort=\"${run.reasoning_effort || "medium"}\"`, "--skip-git-repo-check", "--output-schema", stageSchemas[stage], "--output-last-message", responsePath,
    "--color", "never", "-"
  ];
  const output = await new Promise((resolve, reject) => {
    const child = spawn(codex, args, { cwd: projectRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeoutMinutes = Math.max(1, Number(run.executor_stage_timeout_minutes || 30));
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMinutes * 60 * 1000);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    };
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-100000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-24000); });
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});
    child.stdin.on("error", (error) => {
      if (!["EPIPE", "EOF"].includes(error.code)) fail(new Error(`向 Codex ${stage} 阶段写入提示词失败：${error.message}`));
    });
    child.once("error", (error) => fail(new Error(`无法启动 Codex CLI：${error.message}`)));
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (code !== 0) return reject(new Error(timedOut ? `Codex ${stage} 阶段超时（${timeoutMinutes} 分钟）。` : `Codex ${stage} 阶段退出码 ${code}。${stderr.slice(-1200) || stdout.slice(-1200)}`));
      resolve({ stdout, stderr });
    });
    try { child.stdin.end(prompt); } catch (error) { fail(new Error(`向 Codex ${stage} 阶段发送提示词失败：${error.message}`)); }
  });
  let responseText = "";
  try { responseText = await fs.readFile(responsePath, "utf8"); } catch { responseText = output.stdout; }
  return parseModelJson(responseText);
}

function setProgress(run) {
  const done = run.stages.filter((stage) => stage.status === "done").length;
  run.progress = Math.round(done / Math.max(1, run.stages.length) * 100);
}

async function createWorkbookExports(run) {
  enforceDraftChannelPolicy(run);
  await fs.mkdir(exportRoot, { recursive: true });
  const directory = path.join(exportRoot, run.id);
  await fs.mkdir(directory, { recursive: true });
  const csvPath = path.join(directory, "pet-leads.csv");
  await fs.writeFile(csvPath, makeCsv(leadHeaders, leadRows(run)), "utf8");
  const jsonPath = path.join(directory, "run.json");
  await writeJson(jsonPath, run);
  let xlsxPath = "";
  let xlsxError = "";
  try {
    xlsxPath = path.join(directory, "pet-leads.xlsx");
    await exportWorkbook(run, xlsxPath);
  } catch (error) {
    xlsxError = String(error?.message || error).slice(0, 1000);
    xlsxPath = "";
  }
  run.exports = { csv: true, xlsx: Boolean(xlsxPath), xlsx_error: xlsxError, directory };
  await saveRun(run);
}

async function recoverInterruptedRuns() {
  const runs = await listRuns();
  for (const run of runs) {
    const draftsChanged = enforceDraftChannelPolicy(run);
    if (["queued", "running"].includes(run.status)) {
      const message = "上次本机服务退出时本轮运行中断；可在看板重新启动。";
      const activeStage = run.stages.find((stage) => stage.status === "running") || run.stages.find((stage) => stage.status === "pending");
      if (activeStage) updateStage(run, activeStage.id, "failed", message);
      for (const stage of run.stages) if (stage.status === "pending") updateStage(run, stage.id, "skipped", "本轮被本机服务中断。");
      run.status = "failed";
      run.error = message;
      run.notice = message;
      setProgress(run);
      safeLog(run, message, "error");
      await saveRun(run);
      try { await createWorkbookExports(run); } catch { /* Preserve recovered state even if export fails. */ }
    } else if (["failed", "blocked"].includes(run.status)) {
      const previousProgress = run.progress;
      setProgress(run);
      if (run.progress !== previousProgress || draftsChanged) {
        if (draftsChanged) {
          try { await createWorkbookExports(run); } catch { await saveRun(run); }
          continue;
        }
        await saveRun(run);
        if (run.exports?.directory) {
          try { await writeJson(path.join(run.exports.directory, "run.json"), run); } catch { /* The run record remains authoritative. */ }
        }
      }
    } else if (draftsChanged) {
      try { await createWorkbookExports(run); } catch { await saveRun(run); }
    }
  }
}

async function processRun(id) {
  if (runLocks.has(id)) return;
  runLocks.add(id);
  queuedRuns.delete(id);
  const file = runFile(id);
  let run;
  try {
    run = await readJson(file);
    run.status = "running";
    safeLog(run, "本地流程已启动。不会发送消息或写入 CRM。");
    await saveRun(run);

    updateStage(run, "hq_intake", "running", "HQ 正在核对获客路由、销售中心岗位顺序和审批边界。" );
    safeLog(run, "HQ 外贸总控正在将任务交给外贸销售中心与 E03/E08/E05/E09 顺序执行。");
    await saveRun(run);
    run.hq_route = await runCodexStage("hq_intake", run, {
      objective: "按本轮确认的产品、市场和买家类型研究 B2B 候选。",
      route: "buyer_background",
      department: "sales-center",
      department_manager: "sales-center-main",
      employee_sequence: ["e03-buyer-researcher", "e08-customer-grader", "e05-outreach-writer", "e09-crm-archivist"],
      markets: run.markets,
      product_profiles: run.product_profiles,
      run_boundaries: { send_messages: false, write_customer_archive: false, formal_quote: false, schedule: false }
    });
    const expectedSequence = ["e03-buyer-researcher", "e08-customer-grader", "e05-outreach-writer", "e09-crm-archivist"];
    if (JSON.stringify(run.hq_route.employee_sequence) !== JSON.stringify(expectedSequence)) throw new Error("HQ 返回的员工分派顺序不符合本地工作流配置。");
    updateStage(run, "hq_intake", "done", `HQ 路由 ${run.hq_route.route} → ${run.hq_route.department_manager}；岗位顺序已核对。`);
    safeLog(run, "HQ 分派完成；本地运行记录作为父任务，流程不重复创建 HQ 待办。");
    await saveRun(run);

    updateStage(run, "preflight", "running", "扫描现有线索 CSV/XLSX，仅读取公司名、国家和官网用于去重。");
    safeLog(run, "读取现有客户文件用于去重。");
    const existingAccounts = await collectExistingAccounts(run);
    updateStage(run, "preflight", "done", `扫描 ${run.preflight.files_scanned} 个相关文件，提取 ${run.preflight.accounts_found} 家公司键。`);
    safeLog(run, `现有名单检查完成：${run.preflight.accounts_found} 家去重键。`);
    await saveRun(run);

    updateStage(run, "research", "running", "E03 正在按公开来源搜索并核验企业、品类和业务入口。");
    safeLog(run, "E03 正在研究公开来源。可访问性受限时会保留未知/访问受限状态。");
    await saveRun(run);
    const researchResponsePath = path.join(runRoot, run.id, "research.response.json");
    let researchResult;
    if (run.resume_research_from_file) {
      researchResult = await readJson(researchResponsePath);
      run.resume_research_from_file = false;
      safeLog(run, "已从 GPT-6.1 Sol 恢复会话载入 E03 结构化研究结果。");
    } else {
      researchResult = await runCodexStage("research", run, {
        limit: run.limit,
        markets: run.markets,
        product_families: run.product_families,
        product_profiles: run.product_profiles || [],
        known_account_count: existingAccounts.length,
        dedupe_policy: `本阶段只研究公开候选；完整 ${existingAccounts.length} 家本地公司键将由后续确定性代码统一去重，不需要在模型输入中携带名单。`,
        source_policy: "公开网页 + 找客户项目现有名单；不使用未接入的地图/海关数据库。"
      });
    }
    const rawLeads = Array.isArray(researchResult.leads) ? researchResult.leads : [];
    const normalizedLeads = rawLeads.map(normalizeResearchLead).filter((lead) => lead.company && lead.sources.length && (!run.target || (lead.product_family === run.target.product && lead.market_region === run.target.market)));
    updateStage(run, "research", "done", `E03 返回 ${normalizedLeads.length} 条带来源的候选。`);
    safeLog(run, `E03 候选核验完成：${normalizedLeads.length} 条。`);
    await saveRun(run);

    updateStage(run, "dedupe", "running", "按官网域名和公司名/国家与本地线索比对。");
    const accepted = [];
    const duplicates = [];
    const sameBatch = [];
    for (const lead of normalizedLeads) {
      const match = findDuplicate(lead, existingAccounts) || findDuplicate(lead, sameBatch);
      if (match) {
        duplicates.push({ company: lead.company, country: lead.country, website: lead.website, duplicate_of: match.company, source_file: match.source_file || "本批次", lead_id: lead.lead_id });
      } else {
        accepted.push(lead);
        sameBatch.push(lead);
      }
    }
    run.duplicates = duplicates;
    run.leads = accepted;
    updateStage(run, "dedupe", "done", `保留 ${accepted.length} 条新候选；跳过 ${duplicates.length} 条重复。`);
    safeLog(run, `本地确定性去重完成：新候选 ${accepted.length}，重复 ${duplicates.length}。`);
    await saveRun(run);

    if (!accepted.length) {
      for (const stageId of ["score", "draft", "archive"]) updateStage(run, stageId, "skipped", "没有通过去重的候选。");
      run.status = "done";
      run.progress = 100;
      run.notice = "本轮没有发现新的、带来源的宠物 B2B 公司。可复核重复列表后调整搜索范围。";
      safeLog(run, run.notice, "warning");
      await createWorkbookExports(run);
      return;
    }

    updateStage(run, "score", "running", "E08 按 100 分证据模型评估匹配度；无真实询盘，不推定采购需求。");
    safeLog(run, "E08 正在按证据评分，并执行 SABC 硬门槛。");
    await saveRun(run);
    const scoreResult = await runCodexStage("score", run, { leads: accepted, product_profiles: run.product_profiles || [] });
    const scoreById = new Map((scoreResult.scores || []).map((score) => [score.lead_id, score]));
    for (const lead of accepted) lead.score = mergeScore(lead, scoreById.get(lead.lead_id));
    accepted.sort((left, right) => right.score.total_score - left.score.total_score || right.score.confidence - left.score.confidence);
    run.leads = accepted.slice(0, run.limit);
    updateStage(run, "score", "done", `完成 ${accepted.length} 条评分；输出上限 ${run.limit} 家，按分数排序。`);
    safeLog(run, `E08 评分完成，保留前 ${run.leads.length} 条。`);
    await saveRun(run);

    updateStage(run, "draft", "running", "E05 只为有核实联系人或官方业务入口的公司准备草稿。");
    safeLog(run, "E05 正在准备英文草稿和非报价型产品摘要。");
    await saveRun(run);
    const draftEligible = run.leads.filter((lead) => {
      const officialRoute = lead.contacts.some((contact) => contact.official_business_route);
      const verifiedContact = lead.contacts.some((contact) => contact.name && contact.role_status === "已验证");
      return lead.identity_status === "已验证" && (officialRoute || verifiedContact);
    });
    const draftResult = await runCodexStage("draft", run, { leads: draftEligible });
    const draftById = new Map((draftResult.drafts || []).map((draft) => [draft.lead_id, draft]));
    for (const lead of run.leads) {
      const draft = draftById.get(lead.lead_id);
      if (!draft) {
        lead.draft = { eligibility: "无合适渠道", channel: "none", reason: "本轮没有足够证据支持安全的业务触达渠道。" };
        continue;
      }
      lead.draft = { ...draft, sent: false, approval_status: "draft_only" };
    }
    enforceDraftChannelPolicy(run);
    updateStage(run, "draft", "done", `为 ${draftEligible.length} 条有合适联系路径的线索生成草稿。`);
    safeLog(run, "E05 草稿完成；所有消息仍为本地草稿，没有创建邮箱草稿或发送。");
    await saveRun(run);

    updateStage(run, "archive", "running", "E09 输出 CRM-ready 字段；状态保持本地待审核潜客。");
    safeLog(run, "E09 正在整理本地待审核记录。");
    await saveRun(run);
    const archiveResult = await runCodexStage("archive", run, { leads: run.leads });
    const recordById = new Map((archiveResult.records || []).map((record) => [record.lead_id, record]));
    for (const lead of run.leads) {
      const record = recordById.get(lead.lead_id) || {};
      lead.crm_record = {
        ...record, lead_id: lead.lead_id, company_name: lead.company, country: lead.country,
        website: lead.website, customer_type: lead.customer_type, product_interest: lead.product_family,
        source: "公开来源 / 手动获客自动化", evidence: lead.sources, stage: "prospecting_review",
        verification_status: lead.identity_status, score: lead.score.total_score, grade: lead.score.tier,
        contact_name: lead.contacts.find((contact) => contact.name)?.name || "",
        position: lead.contacts.find((contact) => contact.role)?.role || "",
        email: lead.contacts.find((contact) => contact.email)?.email || "",
        whatsapp: lead.contacts.find((contact) => contact.whatsapp && contact.whatsapp_status === "已验证")?.whatsapp || "",
        owner: "Conrad", next_action: record.next_action || "人工复核企业、联系人与草稿", next_due_at: record.next_due_at || "unknown",
        sent: false, import_status: "本地待审核"
      };
    }
    updateStage(run, "archive", "done", `生成 ${run.leads.length} 条 CRM-ready 本地记录；未写入客户档案。`);
    safeLog(run, "E09 完成本地归档准备。导入客户档案仍需 Conrad 在现有预览/提交流程中确认。");
    run.status = run.leads.length ? "needs_review" : "done";
    run.progress = 100;
    run.notice = run.leads.length ? "获客流程完成，潜客和草稿等待人工复核。" : "本轮没有达到留存门槛的潜客。";
    await createWorkbookExports(run);
  } catch (error) {
    if (!run) {
      try { run = await readJson(file); } catch { return; }
    }
    const message = String(error?.message || error).slice(0, 2500);
    run.status = /无法启动 Codex CLI|ENOENT|not recognized/i.test(message) ? "blocked" : "failed";
    run.error = message;
    for (const stage of run.stages) if (stage.status === "running") updateStage(run, stage.id, run.status === "blocked" ? "blocked" : "failed", message);
    safeLog(run, message, "error");
    run.progress = Math.round(run.stages.filter((stage) => stage.status === "done").length / Math.max(1, run.stages.length) * 100);
    await saveRun(run);
    try { await createWorkbookExports(run); } catch { /* Keep the run state even if export fails. */ }
  } finally {
    runLocks.delete(id);
  }
}

async function readRequestBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString("utf8");
    if (Buffer.byteLength(body) > bodyLimit) throw new Error("请求数据超过 1 MB。");
  }
  return body ? JSON.parse(body) : {};
}

function isLocalRequest(req) {
  const origin = req.headers.origin;
  const allowedOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
  if (origin && !allowedOrigins.has(origin)) return false;
  const hostHeader = String(req.headers.host || "").toLowerCase();
  return hostHeader === `${host}:${port}` || hostHeader === `localhost:${port}`;
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return jsonResponse(res, 400, { error: "Invalid path." }); }
  const requested = decoded === "/" ? "/index.html" : decoded;
  const file = path.resolve(publicRoot, `.${requested}`);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) return jsonResponse(res, 403, { error: "Forbidden." });
  let data;
  try { data = await fs.readFile(file); } catch { return jsonResponse(res, 404, { error: "Not found." }); }
  res.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": data.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(data);
}

async function serveExport(res, run, format) {
  const ext = format === "xlsx" ? "xlsx" : "csv";
  const file = path.join(exportRoot, run.id, `pet-leads.${ext}`);
  try {
    const data = await fs.readFile(file);
    const contentType = ext === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": data.length, "Content-Disposition": `attachment; filename="pet-leads-${run.id}.${ext}"`, "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    jsonResponse(res, 404, { error: `${ext.toUpperCase()} 导出文件暂不可用。` });
  }
}

function scopeFor(config, input) {
  if (input == null) return { target: null, markets: config.markets, profiles: config.product_families };
  const product = trimString(input.product, 120);
  const market = trimString(input.market, 100);
  const buyer = trimString(input.buyer, 160);
  if (!product || !market || !buyer) return null;
  return {
    target: { product, market, buyer, notes: trimString(input.notes, 350) },
    markets: [{ label: market }],
    profiles: [{
      id: "custom", label: product, buyer_profile: buyer,
      fit_signals: ["企业目录有直接品类证据", "买家角色及目标市场渠道可核验"],
      product_fit_anchors: ["0–5 缺少品类证据", "6–10 相邻品类且渠道吻合", "11–15 直接品类证据且买家角色吻合"]
    }]
  };
}

async function route(req, res) {
  if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: "仅允许本机访问。" });
  const url = new URL(req.url, `http://${host}:${port}`);
  const pathname = url.pathname;

  if (pathname === "/api/health" && req.method === "GET") return jsonResponse(res, 200, { ok: true, host, port, codex_cli: process.env.CODEX_EXECUTABLE || "codex", active_runs: runLocks.size });
  if (pathname === "/api/config" && req.method === "GET") return jsonResponse(res, 200, await loadConfig());
  if (pathname === "/api/runs" && req.method === "GET") return jsonResponse(res, 200, { runs: await listRuns() });
  if (pathname === "/api/runs/preview" && req.method === "POST") {
    const config = await loadConfig();
    const scope = scopeFor(config, (await readRequestBody(req)).target);
    if (!scope) return jsonResponse(res, 400, { error: "请填写产品、目标市场和优先买家。" });
    return jsonResponse(res, 200, {
      target: scope.target,
      mode: "manual", local_only: true, model: config.executor_model, model_label: config.executor_model_label, reasoning_effort: config.executor_reasoning_effort || "medium", reasoning_effort_label: config.executor_reasoning_effort_label || "中", markets: scope.markets, product_families: scope.profiles,
      limit: config.default_limit, stage_timeout_minutes: config.executor_stage_timeout_minutes || 30, data_sources: config.data_sources, excluded_sources: config.excluded_sources,
      effects: ["调用 Codex CLI 进行公开网页研究", "读取找客户项目名单用于去重", "写入本地运行记录与 CSV/XLSX"],
      not_performed: ["不会发送邮件/WhatsApp/LinkedIn", "不会写入客户档案", "不会生成正式报价"]
    });
  }
  if (pathname === "/api/runs" && req.method === "POST") {
    const body = await readRequestBody(req);
    if (body.confirmLocalRun !== true) return jsonResponse(res, 400, { error: "请确认这轮仅执行本地研究与草稿整理。" });
    if (runLocks.size || queuedRuns.size) return jsonResponse(res, 409, { error: "已有一轮获客任务正在运行。", active_run_id: [...runLocks, ...queuedRuns][0] });
    const config = await loadConfig();
    const scope = scopeFor(config, body.target);
    if (!scope) return jsonResponse(res, 400, { error: "请填写产品、目标市场和优先买家。" });
    const id = `PLH-${Date.now()}-${randomBytes(3).toString("hex")}`;
    const run = {
      id, status: "queued", progress: 0, created_at: nowIso(), updated_at: nowIso(),
      limit: config.default_limit, model: config.executor_model || "gpt-6.1-sol", model_label: config.executor_model_label || "GPT-6.1 Sol", reasoning_effort: config.executor_reasoning_effort || "medium", reasoning_effort_label: config.executor_reasoning_effort_label || "中", executor_stage_timeout_minutes: config.executor_stage_timeout_minutes || 30, markets: scope.markets.map((item) => item.label),
      target: scope.target,
      product_families: scope.profiles.map((item) => item.label),
      product_profiles: scope.profiles,
      stages: [
        { id: "hq_intake", label: "HQ 路由与分派", status: "pending", detail: "" },
        { id: "preflight", label: "现有名单检查", status: "pending", detail: "" },
        { id: "research", label: "E03 企业与买家核验", status: "pending", detail: "" },
        { id: "dedupe", label: "确定性去重", status: "pending", detail: "" },
        { id: "score", label: "E08 证据评分", status: "pending", detail: "" },
        { id: "draft", label: "E05 草稿与产品摘要", status: "pending", detail: "" },
        { id: "archive", label: "E09 CRM-ready 归档", status: "pending", detail: "" }
      ],
      leads: [], duplicates: [], activity: [], preflight: null, exports: null,
      notice: "运行尚未开始。", error: null
    };
    safeLog(run, "Conrad 手动启动本地获客试跑。");
    queuedRuns.add(id);
    try { await saveRun(run); } catch (error) { queuedRuns.delete(id); throw error; }
    setImmediate(() => { queuedRuns.delete(id); processRun(id); });
    return jsonResponse(res, 202, { run_id: id, status: run.status });
  }

  const resumeResearchMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9_-]+)\/resume-research$/);
  if (resumeResearchMatch && req.method === "POST") {
    const id = resumeResearchMatch[1];
    const file = runFile(id);
    if (!file) return jsonResponse(res, 400, { error: "无效的 run ID。" });
    const run = await readJson(file).catch(() => null);
    if (!run) return jsonResponse(res, 404, { error: "找不到这轮运行记录。" });
    if (run.status !== "failed" || !run.stages.some((stage) => stage.id === "research" && stage.status === "failed")) {
      return jsonResponse(res, 409, { error: "只有 E03 研究失败的运行可以从研究响应恢复。" });
    }
    if (runLocks.size || queuedRuns.size) return jsonResponse(res, 409, { error: "已有一轮获客任务正在运行。" });
    const responsePath = path.join(runRoot, id, "research.response.json");
    const response = await readJson(responsePath).catch(() => null);
    if (!response || !Array.isArray(response.leads) || response.leads.length > 12) {
      return jsonResponse(res, 422, { error: "E03 恢复响应不存在或未通过结构校验。" });
    }
    run.resume_research_from_file = true;
    run.status = "queued";
    run.error = null;
    updateStage(run, "research", "pending", "等待从 GPT-6.1 Sol 恢复会话载入 E03 研究结果。");
    safeLog(run, "Conrad 请求从已完成的 E03 恢复响应继续本机工作流。", "info");
    await saveRun(run);
    queuedRuns.add(id);
    setImmediate(() => { queuedRuns.delete(id); processRun(id); });
    return jsonResponse(res, 202, { run_id: id, status: run.status, resumed_stage: "research" });
  }

  const match = pathname.match(/^\/api\/runs\/([A-Za-z0-9_-]+)(?:\.(csv|xlsx))?$/);
  if (match) {
    const file = runFile(match[1]);
    if (!file) return jsonResponse(res, 400, { error: "无效的 run ID。" });
    let run;
    try { run = await readJson(file); } catch { return jsonResponse(res, 404, { error: "找不到这轮运行记录。" }); }
    if (match[2] && req.method === "GET") return serveExport(res, run, match[2]);
    if (req.method === "GET") return jsonResponse(res, 200, run);
  }

  return serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  const handleSocketError = (error) => {
    if (!["ECONNRESET", "EPIPE", "EOF"].includes(error.code)) console.error("Local HTTP socket error:", error.message);
  };
  req.on("error", handleSocketError);
  req.socket?.on("error", handleSocketError);
  res.on("error", handleSocketError);
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  Promise.resolve(route(req, res)).catch((error) => {
    if (!res.headersSent) jsonResponse(res, 500, { error: String(error?.message || error).slice(0, 1000) });
    else res.destroy();
  });
});

await fs.mkdir(runRoot, { recursive: true });
await recoverInterruptedRuns();
server.listen(port, host, () => {
  console.log(`Pet B2B Lead Hunt dashboard: http://${host}:${port}`);
  console.log(`Project outputs: ${exportRoot}`);
});

server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is busy. Set PET_LEAD_HUNT_PORT to another local port.` : error);
  process.exitCode = 1;
});

const state = { config: null, runs: [], activeRun: null, family: "all", selectedLead: null, busy: false };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const prettyTime = (value) => { if (!value) return "尚无运行记录"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); };
const isRunning = (run) => run && ["queued", "running"].includes(run.status);

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.error || `请求失败 (${response.status})`);
  return body;
}

function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function familyBucket(value) {
  const text = String(value || "").toLowerCase();
  if (/(food|食品|粮|零食|营养)/.test(text)) return "pet_food";
  if (/(suppl|用品|牵引|窝垫|清洁|服饰)/.test(text)) return "pet_supplies";
  return "smart_devices";
}

function renderMarkets() {
  const el = $("#marketList");
  el.innerHTML = (state.config?.markets || []).map((market, index) => `<div class="market-chip"><i>${String(index + 1).padStart(2, "0")}</i>${escapeHtml(market.label)}<b class="market-check"></b></div>`).join("");
}

function runStatusLabel(run) {
  return ({ queued: "排队中", running: "执行中", needs_review: "等待复核", done: "已完成", blocked: "环境阻塞", failed: "运行失败" })[run?.status] || "准备就绪";
}

function renderWorkflow(run) {
  const stages = run?.stages || [];
  const nodes = [...document.querySelectorAll(".workflow-card[data-stage]")];
  nodes.forEach((node) => {
    const stage = stages.find((item) => item.id === node.dataset.stage);
    node.classList.toggle("is-running", stage?.status === "running");
    node.classList.toggle("is-done", stage?.status === "done");
    node.classList.toggle("is-failed", ["failed", "blocked"].includes(stage?.status));
    const label = node.querySelector("strong");
    const icon = node.querySelector(".step-icon");
    icon.dataset.defaultIcon ??= icon.textContent;
    icon.textContent = icon.dataset.defaultIcon;
    if (!stage) return;
    if (stage.status === "done") icon.textContent = "✓";
    else if (stage.status === "running") icon.textContent = "◌";
    else if (["failed", "blocked"].includes(stage.status)) icon.textContent = "!";
    else if (stage.status === "skipped") icon.textContent = "–";
    if (label && stage.status === "running") label.setAttribute("aria-label", `${stage.label}执行中`);
  });
}

function renderRunActivity(run) {
  const target = $("#detailContent");
  if (!run) {
    target.innerHTML = `<div class="detail-placeholder"><div class="placeholder-ring">✦</div><strong>运行与客户证据</strong><p>每一步的状态、来源、联系人核验和阻塞原因都会显示在这里。</p></div><div class="activity-empty"><span class="activity-icon">⌁</span><span><b>准备就绪</b><small>本地任务记录等待开始</small></span><i class="activity-state">READY</i></div><div class="guardrail-card"><span>安全边界</span><ul><li>不会自动发送邮件或 WhatsApp</li><li>不会直接写入客户档案</li><li>没有规格与成本依据不报价</li></ul></div>`;
    return;
  }
  const stages = (run.stages || []).map((stage) => `<div class="run-stage ${escapeHtml(stage.status)}"><span class="stage-dot">${stage.status === "done" ? "✓" : stage.status === "running" ? "·" : stage.status === "failed" || stage.status === "blocked" ? "!" : ""}</span><span class="stage-copy"><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.detail || stage.status || "等待执行")}</small></span></div>`).join("");
  const activities = (run.activity || []).slice(-5).reverse().map((item) => `<div class="activity-empty"><span class="activity-icon">${item.level === "error" ? "!" : "⌁"}</span><span><b>${escapeHtml(item.message)}</b><small>${escapeHtml(prettyTime(item.at))}</small></span></div>`).join("");
  const hqRoute = run.hq_route ? `<div class="guardrail-card"><span>HQ 销售中心分派</span><ul><li>路由：${escapeHtml(run.hq_route.route || "buyer_background")}</li><li>部门：${escapeHtml(run.hq_route.department || "外贸销售中心")} · ${escapeHtml(run.hq_route.department_manager || "sales-center-main")}</li><li>岗位顺序：${(run.hq_route.employee_sequence || []).map(escapeHtml).join(" → ")}</li><li>${escapeHtml(run.hq_route.task_summary || "HQ 已将任务分派至销售中心。")}</li></ul></div>` : "";
  target.innerHTML = `<div class="detail-run-title"><span class="run-status-pill ${escapeHtml(run.status)}"><i>●</i>${escapeHtml(runStatusLabel(run))} · ${Number(run.progress || 0)}%</span><h3>${escapeHtml(run.id)}</h3><p>启动于 ${escapeHtml(prettyTime(run.created_at))} · 执行模型 ${escapeHtml(run.model_label || run.model || "未记录")} · 推理 ${escapeHtml(run.reasoning_effort_label || run.reasoning_effort || "未记录")}</p></div><div class="stage-list">${stages}</div>${run.error ? `<div class="run-error">${escapeHtml(run.error)}</div>` : ""}${hqRoute}<div class="detail-block"><h4>最近活动</h4>${activities || `<p>暂无活动记录</p>`}</div>${run.preflight ? `<div class="guardrail-card"><span>名单预检</span><ul><li>读取 ${Number(run.preflight.files_scanned || 0)} 个线索文件</li><li>提取 ${Number(run.preflight.accounts_found || 0)} 个公司去重键</li>${run.preflight.issues?.length ? `<li>${Number(run.preflight.issues.length)} 个文件读取受限</li>` : ""}</ul></div>` : ""}`;
}

function renderLeadDetail(lead) {
  const target = $("#detailContent");
  const contact = lead.contacts?.[0] || {};
  const score = lead.score || {};
  const sourceLinks = (lead.sources || []).map((source) => `<a class="evidence-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(source.title || source.url)}<br><small>${escapeHtml(source.checked_at || "核验日期未知")} · ${escapeHtml(source.source_type || "来源")}</small></a>`).join("");
  const list = (items) => (items?.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>暂无记录</p>`);
  const contactStatus = contact.role_status === "已验证" ? "职位来源已核验" : "决策权限未确认";
  target.innerHTML = `<div class="detail-run-title"><button class="text-button" id="backToRun">← 返回运行记录</button></div><div class="lead-detail-head"><span class="run-status-pill">${escapeHtml(lead.identity_status || "状态未知")}</span><h3>${escapeHtml(lead.company)}</h3><a href="${escapeHtml(lead.website || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(lead.website || "官网待确认")}</a></div><div class="detail-block"><h4>买家匹配</h4><p><b>${escapeHtml(lead.country || "市场未知")}</b> · ${escapeHtml(lead.customer_type || "客户类型待核实")}</p><p>${escapeHtml(lead.fit_reason || lead.summary || "暂无匹配说明")}</p><p>评分 ${Number(score.total_score || 0)} / 100 · ${escapeHtml(score.tier || "待评级")}级 · ${escapeHtml(String(score.confidence ?? 0))}% 置信度</p><p><span class="fact-label">${escapeHtml(lead.product_family || "品类")}匹配依据：</span>${escapeHtml(score.product_family_fit_basis || lead.fit_reason || "暂无独立说明")}</p>${score.reason ? `<p>${escapeHtml(score.reason)}</p>` : ""}</div><div class="detail-block"><h4>联系人核验 · ${escapeHtml(contactStatus)}</h4><p>${escapeHtml(contact.name || "姓名未确认")} · ${escapeHtml(contact.role || "职位未确认")}</p><p>邮箱：${escapeHtml(contact.email || "未确认")}（${escapeHtml(contact.email_status || "未知")}）</p><p>WhatsApp：${escapeHtml(contact.whatsapp || "未确认")}（${escapeHtml(contact.whatsapp_status || "未知")}）</p>${contact.official_business_route ? `<p>官方业务入口：${escapeHtml(contact.official_business_route)}</p>` : ""}</div><div class="detail-block"><h4>来源证据 · ${(lead.sources || []).length} 项</h4>${sourceLinks || "<p>暂无来源</p>"}</div><div class="detail-block"><h4>事实</h4>${list(lead.facts)}</div><div class="detail-block"><h4>推断</h4>${list(lead.inferences)}</div><div class="detail-block"><h4>未知与阻塞</h4>${list(lead.unknowns)}</div><div class="detail-draft"><h4>开发草稿 · ${escapeHtml(lead.draft?.eligibility || "未生成")}</h4><p>${escapeHtml(lead.draft?.body || lead.draft?.reason || "没有足够证据支持开发草稿")}</p></div><div class="guardrail-card"><span>下一步 · 人工复核</span><ul><li>${escapeHtml(lead.crm_record?.next_action || "复核企业身份与联系人")}</li><li>导入状态：${escapeHtml(lead.crm_record?.import_status || "本地待审核")}</li><li>未发送；未经确认不导入客户档案</li></ul></div>`;
  $("#backToRun").addEventListener("click", () => renderRunActivity(state.activeRun));
}

function leadFamilyClass(lead) {
  const bucket = familyBucket(lead.product_family);
  return bucket === "pet_food" ? "food" : bucket === "pet_supplies" ? "supplies" : "devices";
}

function hasVerifiedPerson(lead) {
  return (lead.contacts || []).some((contact) => contact.name && contact.role && contact.role_status === "已验证");
}

function renderLeads(run) {
  const all = run?.leads || [];
  const filtered = state.family === "all" ? all : all.filter((lead) => familyBucket(lead.product_family) === state.family);
  $("#resultCount").textContent = String(filtered.length);
  $("#footerResultCount").textContent = String(filtered.length);
  $("#navLeadCount").textContent = String(all.length);
  $("#runDateLabel").textContent = run ? `${prettyTime(run.created_at)} · ${escapeHtml(run.id)}` : "尚无运行记录";
  const csvEnabled = Boolean(run?.exports?.csv);
  const xlsxEnabled = Boolean(run?.exports?.xlsx);
  $("#exportCsv").disabled = !csvEnabled;
  $("#exportXlsx").disabled = !xlsxEnabled;
  if (!filtered.length) {
    const emptyText = all.length ? "这个品类目前没有候选" : run?.status === "running" || run?.status === "queued" ? "研究还在进行中" : run ? "本轮没有达到留存门槛的潜客" : "潜客审核池目前为空";
    const emptySub = all.length ? "试试查看全部品类，或切换其他品类。" : run?.status === "running" || run?.status === "queued" ? "本地候选出现后会自动显示在这里。" : run ? "可在右侧查看阻塞原因、重复记录或来源不足。" : "启动一轮本地研究后，候选公司、来源证据和草稿会显示在这里。";
    $("#leadTableBody").innerHTML = `<tr><td colspan="7"><div class="empty-state"><span class="empty-orbit">⌕</span><strong>${escapeHtml(emptyText)}</strong><p>${escapeHtml(emptySub)}</p>${!run ? `<button class="empty-action" id="emptyStart">预览并启动第一轮 <span>→</span></button>` : ""}</div></td></tr>`;
    $("#emptyStart")?.addEventListener("click", openPreview);
    return;
  }
  $("#leadTableBody").innerHTML = filtered.map((lead) => {
    const score = lead.score || {};
    const contact = hasVerifiedPerson(lead);
    const domain = (() => { try { return new URL(lead.website).hostname.replace(/^www\./, ""); } catch { return lead.website || ""; } })();
    const familyLabel = lead.product_family || "品类待核实";
    const action = lead.crm_record?.next_action || lead.score?.next_action || "人工复核企业与联系人";
    return `<tr class="lead-row ${state.selectedLead === lead.lead_id ? "selected" : ""}" data-lead="${escapeHtml(lead.lead_id)}"><td class="company-cell"><span class="company-name"><i class="company-mark">${escapeHtml((lead.company || "?").slice(0, 1).toUpperCase())}</i>${escapeHtml(lead.company || "未命名公司")}</span>${domain ? `<a class="company-site" href="${escapeHtml(lead.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(domain)}</a>` : `<small class="company-site">官网待确认</small>`}</td><td><span class="market-tag">${escapeHtml(lead.country || "未知市场")}</span></td><td><span class="family-tag ${leadFamilyClass(lead)}">${escapeHtml(familyLabel)}</span></td><td><span class="contact-status ${contact ? "verified" : ""}"><i></i>${contact ? "职位已核验" : "联系人未确认"}</span></td><td class="score-cell">${Number(score.total_score || 0)}<small>/ 100 <b class="tier-badge">${escapeHtml(score.tier || "-")}</b></small></td><td class="next-action">${escapeHtml(action)}</td><td class="row-arrow">›</td></tr>`;
  }).join("");
  document.querySelectorAll(".lead-row").forEach((row) => row.addEventListener("click", () => {
    const lead = all.find((item) => item.lead_id === row.dataset.lead);
    if (!lead) return;
    state.selectedLead = lead.lead_id; renderLeads(run); renderLeadDetail(lead);
  }));
}

function renderDashboard() {
  const run = state.activeRun;
  renderWorkflow(run); renderLeads(run);
  const selectedLead = run?.leads?.find((lead) => lead.lead_id === state.selectedLead);
  if (selectedLead) renderLeadDetail(selectedLead); else renderRunActivity(run);
  $("#heroRunLabel").textContent = run ? runStatusLabel(run) : "等待启动";
  $("#heroRunSub").textContent = run ? `${prettyTime(run.updated_at || run.created_at)} · ${run.leads?.length || 0} 家候选` : "先预览本轮将执行的步骤";
  $("#heroProgressBar").style.width = `${Math.max(0, Math.min(100, Number(run?.progress || 0)))}%`;
  $("#startRun").disabled = state.busy || isRunning(run);
  $("#startRun").innerHTML = state.busy ? "正在准备…" : isRunning(run) ? "研究进行中" : `<span>${run ? "再跑一轮研究" : "开始一轮研究"}</span><b>↗</b>`;
}

async function loadRuns({ preserveSelection = false } = {}) {
  try {
    const data = await api("/api/runs"); state.runs = data.runs || [];
    const currentId = preserveSelection ? state.activeRun?.id : null;
    state.activeRun = state.runs.find((run) => run.id === currentId) || state.runs[0] || null;
    renderDashboard();
  } catch (error) { showToast(error.message); }
}

async function openPreview() {
  if (state.busy || isRunning(state.activeRun)) return;
  state.busy = true; renderDashboard();
  try {
    const preview = await api("/api/runs/preview", { method: "POST", body: JSON.stringify({}) });
    const rows = [
      ["市场覆盖", `${preview.markets.length} 个区域 · ${preview.markets.map((market) => market.label).join("、")}`],
      ["产品范围", `${preview.product_families.length} 个品类 · ${preview.product_families.map((family) => family.label).join("、")}`],
      ["候选上限", `${preview.limit} 家，按证据与匹配度排序`],
      ["执行模型", preview.model_label || preview.model || "未配置"],
      ["推理强度", preview.reasoning_effort_label || preview.reasoning_effort || "未配置"],
      ["单阶段上限", `${preview.stage_timeout_minutes || 30} 分钟`],
      ["研究来源", preview.data_sources.join("、")],
      ["执行步骤", "HQ 销售中心分派 → 本地名单预检 → E03 公开研究 → 去重 → E08 评分 → E05 草稿 → E09 待审归档"]
    ];
    $("#previewDetails").innerHTML = rows.map(([label, value]) => `<div class="preview-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join("");
    $("#confirmDialog").showModal();
  } catch (error) { showToast(error.message); }
  finally { state.busy = false; renderDashboard(); }
}

async function startRun() {
  if (state.busy) return;
  state.busy = true; $("#confirmRun").disabled = true; $("#confirmRun").innerHTML = "正在创建任务…";
  try {
    const data = await api("/api/runs", { method: "POST", body: JSON.stringify({ confirmLocalRun: true }) });
    $("#confirmDialog").close(); state.selectedLead = null; showToast(`已创建本机任务 ${data.run_id}`);
    await loadRuns();
  } catch (error) { showToast(error.message); }
  finally { state.busy = false; $("#confirmRun").disabled = false; $("#confirmRun").innerHTML = `<span>确认启动本轮</span><b>→</b>`; renderDashboard(); }
}

function triggerExport(format) {
  if (!state.activeRun?.id) return;
  const link = document.createElement("a"); link.href = `/api/runs/${encodeURIComponent(state.activeRun.id)}.${format}`; link.download = `pet-leads-${state.activeRun.id}.${format}`; document.body.appendChild(link); link.click(); link.remove();
}

function showRules() {
  const rules = ["公开网页与项目现有名单作为首轮来源；不接入 Google Maps 或海关数据库。", "企业身份、客户匹配和联系人状态分别核验；未知状态会保留。", "宠物食品合规信息不完整时标为未知。", "E05 只生成本地渠道草稿，不向外触达；没有规格、数量和成本依据不报价。", "E09 只准备 CRM-ready 导入资料；客户档案导入仍需人工预览确认。", "新线索没有真实询盘或互动记录，不标成询盘，不评为 S 级。"];
  const target = $("#detailContent"); target.innerHTML = `<div class="detail-run-title"><span class="section-kicker">WORKFLOW GUARDRAILS</span><h3>运行边界</h3><p>执行结果保留证据、推断与未知。</p></div>${rules.map((rule, index) => `<div class="run-stage done"><span class="stage-dot">${index + 1}</span><span class="stage-copy"><strong>规则 ${index + 1}</strong><small>${escapeHtml(rule)}</small></span></div>`).join("")}`;
}

async function init() {
  try { state.config = await api("/api/config"); renderMarkets(); }
  catch (error) { showToast(error.message); }
  $("#startRun").addEventListener("click", openPreview);
  $("#emptyStart").addEventListener("click", openPreview);
  $("#confirmRun").addEventListener("click", startRun);
  $("#refreshRuns").addEventListener("click", () => loadRuns({ preserveSelection: true }));
  $("#exportCsv").addEventListener("click", () => triggerExport("csv"));
  $("#exportXlsx").addEventListener("click", () => triggerExport("xlsx"));
  $("#showRules").addEventListener("click", showRules);
  $("#hideDetail").addEventListener("click", () => renderRunActivity(state.activeRun));
  document.querySelectorAll(".filter-tab").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((item) => item.classList.toggle("active", item === button));
    state.family = button.dataset.family === "all" ? "all" : button.dataset.family === "宠物智能设备" ? "smart_devices" : button.dataset.family === "宠物用品" ? "pet_supplies" : "pet_food";
    renderLeads(state.activeRun);
  }));
  await loadRuns();
  window.setInterval(() => loadRuns({ preserveSelection: true }), 3500);
}

init();

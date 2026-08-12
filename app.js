const DB_NAME = "scene-study-cards";
const DB_VERSION = 1;
const STORE_NAME = "workspace";
const STATE_KEY = "main";
const FUNCTION_OPTIONS = ["铺垫", "推进", "转折", "收束", "过场", "高潮"];
const ACT_OPTIONS = ["", "一", "二上", "二下", "三"];
const BEAT_OPTIONS = ["", "开场", "激励事件", "第一幕转折", "中点", "第二幕转折", "高潮", "结局"];

const state = {
  version: 1,
  projects: [],
  activeProjectId: null,
  activeSceneId: null,
};

let activeWorkspaceTab = "scenes";
let saveTimer = null;
let toastTimer = null;
let renderToken = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const now = () => new Date().toISOString();
const currentProject = () => state.projects.find((project) => project.id === state.activeProjectId) || null;
const currentScene = () => currentProject()?.scenes.find((scene) => scene.id === state.activeSceneId) || null;
const safeFileName = (value) => (value || "未命名").replace(/[\\/:*?"<>|]/g, "-").trim();
const padScene = (number) => `S${String(number).padStart(2, "0")}`;
const displayDate = (iso) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(iso));

function newActionLine() {
  return { id: uid(), who: "", want: "", do: "", obstacle: "", change: "" };
}

function newScene(number) {
  return {
    id: uid(), number, title: "", timecode: "", duration: "", setting: "",
    valueDirection: "", functions: [], summary: "", screenshots: [],
    actionLines: [newActionLine()], knowledge: "", includeInsightCard: false,
    details: "", reviewNote: "", inspiration: "", scratchNotes: "",
    complete: false, act: "", beat: "", createdAt: now(), updatedAt: now(),
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadState() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function persistState() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(structuredClone(state), STATE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  $("#saveStatus").textContent = "已自动保存到本机";
}

function scheduleSave() {
  $("#saveStatus").textContent = "正在保存…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await persistState(); }
    catch (error) { console.error(error); showToast("保存失败，请立即导出备份"); }
  }, 350);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function renderApp() {
  const project = currentProject();
  $("#projectHome").classList.toggle("hidden", Boolean(project));
  $("#workspace").classList.toggle("hidden", !project);
  if (!project) renderProjects();
  else renderWorkspace();
}

function renderProjects() {
  const grid = $("#projectGrid");
  grid.innerHTML = "";
  $("#emptyProjects").classList.toggle("hidden", state.projects.length > 0);
  state.projects
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .forEach((project, index) => {
      const completed = project.scenes.filter((scene) => scene.complete).length;
      const total = project.scenes.length;
      const percent = total ? Math.round((completed / total) * 100) : 0;
      const card = document.createElement("article");
      card.className = "project-card";
      card.tabIndex = 0;
      card.innerHTML = `
        <span class="project-card-index">${String(index + 1).padStart(2, "0")}</span>
        <div>
          <h2>${escapeHtml(project.title)}</h2>
          <p>${escapeHtml([project.year, project.creator].filter(Boolean).join(" · ") || "尚未填写影片资料")}</p>
          <div class="progress-track"><i style="width:${percent}%"></i></div>
          <div class="project-card-foot"><span>${total} 场 · ${completed} 场完成</span><span>${displayDate(project.updatedAt)} 更新</span></div>
        </div>`;
      const open = () => { state.activeProjectId = project.id; state.activeSceneId = project.scenes[0]?.id || null; renderApp(); scheduleSave(); };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") open(); });
      grid.append(card);
    });
}

function renderWorkspace() {
  const project = currentProject();
  $("#projectTitleDisplay").textContent = project.title;
  $("#projectMetaDisplay").textContent = `${project.scenes.length} 场 · ${project.scenes.filter((scene) => scene.complete).length} 场完成${project.exportedAt && project.updatedAt > project.exportedAt ? " · 有尚未导出的更新" : ""}`;
  $$(".workspace-tab").forEach((button) => button.classList.toggle("active", button.dataset.workspaceTab === activeWorkspaceTab));
  $("#sceneWorkspace").classList.toggle("hidden", activeWorkspaceTab !== "scenes");
  $("#reviewWorkspace").classList.toggle("hidden", activeWorkspaceTab !== "review");
  $("#newSceneButton").classList.toggle("hidden", activeWorkspaceTab !== "scenes");
  renderSceneList();
  if (activeWorkspaceTab === "review") renderReview();
  else renderSceneEditor();
}

function renderSceneList() {
  const project = currentProject();
  const list = $("#sceneList");
  list.innerHTML = "";
  project.scenes.slice().sort((a, b) => a.number - b.number).forEach((scene) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `scene-list-item${scene.id === state.activeSceneId ? " active" : ""}`;
    button.innerHTML = `<b>${padScene(scene.number)}</b><span>${escapeHtml(scene.title || "未命名场次")}</span><i class="${scene.complete ? "done" : ""}"></i>`;
    button.addEventListener("click", () => {
      state.activeSceneId = scene.id;
      activeWorkspaceTab = "scenes";
      renderWorkspace();
      scheduleSave();
    });
    list.append(button);
  });
}

function renderSceneEditor() {
  const scene = currentScene();
  $("#noScene").classList.toggle("hidden", Boolean(scene));
  $("#sceneEditor").classList.toggle("hidden", !scene);
  if (!scene) return;
  $("#sceneNumberLabel").textContent = `${padScene(scene.number)} · ${currentProject().title}`;
  $("#sceneComplete").checked = scene.complete;
  const fieldMap = {
    title: "#sceneTitle", timecode: "#sceneTimecode", duration: "#sceneDuration",
    setting: "#sceneSetting", valueDirection: "#sceneValueDirection", summary: "#sceneSummary",
    knowledge: "#sceneKnowledge", includeInsightCard: "#includeInsightCard", details: "#sceneDetails",
    reviewNote: "#sceneReviewNote", inspiration: "#sceneInspiration", scratchNotes: "#sceneScratchNotes",
  };
  Object.entries(fieldMap).forEach(([key, selector]) => {
    const element = $(selector);
    if (element.type === "checkbox") element.checked = Boolean(scene[key]);
    else element.value = scene[key] || "";
  });
  renderFunctionChoices(scene);
  renderScreenshots(scene);
  renderActionLines(scene);
  updateInsightState(scene);
  updateCounters();
  renderCards();
}

function renderFunctionChoices(scene) {
  const root = $("#functionChoices");
  root.innerHTML = "";
  FUNCTION_OPTIONS.forEach((option) => {
    const label = document.createElement("label");
    label.className = "choice-chip";
    label.innerHTML = `<input type="checkbox" value="${option}" ${scene.functions.includes(option) ? "checked" : ""}><span>${option}</span>`;
    root.append(label);
  });
}

function renderActionLines(scene) {
  const root = $("#actionLines");
  root.innerHTML = "";
  scene.actionLines.forEach((line, index) => {
    const fragment = $("#actionLineTemplate").content.cloneNode(true);
    const article = $(".action-line", fragment);
    article.dataset.actionId = line.id;
    $(".action-index", fragment).textContent = String(index + 1).padStart(2, "0");
    $$('[data-action-field]', fragment).forEach((input) => { input.value = line[input.dataset.actionField] || ""; });
    const remove = $(".remove-action", fragment);
    remove.classList.toggle("hidden", scene.actionLines.length === 1);
    root.append(fragment);
  });
}

function screenshotSource(screenshot) { return typeof screenshot === "string" ? screenshot : screenshot.src; }
function screenshotPosition(screenshot) { return typeof screenshot === "string" ? { x: 50, y: 50 } : { x: screenshot.x ?? 50, y: screenshot.y ?? 50 }; }

function renderScreenshots(scene) {
  const root = $("#screenshotList");
  root.innerHTML = "";
  scene.screenshots.forEach((screenshot, index) => {
    const source = screenshotSource(screenshot);
    const position = screenshotPosition(screenshot);
    const item = document.createElement("div");
    item.className = "screenshot-entry";
    item.innerHTML = `
      <div class="screenshot-thumb"><img src="${source}" alt="场景截图 ${index + 1}" style="object-position:${position.x}% ${position.y}%"><b>${index === 0 ? "主截图" : `补充 ${index}`}</b><button class="remove-shot" type="button" aria-label="删除截图">×</button></div>
      <div class="shot-order"><button class="move-shot" data-direction="-1" type="button" ${index === 0 ? "disabled" : ""}>←</button><span>构图焦点</span><button class="move-shot" data-direction="1" type="button" ${index === scene.screenshots.length - 1 ? "disabled" : ""}>→</button></div>
      <label class="crop-control">横向<input data-crop-axis="x" type="range" min="0" max="100" value="${position.x}"></label>
      <label class="crop-control">纵向<input data-crop-axis="y" type="range" min="0" max="100" value="${position.y}"></label>`;
    $(".remove-shot", item).addEventListener("click", () => {
      scene.screenshots.splice(index, 1);
      touchScene(scene);
      renderScreenshots(scene);
      renderCards();
    });
    $$(".move-shot", item).forEach((button) => button.addEventListener("click", () => {
      const target = index + Number(button.dataset.direction);
      if (target < 0 || target >= scene.screenshots.length) return;
      [scene.screenshots[index], scene.screenshots[target]] = [scene.screenshots[target], scene.screenshots[index]];
      touchScene(scene); renderScreenshots(scene); renderCards();
    }));
    $$('[data-crop-axis]', item).forEach((input) => input.addEventListener("input", () => {
      if (typeof scene.screenshots[index] === "string") scene.screenshots[index] = { src: scene.screenshots[index], x: 50, y: 50 };
      scene.screenshots[index][input.dataset.cropAxis] = Number(input.value);
      $("img", item).style.objectPosition = `${scene.screenshots[index].x}% ${scene.screenshots[index].y}%`;
      touchScene(scene); renderCards();
    }));
    root.append(item);
  });
  $("#dropZone").classList.toggle("hidden", scene.screenshots.length >= 3);
}

function updateInsightState(scene) {
  $("#insightFields").classList.toggle("muted-fields", !scene.includeInsightCard);
  $("#thirdCardPreview").classList.toggle("hidden", !scene.includeInsightCard);
  $("#previewCount").textContent = scene.includeInsightCard ? "两张基础卡＋一张发现卡" : "两张基础卡";
}

function updateCounters() {
  $$('[data-counter-for]').forEach((counter) => {
    const element = $(`#${counter.dataset.counterFor}`);
    counter.textContent = `${element.value.length}/${element.maxLength}`;
  });
}

function touchScene(scene) {
  scene.updatedAt = now();
  const project = currentProject();
  project.updatedAt = scene.updatedAt;
  scheduleSave();
}

function createProject() {
  $("#projectForm").reset();
  $("#projectIdInput").value = "";
  $("#projectDialogTitle").textContent = "新建影片";
  $("#deleteProjectButton").classList.add("hidden");
  $("#projectDialog").showModal();
}

function editProject() {
  const project = currentProject();
  $("#projectIdInput").value = project.id;
  $("#projectTitle").value = project.title;
  $("#projectCreator").value = project.creator || "";
  $("#projectYear").value = project.year || "";
  $("#projectGoal").value = project.goal || "";
  $("#projectDialogTitle").textContent = "影片设置";
  $("#deleteProjectButton").classList.remove("hidden");
  $("#projectDialog").showModal();
}

function saveProjectFromDialog(event) {
  event.preventDefault();
  const id = $("#projectIdInput").value;
  let project = state.projects.find((item) => item.id === id);
  if (!project) {
    project = { id: uid(), title: "", creator: "", year: "", goal: "", scenes: [], createdAt: now(), updatedAt: now(), exportedAt: null, completedAt: null };
    state.projects.push(project);
  }
  project.title = $("#projectTitle").value.trim();
  project.creator = $("#projectCreator").value.trim();
  project.year = $("#projectYear").value.trim();
  project.goal = $("#projectGoal").value.trim();
  project.updatedAt = now();
  state.activeProjectId = project.id;
  state.activeSceneId = project.scenes[0]?.id || null;
  $("#projectDialog").close();
  renderApp();
  scheduleSave();
}

function addScene() {
  const project = currentProject();
  const next = project.scenes.length ? Math.max(...project.scenes.map((scene) => scene.number)) + 1 : 1;
  const scene = newScene(next);
  project.scenes.push(scene);
  state.activeSceneId = scene.id;
  project.updatedAt = now();
  activeWorkspaceTab = "scenes";
  renderWorkspace();
  scheduleSave();
  setTimeout(() => $("#sceneTitle").focus(), 0);
}

function deleteScene() {
  const project = currentProject();
  const scene = currentScene();
  if (!scene || !confirm(`确定删除 ${padScene(scene.number)}「${scene.title || "未命名场次"}」吗？此操作无法撤销。`)) return;
  project.scenes = project.scenes.filter((item) => item.id !== scene.id);
  project.scenes.sort((a, b) => a.number - b.number).forEach((item, index) => { item.number = index + 1; });
  state.activeSceneId = project.scenes[0]?.id || null;
  project.updatedAt = now();
  renderWorkspace();
  scheduleSave();
}

function deleteProject() {
  const project = currentProject();
  if (!confirm(`确定删除影片项目「${project.title}」及其全部场次吗？请先导出备份。`)) return;
  state.projects = state.projects.filter((item) => item.id !== project.id);
  state.activeProjectId = null;
  state.activeSceneId = null;
  $("#projectDialog").close();
  renderApp();
  scheduleSave();
}

async function addScreenshots(files) {
  const scene = currentScene();
  if (!scene) return;
  const images = [...files].filter((file) => file.type.startsWith("image/"));
  const room = 3 - scene.screenshots.length;
  if (!room) return showToast("每场最多保留三张截图");
  const selected = images.slice(0, room);
  for (const file of selected) scene.screenshots.push({ src: await fileToOptimizedDataUrl(file), x: 50, y: 50 });
  if (images.length > room) showToast("已保留前三张截图");
  touchScene(scene);
  renderScreenshots(scene);
  renderCards();
}

function fileToOptimizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxWidth = 1800;
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", .9));
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderReview() {
  const project = currentProject();
  $("#markProjectComplete").textContent = project.completedAt ? "已标记全片拉完" : "标记全片拉完";
  const body = $("#reviewTableBody");
  body.innerHTML = "";
  project.scenes.slice().sort((a, b) => a.number - b.number).forEach((scene) => {
    const row = document.createElement("tr");
    row.dataset.sceneId = scene.id;
    row.innerHTML = `
      <td><strong>${padScene(scene.number)}</strong></td>
      <td>${escapeHtml(scene.title || "未命名场次")}</td>
      <td>${escapeHtml(scene.functions.join(" / ") || "—")}</td>
      <td>${escapeHtml(scene.valueDirection || "—")}</td>
      <td>${selectHtml("act", ACT_OPTIONS, scene.act)}</td>
      <td>${selectHtml("beat", BEAT_OPTIONS, scene.beat)}</td>
      <td><button class="text-button open-review-scene" type="button">打开场次</button></td>`;
    body.append(row);
  });
}

function selectHtml(field, options, value) {
  return `<select data-review-field="${field}">${options.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${option || "暂不判断"}</option>`).join("")}</select>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function wrapText(ctx, text, maxWidth, maxLines = Infinity) {
  const paragraphs = String(text || "—").split(/\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    let line = "";
    for (const char of paragraph || " ") {
      const test = line + char;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = char;
        if (lines.length >= maxLines) break;
      } else line = test;
    }
    if (lines.length < maxLines && line.trim()) lines.push(line);
    if (lines.length >= maxLines) break;
  }
  if (lines.length === maxLines && text && lines.join("").length < String(text).replace(/\n/g, "").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1,2}$/, "…");
  }
  return lines;
}

function drawLines(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const lines = wrapText(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function cardBase(ctx, scene, number, title) {
  ctx.clearRect(0, 0, 1080, 1440);
  ctx.fillStyle = "#f7f2e8";
  ctx.fillRect(0, 0, 1080, 1440);
  ctx.fillStyle = "#d95f32";
  ctx.fillRect(0, 0, 18, 1440);
  ctx.fillStyle = "#20201d";
  ctx.font = "700 26px Georgia, 'Songti SC', serif";
  ctx.fillText(`${currentProject().title}  ·  ${padScene(scene.number)}`, 76, 84);
  ctx.textAlign = "right";
  ctx.fillStyle = "#d95f32";
  ctx.font = "700 22px Georgia, serif";
  ctx.fillText(`${String(number).padStart(2, "0")} / 03`, 1002, 84);
  ctx.textAlign = "left";
  ctx.fillStyle = "#20201d";
  ctx.font = "600 50px Georgia, 'Songti SC', serif";
  drawLines(ctx, title, 76, 156, 928, 62, 2);
  ctx.strokeStyle = "#d9d2c5";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(76, 1322); ctx.lineTo(1004, 1322); ctx.stroke();
  ctx.fillStyle = "#777269";
  ctx.font = "500 21px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText("拉片卡 · 场景学习工作台", 76, 1374);
  ctx.textAlign = "right";
  ctx.fillText(`${scene.timecode || "时间点未记"}${scene.duration ? `  ·  ${scene.duration}` : ""}`, 1004, 1374);
  ctx.textAlign = "left";
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source;
  });
}

function drawCoverImage(ctx, image, x, y, w, h, position = { x: 50, y: 50 }) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale, sh = h / scale;
  const sx = (image.width - sw) * ((position.x ?? 50) / 100), sy = (image.height - sh) * ((position.y ?? 50) / 100);
  ctx.save(); roundedRect(ctx, x, y, w, h, 22); ctx.clip(); ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h); ctx.restore();
}

async function drawCard1(scene, token) {
  const canvas = $("#cardCanvas1");
  const ctx = canvas.getContext("2d");
  cardBase(ctx, scene, 1, scene.title || "未命名场次");
  const y = 284;
  const images = await Promise.all(scene.screenshots.map((screenshot) => loadImage(screenshotSource(screenshot)).catch(() => null)));
  if (token !== renderToken) return;
  if (!images.length) {
    ctx.fillStyle = "#e6ded0"; roundedRect(ctx, 76, y, 928, 570, 22); ctx.fill();
    ctx.textAlign = "center"; ctx.fillStyle = "#9b9388"; ctx.font = "500 28px -apple-system, 'PingFang SC', sans-serif";
    ctx.fillText("粘贴一张场景截图", 540, y + 293); ctx.textAlign = "left";
  } else if (images.length === 1) drawCoverImage(ctx, images[0], 76, y, 928, 570, screenshotPosition(scene.screenshots[0]));
  else if (images.length === 2) {
    drawCoverImage(ctx, images[0], 76, y, 610, 570, screenshotPosition(scene.screenshots[0]));
    drawCoverImage(ctx, images[1], 700, y, 304, 570, screenshotPosition(scene.screenshots[1]));
  } else {
    drawCoverImage(ctx, images[0], 76, y, 610, 570, screenshotPosition(scene.screenshots[0]));
    drawCoverImage(ctx, images[1], 700, y, 304, 278, screenshotPosition(scene.screenshots[1]));
    drawCoverImage(ctx, images[2], 700, y + 292, 304, 278, screenshotPosition(scene.screenshots[2]));
  }
  ctx.fillStyle = "#20201d"; ctx.font = "600 29px Georgia, 'Songti SC', serif"; ctx.fillText("这一场发生了什么", 76, 916);
  ctx.fillStyle = "#3b3934"; ctx.font = "450 29px -apple-system, 'PingFang SC', sans-serif";
  drawLines(ctx, scene.summary || "尚未填写一句话概括。", 76, 968, 928, 45, 4);
  const tags = [scene.setting, scene.valueDirection, ...scene.functions].filter(Boolean);
  let tx = 76, ty = 1180;
  ctx.font = "600 21px -apple-system, 'PingFang SC', sans-serif";
  tags.forEach((tag) => {
    const width = ctx.measureText(tag).width + 34;
    if (tx + width > 1004) { tx = 76; ty += 48; }
    ctx.fillStyle = "#ead4c6"; roundedRect(ctx, tx, ty, width, 35, 18); ctx.fill();
    ctx.fillStyle = "#84391f"; ctx.fillText(tag, tx + 17, ty + 25); tx += width + 10;
  });
}

function actionLineText(line) {
  return [
    ["谁", line.who], ["要", line.want], ["做", line.do], ["阻", line.obstacle], ["变", line.change],
  ];
}

async function drawCard2(scene) {
  const canvas = $("#cardCanvas2");
  const ctx = canvas.getContext("2d");
  cardBase(ctx, scene, 2, "这场戏如何运转");
  let y = 270;
  const lines = scene.actionLines.slice(0, 3);
  const blockHeight = lines.length === 1 ? 590 : lines.length === 2 ? 375 : 265;
  lines.forEach((line, index) => {
    ctx.fillStyle = index === 0 ? "#20201d" : "#363d37"; roundedRect(ctx, 76, y, 928, blockHeight, 20); ctx.fill();
    ctx.fillStyle = "#f0ad88"; ctx.font = "700 21px Georgia, serif"; ctx.fillText(`ACTION ${String(index + 1).padStart(2, "0")}`, 106, y + 48);
    let textY = y + (lines.length === 3 ? 74 : 92);
    const maxLines = lines.length === 1 ? 3 : 1;
    actionLineText(line).forEach(([label, value]) => {
      ctx.fillStyle = "#f0ad88"; ctx.font = "700 22px -apple-system, 'PingFang SC', sans-serif"; ctx.fillText(label, 106, textY);
      ctx.fillStyle = "#fffaf2"; ctx.font = "450 23px -apple-system, 'PingFang SC', sans-serif";
      const fieldLines = lines.length === 2 && label === "做" ? 2 : maxLines;
      const wrapped = wrapText(ctx, value || "—", 800, fieldLines);
      wrapped.forEach((part, lineIndex) => ctx.fillText(part, 156, textY + lineIndex * 34));
      textY += Math.max(36, wrapped.length * 34 + 9);
    });
    y += blockHeight + 18;
  });
  const knowledgeY = y + 15;
  ctx.fillStyle = "#d95f32"; ctx.font = "700 22px -apple-system, 'PingFang SC', sans-serif"; ctx.fillText("知", 76, knowledgeY);
  ctx.fillStyle = "#20201d"; ctx.font = "450 25px -apple-system, 'PingFang SC', sans-serif";
  drawLines(ctx, scene.knowledge || "观众新知道了什么？", 126, knowledgeY, 878, 38, lines.length === 1 ? 6 : 4);
}

async function drawCard3(scene) {
  const canvas = $("#cardCanvas3");
  const ctx = canvas.getContext("2d");
  cardBase(ctx, scene, 3, "我从这场戏带走什么");
  const sections = [
    ["细节分析", scene.details], ["回看补记", scene.reviewNote], ["创作转译", scene.inspiration],
  ];
  let y = 282;
  sections.forEach(([title, body], index) => {
    ctx.fillStyle = index === 2 ? "#d95f32" : "#627166";
    ctx.font = "700 22px -apple-system, 'PingFang SC', sans-serif";
    ctx.fillText(`${String(index + 1).padStart(2, "0")}  ${title}`, 76, y);
    ctx.fillStyle = "#20201d";
    ctx.font = index === 2 ? "550 29px -apple-system, 'PingFang SC', sans-serif" : "450 27px -apple-system, 'PingFang SC', sans-serif";
    y = drawLines(ctx, body || "—", 76, y + 53, 928, 43, 5) + 50;
    if (index < 2) { ctx.strokeStyle = "#d9d2c5"; ctx.beginPath(); ctx.moveTo(76, y - 16); ctx.lineTo(1004, y - 16); ctx.stroke(); }
  });
}

async function renderCards() {
  const scene = currentScene();
  if (!scene) return;
  updateInsightState(scene);
  const token = ++renderToken;
  await Promise.all([drawCard1(scene, token), drawCard2(scene), scene.includeInsightCard ? drawCard3(scene) : Promise.resolve()]);
}

function downloadCanvas(number) {
  const scene = currentScene();
  if (number === 3 && !scene.includeInsightCard) return;
  const canvas = $(`#cardCanvas${number}`);
  canvas.toBlob((blob) => downloadBlob(blob, `${safeFileName(currentProject().title)}-${padScene(scene.number)}-${number}.png`), "image/png");
}

async function downloadAllCards() {
  const scene = currentScene();
  const count = scene.includeInsightCard ? 3 : 2;
  for (let number = 1; number <= count; number += 1) {
    await new Promise((resolve) => $(`#cardCanvas${number}`).toBlob((blob) => { downloadBlob(blob, `${safeFileName(currentProject().title)}-${padScene(scene.number)}-${number}.png`); setTimeout(resolve, 180); }, "image/png"));
  }
  showToast(`已下载 ${count} 张卡片`);
}

function yamlString(value) {
  const text = String(value ?? "");
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function sceneMarkdown(project, scene) {
  const people = [...new Set(scene.actionLines.flatMap((line) => line.who.split(/[、，,\/]/).map((item) => item.trim())).filter(Boolean))];
  const actions = scene.actionLines.map((line, index) => `### 行动线 ${index + 1}\n\n- **谁** ${line.who || "—"}\n- **要** ${line.want || "—"}\n- **做** ${line.do || "—"}\n- **阻** ${line.obstacle || "—"}\n- **变** ${line.change || "—"}`).join("\n\n");
  const screenshotEmbeds = scene.screenshots.map((_, index) => `![[assets/${padScene(scene.number)}-${index + 1}.jpg]]`).join("\n");
  return `---
场号: ${yamlString(padScene(scene.number))}
标题: ${yamlString(scene.title)}
戏剧功能: [${scene.functions.map(yamlString).join(", ")}]
价值走向: ${yamlString(scene.valueDirection)}
幕: ${yamlString(scene.act)}
场景类型: ${yamlString(scene.setting)}
节拍位置: ${yamlString(scene.beat)}
人物: [${people.map(yamlString).join(", ")}]
时间点: ${yamlString(scene.timecode)}
时长: ${yamlString(scene.duration)}
完成: ${scene.complete ? "true" : "false"}
tags:
  - 拉片
  - ${yamlString(`片名/${project.title}`)}
---

## ${padScene(scene.number)} · ${scene.title || "未命名场次"}

${scene.summary || ""}

${screenshotEmbeds}

${actions}

## 观众新知道了什么

${scene.knowledge || "—"}

## 细节分析

${scene.details || ""}

## 回看补记

${scene.reviewNote || ""}

## 对我自己创作的启发

${scene.inspiration || ""}
`;
}

function overviewMarkdown(project) {
  const rows = project.scenes.slice().sort((a, b) => a.number - b.number).map((scene) => `| [[${padScene(scene.number)}]] | ${scene.title || "未命名场次"} | ${scene.functions.join(" / ") || "—"} | ${scene.valueDirection || "—"} | ${scene.act || "—"} | ${scene.beat || "—"} |`).join("\n");
  return `# ${project.title} · 拉片总览

${project.creator || project.year ? `> ${[project.year, project.creator].filter(Boolean).join(" · ")}\n` : ""}${project.goal ? `> 学习目标：${project.goal}\n` : ""}
## 全片场次一览

| 场号 | 标题 | 戏剧功能 | 价值走向 | 幕 | 节拍位置 |
| --- | --- | --- | --- | --- | --- |
${rows || "| — | 尚无场次 | — | — | — | — |"}
`;
}

function exportSingleScene() {
  const project = currentProject(), scene = currentScene();
  downloadBlob(new Blob([sceneMarkdown(project, scene)], { type: "text/markdown;charset=utf-8" }), `${padScene(scene.number)}.md`);
  showToast("已导出单场 Markdown");
}

async function exportWholeProject() {
  const project = currentProject();
  const files = [{ name: `${safeFileName(project.title)}/总览.md`, data: overviewMarkdown(project) }];
  project.scenes.forEach((scene) => {
    files.push({ name: `${safeFileName(project.title)}/${padScene(scene.number)}.md`, data: sceneMarkdown(project, scene) });
    scene.screenshots.forEach((screenshot, index) => {
      files.push({ name: `${safeFileName(project.title)}/assets/${padScene(scene.number)}-${index + 1}.jpg`, data: dataUrlToBytes(screenshotSource(screenshot)) });
    });
  });
  files.push({ name: `${safeFileName(project.title)}/拉片卡数据备份.json`, data: JSON.stringify({ version: 1, project }, null, 2) });
  const zip = createZip(files);
  downloadBlob(zip, `${safeFileName(project.title)}-Obsidian归档.zip`);
  project.exportedAt = now();
  project.updatedAt = project.updatedAt || now();
  scheduleSave();
  renderWorkspace();
  showToast("已导出 Obsidian 影片文件夹");
}

function dataUrlToBytes(dataUrl) {
  const binary = atob(dataUrl.split(",")[1]);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function u16(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255); }
function u32(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function concatBytes(parts) { const total = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(total); let offset = 0; parts.forEach((part) => { out.set(part, offset); offset += part.length; }); return out; }

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;
  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = concatBytes([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    const central = concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    localParts.push(local); centralParts.push(central); offset += local.length;
  });
  const central = concatBytes(centralParts);
  const end = concatBytes([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
  return new Blob([...localParts, central, end], { type: "application/zip" });
}

function exportBackup() {
  downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), `拉片卡-完整备份-${new Date().toISOString().slice(0, 10)}.json`);
  showToast("已导出完整数据备份");
}

async function restoreBackup(file) {
  try {
    const restored = JSON.parse(await file.text());
    if (!restored || !Array.isArray(restored.projects)) throw new Error("invalid");
    if (!confirm("恢复备份会替换当前浏览器中的全部拉片数据。确定继续吗？")) return;
    Object.assign(state, restored);
    state.activeProjectId = null; state.activeSceneId = null;
    await persistState(); renderApp(); showToast("备份已恢复");
  } catch { showToast("无法读取这个备份文件"); }
}

function bindEvents() {
  $("#newProjectButton").addEventListener("click", createProject);
  $("#projectForm").addEventListener("submit", saveProjectFromDialog);
  $("#closeProjectDialog").addEventListener("click", () => $("#projectDialog").close());
  $("#editProjectButton").addEventListener("click", editProject);
  $("#deleteProjectButton").addEventListener("click", deleteProject);
  $("#homeButton").addEventListener("click", () => { state.activeProjectId = null; state.activeSceneId = null; renderApp(); scheduleSave(); });
  $("#backToProjects").addEventListener("click", () => { state.activeProjectId = null; state.activeSceneId = null; renderApp(); scheduleSave(); });
  $("#newSceneButton").addEventListener("click", addScene);
  $("#deleteSceneButton").addEventListener("click", deleteScene);
  $("#addActionLine").addEventListener("click", () => {
    const scene = currentScene();
    if (scene.actionLines.length >= 3) return showToast("每场最多保留三条行动线");
    scene.actionLines.push(newActionLine()); touchScene(scene); renderActionLines(scene); renderCards();
  });
  $("#actionLines").addEventListener("click", (event) => {
    const button = event.target.closest(".remove-action"); if (!button) return;
    const scene = currentScene(); const id = button.closest(".action-line").dataset.actionId;
    scene.actionLines = scene.actionLines.filter((line) => line.id !== id); touchScene(scene); renderActionLines(scene); renderCards();
  });
  $("#sceneForm").addEventListener("input", (event) => {
    const scene = currentScene(); if (!scene) return;
    const field = event.target.dataset.field;
    if (field) scene[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    const actionField = event.target.dataset.actionField;
    if (actionField) {
      const line = scene.actionLines.find((item) => item.id === event.target.closest(".action-line").dataset.actionId);
      if (line) line[actionField] = event.target.value;
    }
    if (event.target.closest("#functionChoices")) scene.functions = $$('#functionChoices input:checked').map((input) => input.value);
    touchScene(scene); updateCounters(); updateInsightState(scene); renderSceneList(); renderCards();
  });
  $("#sceneComplete").addEventListener("change", (event) => { const scene = currentScene(); scene.complete = event.target.checked; touchScene(scene); renderSceneList(); renderWorkspaceHeadingOnly(); });
  $("#screenshotInput").addEventListener("change", (event) => { addScreenshots(event.target.files); event.target.value = ""; });
  $("#dropZone").addEventListener("dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); });
  $("#dropZone").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
  $("#dropZone").addEventListener("drop", (event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); addScreenshots(event.dataTransfer.files); });
  document.addEventListener("paste", (event) => { if (!currentScene() || activeWorkspaceTab !== "scenes") return; const files = [...event.clipboardData.files]; if (files.some((file) => file.type.startsWith("image/"))) { event.preventDefault(); addScreenshots(files); } });
  $$(".workspace-tab").forEach((button) => button.addEventListener("click", () => { activeWorkspaceTab = button.dataset.workspaceTab; renderWorkspace(); }));
  $("#reviewTableBody").addEventListener("change", (event) => {
    const field = event.target.dataset.reviewField; if (!field) return;
    const scene = currentProject().scenes.find((item) => item.id === event.target.closest("tr").dataset.sceneId);
    scene[field] = event.target.value; touchScene(scene);
  });
  $("#reviewTableBody").addEventListener("click", (event) => {
    if (!event.target.closest(".open-review-scene")) return;
    state.activeSceneId = event.target.closest("tr").dataset.sceneId; activeWorkspaceTab = "scenes"; renderWorkspace();
  });
  $("#markProjectComplete").addEventListener("click", () => { const project = currentProject(); project.completedAt = project.completedAt ? null : now(); project.updatedAt = now(); renderReview(); scheduleSave(); });
  $$(".download-card").forEach((button) => button.addEventListener("click", () => downloadCanvas(Number(button.dataset.card))));
  $("#downloadAllCards").addEventListener("click", downloadAllCards);
  $("#exportSceneMarkdown").addEventListener("click", exportSingleScene);
  $("#exportProjectButton").addEventListener("click", exportWholeProject);
  $("#backupButton").addEventListener("click", exportBackup);
  $("#restoreInput").addEventListener("change", (event) => { if (event.target.files[0]) restoreBackup(event.target.files[0]); event.target.value = ""; });
}

function renderWorkspaceHeadingOnly() {
  const project = currentProject();
  $("#projectMetaDisplay").textContent = `${project.scenes.length} 场 · ${project.scenes.filter((scene) => scene.complete).length} 场完成${project.exportedAt && project.updatedAt > project.exportedAt ? " · 有尚未导出的更新" : ""}`;
}

async function init() {
  try {
    const saved = await loadState();
    if (saved?.projects) Object.assign(state, saved);
  } catch (error) { console.error(error); showToast("本机数据读取失败，请使用备份恢复"); }
  state.activeProjectId = null;
  state.activeSceneId = null;
  bindEvents();
  renderApp();
}

init();

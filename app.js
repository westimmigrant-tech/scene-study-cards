const DB_NAME = "scene-study-cards";
const DB_VERSION = 1;
const STORE_NAME = "workspace";
const STATE_KEY = "main";
const RECOVERY_KEY = "scene-study-cards:pending-state-v1";
const BACKUP_VERSION = 1;
const FUNCTION_OPTIONS = ["人物建立", "关系建立", "信息揭示", "伏笔", "铺垫", "推进", "转折", "收束", "过场", "高潮"];
const ACT_OPTIONS = ["", "一", "二上", "二下", "三"];
const BEAT_OPTIONS = ["", "开场", "激励事件", "第一幕转折", "中点", "第二幕转折", "高潮", "结局"];

const state = {
  version: BACKUP_VERSION,
  projects: [],
  activeProjectId: null,
  activeSceneId: null,
  persistedAt: 0,
};

let activeWorkspaceTab = "scenes";
let saveTimer = null;
let saveRevision = 0;
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
    id: uid(), number, title: "", startTime: "", endTime: "", duration: "", setting: "",
    unitType: "独立场", sequence: "", valueAxis: "", valueFrom: "", valueTo: "", valueDirection: "",
    functions: [], summary: "", screenshots: [], actionLines: [newActionLine()], knowledge: "", hypothesis: "",
    includeInsightCard: false,
    details: "", reviewNote: "", inspiration: "", scratchNotes: "",
    complete: false, act: "", beat: "", createdAt: now(), updatedAt: now(),
  };
}

function ensureSceneFields(scene) {
  if (!("startTime" in scene)) scene.startTime = "";
  if (!("endTime" in scene)) scene.endTime = scene.timecode || "";
  if (!("duration" in scene)) scene.duration = "";
  if (!("unitType" in scene)) scene.unitType = "独立场";
  if (!("sequence" in scene)) scene.sequence = "";
  if (!("valueAxis" in scene)) scene.valueAxis = "";
  if (!("valueFrom" in scene)) scene.valueFrom = "";
  if (!("valueTo" in scene)) scene.valueTo = "";
  if (!("hypothesis" in scene)) scene.hypothesis = "";
  if (!Array.isArray(scene.functions)) scene.functions = [];
  if (!Array.isArray(scene.actionLines) || !scene.actionLines.length) scene.actionLines = [newActionLine()];
  if (scene.valueDirection === "过场") {
    scene.valueDirection = "";
    if (!scene.functions.includes("过场")) scene.functions.push("过场");
  }
  scene.screenshots = (scene.screenshots || []).map((screenshot) => {
    if (typeof screenshot === "string") return { src: screenshot, x: 50, y: 50, fit: "cover" };
    return { ...screenshot, x: screenshot.x ?? 50, y: screenshot.y ?? 50, fit: screenshot.fit === "contain" ? "contain" : "cover" };
  });
}

function normalizeWorkspace(workspace) {
  workspace.projects?.forEach((project) => project.scenes?.forEach(ensureSceneFields));
}

function screenshotRecoveryKey(screenshot) {
  const source = screenshotSource(screenshot);
  return `${source.length}:${source.slice(0, 32)}:${source.slice(-32)}`;
}

function recoveryStateSnapshot() {
  return {
    version: BACKUP_VERSION,
    activeProjectId: state.activeProjectId,
    activeSceneId: state.activeSceneId,
    projects: state.projects.map((project) => ({
      ...project,
      scenes: project.scenes.map((scene) => ({
        ...scene,
        screenshots: scene.screenshots.map((screenshot) => ({
          key: screenshotRecoveryKey(screenshot),
          ...screenshotPosition(screenshot),
          fit: screenshotFit(screenshot),
        })),
      })),
    })),
  };
}

function writeRecoveryJournal() {
  try {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({
      version: 1,
      createdAt: Date.now(),
      state: recoveryStateSnapshot(),
    }));
  } catch (error) {
    console.warn("无法写入待保存恢复记录", error);
  }
}

function readRecoveryJournal() {
  try {
    const recovery = JSON.parse(localStorage.getItem(RECOVERY_KEY) || "null");
    if (recovery?.version !== 1 || !Array.isArray(recovery.state?.projects)) return null;
    return recovery;
  } catch (error) {
    console.warn("待保存恢复记录已损坏", error);
    localStorage.removeItem(RECOVERY_KEY);
    return null;
  }
}

function clearRecoveryJournal() {
  try { localStorage.removeItem(RECOVERY_KEY); }
  catch (error) { console.warn("无法清除待保存恢复记录", error); }
}

function mergeRecoveryState(saved, recovered) {
  const savedProjects = new Map((saved?.projects || []).map((project) => [project.id, project]));
  return {
    ...recovered,
    persistedAt: saved?.persistedAt || 0,
    projects: recovered.projects.map((project) => {
      const savedScenes = new Map((savedProjects.get(project.id)?.scenes || []).map((scene) => [scene.id, scene]));
      return {
        ...project,
        scenes: project.scenes.map((scene) => {
          const savedScreenshots = new Map((savedScenes.get(scene.id)?.screenshots || []).map((screenshot) => [screenshotRecoveryKey(screenshot), screenshot]));
          const screenshots = (scene.screenshots || []).map((reference) => {
            const savedScreenshot = savedScreenshots.get(reference.key);
            if (!savedScreenshot) return null;
            return { src: screenshotSource(savedScreenshot), x: reference.x ?? 50, y: reference.y ?? 50, fit: reference.fit === "contain" ? "contain" : screenshotFit(savedScreenshot) };
          }).filter(Boolean);
          return { ...scene, screenshots };
        }),
      };
    }),
  };
}

function parseTimecode(value) {
  const parts = String(value || "").trim().replace(/：/g, ":").split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (parts.length === 2) {
    const [minutes, seconds] = numbers;
    return seconds < 60 ? minutes * 60 + seconds : null;
  }
  const [hours, minutes, seconds] = numbers;
  return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours) return `约${hours}小时${minutes ? `${minutes}分钟` : ""}${remainingSeconds ? `${remainingSeconds}秒` : ""}`;
  if (minutes) return `约${minutes}分${remainingSeconds ? `${remainingSeconds}秒` : "钟"}`;
  return `约${remainingSeconds}秒`;
}

function timeRangeResult(scene) {
  const start = String(scene.startTime || "").trim();
  const end = String(scene.endTime || "").trim();
  if (!start && !end) return { label: "", hint: "填写起止时间后自动计算", error: false };
  if (!start || !end) return { label: "", hint: `还需填写${start ? "结束" : "开始"}时间`, error: false };
  const startSeconds = parseTimecode(start);
  const endSeconds = parseTimecode(end);
  if (startSeconds === null || endSeconds === null) return { label: "", hint: "请使用 4:00 或 00:04:00 这样的格式", error: true };
  if (endSeconds <= startSeconds) return { label: "", hint: "结束时间需要晚于开始时间", error: true };
  return { label: formatDuration(endSeconds - startSeconds), hint: "已根据起止时间自动计算", error: false };
}

function durationLabel(scene) {
  return timeRangeResult(scene).label || scene.duration || "";
}

function activeActionLines(scene) {
  return (scene.actionLines || []).filter((line) => [line.who, line.want, line.do, line.obstacle, line.change].some((value) => String(value || "").trim()));
}

function sceneValueChangeLabel(scene) {
  const transition = [scene.valueFrom, scene.valueTo].filter(Boolean).join("→");
  const change = [scene.valueAxis, transition].filter(Boolean).join("：");
  return [change, scene.valueDirection].filter(Boolean).join(" · ");
}

function primarySceneResult(scene) {
  return activeActionLines(scene).find((line) => String(line.change || "").trim())?.change || "";
}

function sceneQualityWarnings(scene) {
  const warnings = [];
  if (!String(scene.title || "").trim()) warnings.push("场景标题");
  if (!String(scene.summary || "").trim()) warnings.push("一句话概括");
  const timeResult = timeRangeResult(scene);
  if (timeResult.error || !scene.startTime || !scene.endTime) warnings.push("有效起止时间");
  if (scene.unitType === "序列片段" && !String(scene.sequence || "").trim()) warnings.push("所属序列");
  const actions = activeActionLines(scene);
  if (!actions.length) warnings.push("主行动线");
  actions.forEach((line, index) => {
    const missing = [];
    if (!String(line.who || "").trim()) missing.push("谁");
    if (!String(line.want || "").trim()) missing.push("要");
    if (!String(line.do || "").trim()) missing.push("做");
    if (scene.unitType !== "序列片段" && !String(line.change || "").trim()) missing.push("结果");
    if (missing.length) warnings.push(`行动线 ${index + 1} 的${missing.join("／")}`);
  });
  const valueParts = [scene.valueAxis, scene.valueFrom, scene.valueTo, scene.valueDirection].filter((value) => String(value || "").trim()).length;
  if (valueParts > 0 && valueParts < 3) warnings.push("完整的价值变化");
  return warnings;
}

function renderQualityHint(scene) {
  const hint = $("#sceneQualityHint");
  const warnings = sceneQualityWarnings(scene);
  hint.classList.toggle("ready", warnings.length === 0);
  hint.classList.toggle("warning", warnings.length > 0);
  if (!warnings.length) {
    hint.textContent = "本场基础信息已齐，可以标记完成。";
    return;
  }
  hint.textContent = `${scene.complete ? "已标记完成，仍建议检查" : "完成前建议补充"}：${warnings.join("、")}。这些是提醒，不会阻止保存。`;
}

function timeRangeLabel(scene) {
  const start = String(scene.startTime || "").trim();
  const end = String(scene.endTime || "").trim();
  if (start && end) return `${start}—${end}`;
  if (start) return `开始 ${start}`;
  if (end) return `结束 ${end}`;
  return "时间未记";
}

function updateDurationField(scene) {
  const result = timeRangeResult(scene);
  if (result.label) scene.duration = result.label;
  else if (scene.startTime && scene.endTime) scene.duration = "";
  const legacyDuration = !result.label && (!scene.startTime || !scene.endTime) ? scene.duration : "";
  $("#sceneDuration").value = result.label || legacyDuration;
  const hint = $("#sceneDurationHint");
  hint.textContent = legacyDuration ? "原有时长已保留；补齐起止时间后会自动更新" : result.hint;
  hint.classList.toggle("error", result.error);
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
  const revision = saveRevision;
  state.persistedAt = Date.now();
  const snapshot = structuredClone(state);
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(snapshot, STATE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  if (revision === saveRevision) clearRecoveryJournal();
  $("#saveStatus").textContent = "已自动保存到本机";
}

function scheduleSave() {
  $("#saveStatus").textContent = "正在保存…";
  clearTimeout(saveTimer);
  saveRevision += 1;
  writeRecoveryJournal();
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try { await persistState(); }
    catch (error) { console.error(error); showToast("保存失败，请立即导出备份"); }
  }, 350);
}

function flushPendingState() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  persistState().catch((error) => {
    console.error(error);
    showToast("保存失败；下次打开时会尝试恢复刚才的输入");
  });
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
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `打开影片项目：${project.title}`);
      card.innerHTML = `
        <span class="project-card-index">${String(index + 1).padStart(2, "0")}</span>
        <div>
          <h2>${escapeHtml(project.title)}</h2>
          <p>${escapeHtml([project.year, project.creator].filter(Boolean).join(" · ") || "尚未填写影片资料")}</p>
          <div class="progress-track"><i style="width:${percent}%"></i></div>
          <div class="project-card-foot"><span>${total} 场 · ${completed} 场完成</span><span>${displayDate(project.updatedAt)} 更新</span></div>
        </div>`;
      const open = () => { state.activeProjectId = project.id; state.activeSceneId = project.scenes[0]?.id || null; activeWorkspaceTab = "scenes"; renderApp(); scheduleSave(); };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
      grid.append(card);
    });
}

function renderWorkspace() {
  const project = currentProject();
  const showingScenes = activeWorkspaceTab === "scenes";
  $("#projectTitleDisplay").textContent = project.title;
  $("#projectMetaDisplay").textContent = `${project.scenes.length} 场 · ${project.scenes.filter((scene) => scene.complete).length} 场完成${project.exportedAt && project.updatedAt > project.exportedAt ? " · 有尚未导出的更新" : ""}`;
  $$(".workspace-tab").forEach((button) => {
    const selected = button.dataset.workspaceTab === activeWorkspaceTab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $("#sceneWorkspace").classList.remove("hidden");
  $("#scenesPanel").classList.toggle("hidden", !showingScenes);
  $("#reviewWorkspace").classList.toggle("hidden", showingScenes);
  $("#newSceneButton").classList.toggle("hidden", !showingScenes);
  renderSceneList();
  if (showingScenes) renderSceneEditor();
  else renderReview();
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
  ensureSceneFields(scene);
  const fieldMap = {
    title: "#sceneTitle", startTime: "#sceneStartTime", endTime: "#sceneEndTime",
    unitType: "#sceneUnitType", sequence: "#sceneSequence", setting: "#sceneSetting",
    valueAxis: "#sceneValueAxis", valueFrom: "#sceneValueFrom", valueTo: "#sceneValueTo",
    valueDirection: "#sceneValueDirection", summary: "#sceneSummary", knowledge: "#sceneKnowledge",
    hypothesis: "#sceneHypothesis", includeInsightCard: "#includeInsightCard", details: "#sceneDetails",
    reviewNote: "#sceneReviewNote", inspiration: "#sceneInspiration", scratchNotes: "#sceneScratchNotes",
  };
  Object.entries(fieldMap).forEach(([key, selector]) => {
    const element = $(selector);
    if (element.type === "checkbox") element.checked = Boolean(scene[key]);
    else element.value = scene[key] || "";
  });
  updateDurationField(scene);
  renderFunctionChoices(scene);
  renderScreenshots(scene);
  renderActionLines(scene);
  updateInsightState(scene);
  updateCounters();
  renderQualityHint(scene);
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
function screenshotFit(screenshot) { return typeof screenshot === "string" ? "cover" : screenshot.fit === "contain" ? "contain" : "cover"; }

function renderScreenshots(scene) {
  const root = $("#screenshotList");
  root.innerHTML = "";
  scene.screenshots.forEach((screenshot, index) => {
    const source = screenshotSource(screenshot);
    const position = screenshotPosition(screenshot);
    const fit = screenshotFit(screenshot);
    const item = document.createElement("div");
    item.className = "screenshot-entry";
    item.innerHTML = `
      <div class="screenshot-thumb"><img src="${source}" alt="场景截图 ${index + 1}" style="object-position:${position.x}% ${position.y}%;object-fit:${fit}"><b>${index === 0 ? "主截图" : `补充 ${index}`}</b><button class="remove-shot" type="button" aria-label="删除截图">×</button></div>
      <div class="shot-order"><button class="move-shot" data-direction="-1" type="button" ${index === 0 ? "disabled" : ""}>←</button><span>构图焦点</span><button class="move-shot" data-direction="1" type="button" ${index === scene.screenshots.length - 1 ? "disabled" : ""}>→</button></div>
      <label class="crop-control">横向<input data-crop-axis="x" type="range" min="0" max="100" value="${position.x}"></label>
      <label class="crop-control">纵向<input data-crop-axis="y" type="range" min="0" max="100" value="${position.y}"></label>
      <label class="fit-control">画面方式<select data-fit-mode><option value="cover" ${fit === "cover" ? "selected" : ""}>填满卡片（可裁切）</option><option value="contain" ${fit === "contain" ? "selected" : ""}>完整画面（不裁切）</option></select></label>`;
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
      if (typeof scene.screenshots[index] === "string") scene.screenshots[index] = { src: scene.screenshots[index], x: 50, y: 50, fit: "cover" };
      scene.screenshots[index][input.dataset.cropAxis] = Number(input.value);
      $("img", item).style.objectPosition = `${scene.screenshots[index].x}% ${scene.screenshots[index].y}%`;
      touchScene(scene); renderCards();
    }));
    $("[data-fit-mode]", item).addEventListener("change", (event) => {
      if (typeof scene.screenshots[index] === "string") scene.screenshots[index] = { src: scene.screenshots[index], x: 50, y: 50, fit: "cover" };
      scene.screenshots[index].fit = event.target.value === "contain" ? "contain" : "cover";
      $("img", item).style.objectFit = scene.screenshots[index].fit;
      touchScene(scene); renderCards();
    });
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
  const orderedScenes = project.scenes.slice().sort((a, b) => a.number - b.number);
  const deletedIndex = orderedScenes.findIndex((item) => item.id === scene.id);
  project.scenes = project.scenes.filter((item) => item.id !== scene.id);
  project.scenes.sort((a, b) => a.number - b.number).forEach((item, index) => { item.number = index + 1; });
  state.activeSceneId = project.scenes[Math.min(deletedIndex, project.scenes.length - 1)]?.id || null;
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
  for (const file of selected) scene.screenshots.push({ src: await fileToOptimizedDataUrl(file), x: 50, y: 50, fit: "cover" });
  if (images.length > room) showToast(`本次已添加 ${selected.length} 张，另有 ${images.length - selected.length} 张因数量上限未添加`);
  touchScene(scene);
  renderScreenshots(scene);
  renderCards();
  flushPendingState();
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
      <td>${escapeHtml([scene.sequence, scene.unitType].filter(Boolean).join(" · ") || "—")}</td>
      <td>${escapeHtml(scene.functions.join(" / ") || "—")}</td>
      <td>${escapeHtml(sceneValueChangeLabel(scene) || "—")}</td>
      <td>${escapeHtml(primarySceneResult(scene) || (scene.unitType === "序列片段" ? "序列继续" : "—"))}</td>
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
  const totalCards = scene.includeInsightCard ? 3 : 2;
  ctx.fillText(`${String(number).padStart(2, "0")} / ${String(totalCards).padStart(2, "0")}`, 1002, 84);
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
  const footerDuration = durationLabel(scene);
  ctx.fillText(`${timeRangeLabel(scene)}${footerDuration ? `  ·  ${footerDuration}` : ""}`, 1004, 1374);
  ctx.textAlign = "left";
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source;
  });
}

function drawFrameImage(ctx, image, x, y, w, h, screenshot) {
  const position = screenshotPosition(screenshot);
  const fit = screenshotFit(screenshot);
  ctx.save();
  roundedRect(ctx, x, y, w, h, 22);
  ctx.clip();
  if (fit === "contain") {
    ctx.fillStyle = "#171714";
    ctx.fillRect(x, y, w, h);
    const scale = Math.min(w / image.width, h / image.height);
    const dw = image.width * scale, dh = image.height * scale;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    const scale = Math.max(w / image.width, h / image.height);
    const sw = w / scale, sh = h / scale;
    const sx = (image.width - sw) * ((position.x ?? 50) / 100), sy = (image.height - sh) * ((position.y ?? 50) / 100);
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }
  ctx.restore();
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
  } else if (images.length === 1) drawFrameImage(ctx, images[0], 76, y, 928, 570, scene.screenshots[0]);
  else if (images.length === 2) {
    drawFrameImage(ctx, images[0], 76, y, 610, 570, scene.screenshots[0]);
    drawFrameImage(ctx, images[1], 700, y, 304, 570, scene.screenshots[1]);
  } else {
    drawFrameImage(ctx, images[0], 76, y, 610, 570, scene.screenshots[0]);
    drawFrameImage(ctx, images[1], 700, y, 304, 278, scene.screenshots[1]);
    drawFrameImage(ctx, images[2], 700, y + 292, 304, 278, scene.screenshots[2]);
  }
  ctx.fillStyle = "#20201d"; ctx.font = "600 29px Georgia, 'Songti SC', serif"; ctx.fillText("这一场发生了什么", 76, 916);
  ctx.fillStyle = "#3b3934"; ctx.font = "450 29px -apple-system, 'PingFang SC', sans-serif";
  drawLines(ctx, scene.summary || "尚未填写一句话概括。", 76, 968, 928, 45, 4);
  const tags = [scene.setting, scene.unitType === "序列片段" ? "序列片段" : "", sceneValueChangeLabel(scene), ...scene.functions].filter(Boolean);
  let tx = 76, ty = 1180;
  ctx.font = "600 21px -apple-system, 'PingFang SC', sans-serif";
  let hiddenTags = 0;
  tags.forEach((tag, index) => {
    if (hiddenTags) return;
    const displayTag = String(tag).length > 28 ? `${String(tag).slice(0, 27)}…` : String(tag);
    const width = Math.min(928, ctx.measureText(displayTag).width + 34);
    if (tx + width > 1004) { tx = 76; ty += 48; }
    if (ty > 1228) { hiddenTags = tags.length - index; return; }
    ctx.fillStyle = "#ead4c6"; roundedRect(ctx, tx, ty, width, 35, 18); ctx.fill();
    ctx.fillStyle = "#84391f"; ctx.fillText(displayTag, tx + 17, ty + 25); tx += width + 10;
  });
  if (hiddenTags) {
    const more = `+${hiddenTags}`;
    const width = ctx.measureText(more).width + 34;
    if (tx + width > 1004) { tx = 76; ty = 1228; }
    ctx.fillStyle = "#ead4c6"; roundedRect(ctx, tx, ty, width, 35, 18); ctx.fill();
    ctx.fillStyle = "#84391f"; ctx.fillText(more, tx + 17, ty + 25);
  }
}

function actionLineText(line) {
  return [
    ["谁", line.who], ["要", line.want], ["做", line.do], ["阻", line.obstacle], ["变", line.change],
  ];
}

function actionBlockLayout(ctx, line, count) {
  const config = count === 1
    ? { fontSize: 23, lineHeight: 34, rowMin: 40, textTop: 92, limits: [2, 2, 3, 2, 2], bottom: 22 }
    : count === 2
      ? { fontSize: 22, lineHeight: 31, rowMin: 36, textTop: 86, limits: [1, 1, 2, 1, 1], bottom: 20 }
      : { fontSize: 20, lineHeight: 28, rowMin: 31, textTop: 72, limits: [1, 1, 1, 1, 1], bottom: 16 };
  ctx.font = `450 ${config.fontSize}px -apple-system, 'PingFang SC', sans-serif`;
  const fields = actionLineText(line).map(([label, value], index) => ({
    label,
    parts: wrapText(ctx, value || "—", 800, config.limits[index]),
  }));
  const rowsHeight = fields.reduce((sum, field) => sum + Math.max(config.rowMin, field.parts.length * config.lineHeight + 7), 0);
  return { ...config, fields, height: config.textTop + rowsHeight + config.bottom };
}

async function drawCard2(scene) {
  const canvas = $("#cardCanvas2");
  const ctx = canvas.getContext("2d");
  cardBase(ctx, scene, 2, "这场戏如何运转");
  let y = 270;
  const lines = activeActionLines(scene).slice(0, 3);
  if (!lines.length) {
    ctx.fillStyle = "#e6ded0"; roundedRect(ctx, 76, y, 928, 230, 20); ctx.fill();
    ctx.fillStyle = "#777269"; ctx.font = "550 25px -apple-system, 'PingFang SC', sans-serif";
    ctx.fillText("先找到一个拥有目标的人物", 106, y + 96);
    ctx.font = "450 21px -apple-system, 'PingFang SC', sans-serif";
    ctx.fillText("有动作不等于有行动线。", 106, y + 142);
    y += 248;
  }
  lines.forEach((line, index) => {
    const layout = actionBlockLayout(ctx, line, lines.length);
    ctx.fillStyle = index === 0 ? "#20201d" : "#363d37"; roundedRect(ctx, 76, y, 928, layout.height, 20); ctx.fill();
    ctx.fillStyle = "#f0ad88"; ctx.font = "700 21px Georgia, serif"; ctx.fillText(`ACTION ${String(index + 1).padStart(2, "0")}`, 106, y + 48);
    let textY = y + layout.textTop;
    layout.fields.forEach(({ label, parts }) => {
      ctx.fillStyle = "#f0ad88"; ctx.font = "700 22px -apple-system, 'PingFang SC', sans-serif"; ctx.fillText(label, 106, textY);
      ctx.fillStyle = "#fffaf2"; ctx.font = `450 ${layout.fontSize}px -apple-system, 'PingFang SC', sans-serif`;
      parts.forEach((part, lineIndex) => ctx.fillText(part, 156, textY + lineIndex * layout.lineHeight));
      textY += Math.max(layout.rowMin, parts.length * layout.lineHeight + 7);
    });
    y += layout.height + 18;
  });
  const knowledgeY = y + 12;
  ctx.fillStyle = "#d95f32"; ctx.font = "700 22px -apple-system, 'PingFang SC', sans-serif"; ctx.fillText("知", 76, knowledgeY);
  ctx.fillStyle = "#20201d"; ctx.font = "450 25px -apple-system, 'PingFang SC', sans-serif";
  const factMax = Math.max(1, Math.min(lines.length <= 1 ? 5 : 3, Math.floor((1280 - knowledgeY - (scene.hypothesis ? 118 : 0)) / 38)));
  const factBottom = drawLines(ctx, scene.knowledge || "本场确认了什么？", 126, knowledgeY, 878, 38, factMax);
  if (scene.hypothesis) {
    const hypothesisY = factBottom + 18;
    ctx.fillStyle = "#627166"; ctx.font = "700 22px -apple-system, 'PingFang SC', sans-serif"; ctx.fillText("推", 76, hypothesisY);
    ctx.fillStyle = "#20201d"; ctx.font = "450 23px -apple-system, 'PingFang SC', sans-serif";
    const hypothesisMax = Math.max(1, Math.min(3, Math.floor((1280 - hypothesisY) / 35)));
    drawLines(ctx, scene.hypothesis, 126, hypothesisY, 878, 35, hypothesisMax);
  }
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
    const bodyBottom = drawLines(ctx, body || "—", 76, y + 53, 928, 43, 5);
    if (index < 2) {
      const dividerY = bodyBottom + 12;
      ctx.strokeStyle = "#d9d2c5";
      ctx.beginPath(); ctx.moveTo(76, dividerY); ctx.lineTo(1004, dividerY); ctx.stroke();
      y = dividerY + 46;
    } else {
      y = bodyBottom;
    }
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
  const actionLines = activeActionLines(scene);
  const people = [...new Set(actionLines.flatMap((line) => line.who.split(/[、，,\/]/).map((item) => item.trim())).filter(Boolean))];
  const actions = actionLines.map((line, index) => `### 行动线 ${index + 1}\n\n- **谁** ${line.who || "—"}\n- **要** ${line.want || "—"}\n- **做** ${line.do || "—"}\n- **阻** ${line.obstacle || "—"}\n- **变（结果）** ${line.change || "—"}`).join("\n\n");
  const screenshotEmbeds = scene.screenshots.map((_, index) => `![[assets/${padScene(scene.number)}-${index + 1}.jpg]]`).join("\n");
  return `---
场号: ${yamlString(padScene(scene.number))}
标题: ${yamlString(scene.title)}
分析层级: ${yamlString(scene.unitType)}
所属序列: ${yamlString(scene.sequence)}
戏剧功能: [${scene.functions.map(yamlString).join(", ")}]
价值轴: ${yamlString(scene.valueAxis)}
价值开头: ${yamlString(scene.valueFrom)}
价值结尾: ${yamlString(scene.valueTo)}
价值走向: ${yamlString(scene.valueDirection)}
幕: ${yamlString(scene.act)}
场景类型: ${yamlString(scene.setting)}
节拍位置: ${yamlString(scene.beat)}
人物: [${people.map(yamlString).join(", ")}]
开始时间: ${yamlString(scene.startTime)}
结束时间: ${yamlString(scene.endTime)}
时长: ${yamlString(durationLabel(scene))}
完成: ${scene.complete ? "true" : "false"}
tags:
  - 拉片
  - ${yamlString(`片名/${project.title}`)}
---

## ${padScene(scene.number)} · ${scene.title || "未命名场次"}

${scene.summary || ""}

${screenshotEmbeds}

${actions}

## 本场确认的新信息

${scene.knowledge || "—"}

## 暂时推测

${scene.hypothesis || "—"}

## 细节分析

${scene.details || ""}

## 回看补记

${scene.reviewNote || ""}

## 对我自己创作的启发

${scene.inspiration || ""}
`;
}

function overviewMarkdown(project) {
  const cell = (value, fallback = "—") => {
    const text = String(value ?? "").trim() || fallback;
    return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  };
  const rows = project.scenes.slice().sort((a, b) => a.number - b.number).map((scene) => `| [[${padScene(scene.number)}]] | ${cell(scene.title, "未命名场次")} | ${cell([scene.sequence, scene.unitType].filter(Boolean).join(" · "))} | ${cell(scene.functions.join(" / "))} | ${cell(sceneValueChangeLabel(scene))} | ${cell(primarySceneResult(scene), scene.unitType === "序列片段" ? "序列继续" : "—")} | ${cell(scene.act)} | ${cell(scene.beat)} |`).join("\n");
  return `# ${project.title} · 拉片总览

${project.creator || project.year ? `> ${[project.year, project.creator].filter(Boolean).join(" · ")}\n` : ""}${project.goal ? `> 学习目标：${project.goal}\n` : ""}
## 全片场次一览

| 场号 | 标题 | 序列／层级 | 戏剧功能 | 价值变化 | 本场结果 | 幕 | 节拍位置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows || "| — | 尚无场次 | — | — | — | — | — | — |"}
`;
}

function exportSingleScene() {
  const project = currentProject(), scene = currentScene();
  downloadBlob(new Blob([sceneMarkdown(project, scene)], { type: "text/markdown;charset=utf-8" }), `${safeFileName(project.title)}-${padScene(scene.number)}.md`);
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
  files.push({ name: `${safeFileName(project.title)}/拉片卡数据备份.json`, data: JSON.stringify({ version: BACKUP_VERSION, project }, null, 2) });
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

function parseBackupPayload(restored) {
  if (!restored || typeof restored !== "object") throw new Error("无法读取这个备份文件");
  if (restored.version !== BACKUP_VERSION) throw new Error(`暂不支持版本 ${restored.version ?? "未知"} 的备份`);
  if (Array.isArray(restored.projects) && restored.projects.every((project) => project && Array.isArray(project.scenes))) {
    return { type: "full", projects: restored.projects };
  }
  if (restored.project && Array.isArray(restored.project.scenes)) return { type: "project", project: restored.project };
  throw new Error("这个文件不是完整备份或单影片备份");
}

async function restoreBackup(file) {
  try {
    const restored = JSON.parse(await file.text());
    const backup = parseBackupPayload(restored);
    if (backup.type === "full") {
      if (!confirm("恢复完整备份会替换当前浏览器中的全部拉片数据。确定继续吗？")) return;
      state.version = BACKUP_VERSION;
      state.projects = backup.projects;
    } else {
      const existingIndex = state.projects.findIndex((project) => project.id === backup.project.id);
      const action = existingIndex >= 0 ? "替换当前已有的同一项目" : "加入当前工作台";
      if (!confirm(`将单影片备份「${backup.project.title || "未命名影片"}」${action}，其他影片不会受影响。确定继续吗？`)) return;
      if (existingIndex >= 0) state.projects.splice(existingIndex, 1, backup.project);
      else state.projects.push(backup.project);
    }
    clearTimeout(saveTimer);
    saveTimer = null;
    saveRevision += 1;
    state.persistedAt = 0;
    normalizeWorkspace(state);
    state.activeProjectId = null; state.activeSceneId = null;
    activeWorkspaceTab = "scenes";
    await persistState(); renderApp(); showToast(backup.type === "full" ? "完整备份已恢复" : "单影片备份已导入");
  } catch (error) {
    console.error(error);
    showToast(error instanceof SyntaxError ? "无法读取这个备份文件" : error.message);
  }
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
    const lastLine = scene.actionLines[scene.actionLines.length - 1];
    if (lastLine && ![lastLine.who, lastLine.want, lastLine.do, lastLine.obstacle, lastLine.change].some((value) => String(value || "").trim())) {
      return showToast("当前空行动线尚未使用");
    }
    scene.actionLines.push(newActionLine()); touchScene(scene); renderActionLines(scene); renderQualityHint(scene); renderCards();
  });
  $("#actionLines").addEventListener("click", (event) => {
    const button = event.target.closest(".remove-action"); if (!button) return;
    const scene = currentScene(); const id = button.closest(".action-line").dataset.actionId;
    scene.actionLines = scene.actionLines.filter((line) => line.id !== id); touchScene(scene); renderActionLines(scene); renderQualityHint(scene); renderCards();
  });
  $("#sceneForm").addEventListener("input", (event) => {
    const scene = currentScene(); if (!scene) return;
    const field = event.target.dataset.field;
    if (field) scene[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (field === "startTime" || field === "endTime") updateDurationField(scene);
    const actionField = event.target.dataset.actionField;
    if (actionField) {
      const line = scene.actionLines.find((item) => item.id === event.target.closest(".action-line").dataset.actionId);
      if (line) line[actionField] = event.target.value;
    }
    if (event.target.closest("#functionChoices")) scene.functions = $$('#functionChoices input:checked').map((input) => input.value);
    touchScene(scene); updateCounters(); updateInsightState(scene); renderQualityHint(scene); renderSceneList(); renderCards();
  });
  $("#sceneComplete").addEventListener("change", (event) => {
    const scene = currentScene();
    scene.complete = event.target.checked;
    touchScene(scene); renderQualityHint(scene); renderSceneList(); renderWorkspaceHeadingOnly();
    if (scene.complete) {
      const warnings = sceneQualityWarnings(scene);
      showToast(warnings.length ? `已标记完成；仍建议检查 ${warnings.length} 项` : "本场已完成");
    }
  });
  $("#screenshotInput").addEventListener("change", (event) => { addScreenshots(event.target.files); event.target.value = ""; });
  $("#dropZone").addEventListener("dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); });
  $("#dropZone").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
  $("#dropZone").addEventListener("drop", (event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); addScreenshots(event.dataTransfer.files); });
  document.addEventListener("paste", (event) => { if (!currentScene() || activeWorkspaceTab !== "scenes") return; const files = [...event.clipboardData.files]; if (files.some((file) => file.type.startsWith("image/"))) { event.preventDefault(); addScreenshots(files); } });
  const workspaceTabs = $$(".workspace-tab");
  const activateWorkspaceTab = (button, moveFocus = false) => {
    activeWorkspaceTab = button.dataset.workspaceTab;
    renderWorkspace();
    if (moveFocus) button.focus();
  };
  workspaceTabs.forEach((button, index) => {
    button.addEventListener("click", () => activateWorkspaceTab(button));
    button.addEventListener("keydown", (event) => {
      let targetIndex = null;
      if (event.key === "ArrowRight") targetIndex = (index + 1) % workspaceTabs.length;
      if (event.key === "ArrowLeft") targetIndex = (index - 1 + workspaceTabs.length) % workspaceTabs.length;
      if (event.key === "Home") targetIndex = 0;
      if (event.key === "End") targetIndex = workspaceTabs.length - 1;
      if (targetIndex === null) return;
      event.preventDefault();
      activateWorkspaceTab(workspaceTabs[targetIndex], true);
    });
  });
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
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushPendingState(); });
  window.addEventListener("pagehide", flushPendingState);
}

function renderWorkspaceHeadingOnly() {
  const project = currentProject();
  $("#projectMetaDisplay").textContent = `${project.scenes.length} 场 · ${project.scenes.filter((scene) => scene.complete).length} 场完成${project.exportedAt && project.updatedAt > project.exportedAt ? " · 有尚未导出的更新" : ""}`;
}

async function init() {
  let recoveredPendingChanges = false;
  try {
    const saved = await loadState();
    const recovery = readRecoveryJournal();
    const shouldRecover = recovery && (!saved?.persistedAt || recovery.createdAt > saved.persistedAt);
    const workspace = shouldRecover ? mergeRecoveryState(saved, recovery.state) : saved;
    if (workspace?.projects) {
      Object.assign(state, workspace);
      normalizeWorkspace(state);
    }
    recoveredPendingChanges = Boolean(shouldRecover);
    if (recovery && !shouldRecover) clearRecoveryJournal();
  } catch (error) { console.error(error); showToast("本机数据读取失败，请使用备份恢复"); }
  state.activeProjectId = null;
  state.activeSceneId = null;
  bindEvents();
  renderApp();
  if (recoveredPendingChanges) {
    try {
      await persistState();
      showToast("已恢复上次关闭前尚未保存的输入");
    } catch (error) {
      console.error(error);
      showToast("已恢复输入，但重新保存失败，请立即导出备份");
    }
  }
}

init();

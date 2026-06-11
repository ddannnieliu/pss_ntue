// app.js - 核心業務邏輯

// ⚠️ 請填入您的 Google Apps Script 網址
const API_URL = "https://script.google.com/macros/s/AKfycbw1tjPCIgpEXB0M5PhjHvGp3OhDu_INFtUFZbO8QvaPzNrOlqnTKXuQIWU25RIfHdWq/exec";

async function apiCall(action, params = {}) {
  params.action = action; 
  const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(params)
  });
  return await response.json();
}

let allData = [], currentSemData = [], userSchedules = {}, mySchedule = [], setupData = {}, schedules = [];
let currentSchedulesForModal = []; 
let currentUserId = "";
let loginModal, successModal, existModal, clearModal, removeModal, infoModal, courseModal, creditModal, listModal, unsavedModal, noTimeModal;
let courseToRemoveId = null;
let currentSemesterVal = ""; 
let isDirty = false, pendingSemester = null, toastEl;

let selectedTimeSlots = new Set();
let isTimeFilterActive = false;

const SESSION_TIMEOUT = 604800000; 
// 移除 syllabus，回歸乾淨欄位
const COL = { SEM: 0, ID: 1, NAME: 2, TYPE: 4, CATEGORY: 5, CLASS: 6, DEPT: 7, SYS: 8, TEACHER: 9, TIME: 10, ROOM: 11, CREDIT: 12, NOTE: 20 };
const PERIODS = ["OM", "01", "02", "03", "04", "ON", "05", "06", "07", "08", "OE", "09", "10", "11", "12"];
const PERIOD_MAP = { "OM": "07:10-08:00", "01": "08:10-09:00", "02": "09:10-10:00", "03": "10:10-11:00", "04": "11:10-12:00", "ON": "12:10-13:20", "05": "13:30-14:20", "06": "14:30-15:20", "07": "15:30-16:20", "08": "16:30-17:20", "OE": "17:30-18:20", "09": "18:30-19:15", "10": "19:15-20:00", "11": "20:10-20:55", "12": "20:55-21:40" };
const WEEKDAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7 };

window.onload = function() {
  renderTimetableGrid();
  renderTimeGrid(); 
  
  loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
  successModal = new bootstrap.Modal(document.getElementById('successModal'));
  existModal = new bootstrap.Modal(document.getElementById('existModal'));
  clearModal = new bootstrap.Modal(document.getElementById('clearModal'));
  removeModal = new bootstrap.Modal(document.getElementById('removeModal'));
  infoModal = new bootstrap.Modal(document.getElementById('infoModal'));
  courseModal = new bootstrap.Modal(document.getElementById('courseModal'));
  creditModal = new bootstrap.Modal(document.getElementById('creditModal'));
  listModal = new bootstrap.Modal(document.getElementById('listModal'));
  unsavedModal = new bootstrap.Modal(document.getElementById('unsavedModal'));
  noTimeModal = new bootstrap.Modal(document.getElementById('noTimeModal'));
  toastEl = new bootstrap.Toast(document.getElementById('liveToast'), {delay: 2000});
  window.addEventListener('beforeunload', function (e) { if (isDirty) { e.preventDefault(); e.returnValue = ''; } });
  
  initApp();
};

async function initApp() {
  const savedId = localStorage.getItem("schedule_uid");
  const lastTime = localStorage.getItem("schedule_last_active");
  let isSessionValid = (savedId && lastTime && (Date.now() - parseInt(lastTime) < SESSION_TIMEOUT));
  
  try {
    // 🚀 步驟1：先抓取輕量級設定檔 (fetchCourse: false)
    const payload = { email: isSessionValid ? savedId : "", fetchCourse: false };
    const res = await apiCall('appStart', payload);
    if (res.error) throw new Error(res.error);

    setupData = res.setupData || {};
    schedules = res.schedules || [];
    document.getElementById("footerInfo").innerText = `資料更新：${setupData['DataUpdateDate'] || 'N/A'} | 版本：${setupData['SystemVerDate'] || 'V3.0'}`;
    
    if (setupData['Announcement'] && setupData['Announcement'].trim() !== "") {
        document.getElementById('announcementText').innerText = setupData['Announcement'];
        document.getElementById('announcementBanner').classList.remove('d-none');
    }

    const semList = res.semesterList || [];
    let select = document.getElementById("globalSemester");
    semList.forEach(s => select.add(new Option(s, s)));
    currentSemesterVal = res.defaultSemester;
    select.value = currentSemesterVal;
    updateScheduleTitle(currentSemesterVal, isSessionValid ? savedId : "");

    if (isSessionValid && res.userData && res.userData.status === "success") {
      currentUserId = savedId;
      userSchedules = res.userData.scheduleMap;
      document.getElementById("currentUserDisplay").innerText = currentUserId;
      refreshSession();
      mySchedule = userSchedules[currentSemesterVal] || [];
    } else {
      localStorage.removeItem("schedule_uid");
      loginModal.show();
    }
    
    // 🚀 步驟2：UI 準備好後，非同步加載課程資料 (加速視覺體驗)
    document.getElementById("loadingText").innerText = "載入課程中...";
    await changeSemester(currentSemesterVal);

  } catch (err) {
    console.error(err);
    alert("系統初始化失敗，請確認 API_URL 是否正確。");
    loginModal.show();
    document.getElementById("loadingOverlay").style.display = 'none';
  }
}

function logout() {
  if(isDirty && !confirm("您有未儲存的變更，確定要登出並放棄變更嗎？")) return;
  localStorage.removeItem("schedule_uid");
  localStorage.removeItem("schedule_last_active");
  currentUserId = "";
  mySchedule = [];
  userSchedules = {};
  isDirty = false;
  document.getElementById("currentUserDisplay").innerText = "未登入";
  updateScheduleTitle(currentSemesterVal, "");
  document.getElementById("loginId").value = "";
  refreshTimetableUI(); 
  loginModal.show();
}

async function submitLogin() {
  let email = document.getElementById("loginId").value.trim(); 
  if (!email) return; 
  let btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.innerText = "驗證中...";
  
  try {
    const res = await apiCall('handleUserLogin', { email: email });
    if (res.status === "success") { 
      currentUserId = email; 
      userSchedules = res.scheduleMap; 
      document.getElementById("currentUserDisplay").innerText = currentUserId; 
      updateScheduleTitle(currentSemesterVal, currentUserId);
      refreshSession(); 
      loginModal.hide(); 
      mySchedule = userSchedules[currentSemesterVal] || [];
      refreshTimetableUI();
    } else { 
      document.getElementById("loginError").innerText = res.msg; 
    }
  } catch(err) {
    document.getElementById("loginError").innerText = "連線失敗，請檢查網路";
  } finally {
    btn.disabled = false; btn.innerText = "進入我的課表";
  }
}

function onSemesterSelectChange() {
  const newSem = document.getElementById("globalSemester").value;
  if (isDirty) { pendingSemester = newSem; unsavedModal.show(); document.getElementById("globalSemester").value = currentSemesterVal; } 
  else { changeSemester(newSem); }
}
function handleUnsavedLeave() { unsavedModal.hide(); isDirty = false; if(pendingSemester) { document.getElementById("globalSemester").value = pendingSemester; changeSemester(pendingSemester); pendingSemester = null; } }
function handleUnsavedSave() { unsavedModal.hide(); saveToBackend(false); }

async function changeSemester(sem) {
  if(!sem) sem = document.getElementById("globalSemester").value;
  currentSemesterVal = sem; 
  refreshSession();
  updateScheduleTitle(sem, currentUserId);
  document.querySelectorAll("td[id^='cell-']").forEach(td => td.innerHTML = "");
  
  const cachedData = sessionStorage.getItem(`course_data_${sem}`);
  if(cachedData) {
      currentSemData = JSON.parse(cachedData);
      updateFilterOptions(); filterCourses(); 
      mySchedule = userSchedules[sem] || []; 
      refreshTimetableUI(); 
      isDirty = false;
      document.getElementById("loadingOverlay").style.display = 'none';
      return;
  }
  
  document.getElementById("loadingOverlay").style.display = 'flex';
  try {
    const res = await apiCall('getCourseData', { semester: sem });
    if(res.error) throw new Error(res.error);
    currentSemData = res.data; 
    try { sessionStorage.setItem(`course_data_${sem}`, JSON.stringify(currentSemData)); } catch(e) {}
    updateFilterOptions(); filterCourses(); 
    mySchedule = userSchedules[sem] || []; 
    refreshTimetableUI(); 
    isDirty = false;
  } catch(err) {
    alert("讀取課程失敗");
  } finally {
    document.getElementById("loadingOverlay").style.display = 'none';
  }
}

function parseCourseTime(timeStr) {
  if (!timeStr) return [];
  let raw = timeStr.replace(/[\uFF01-\uFF5E]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/\u3000/g, " ");
  raw = raw.toUpperCase().replace(/0N/g, "ON").replace(/0E/g, "OE").replace(/0M/g, "OM");
  let weekType = "ALL";
  if (raw.includes("單週") && !raw.includes("雙週")) weekType = "ODD";
  else if (raw.includes("雙週") && !raw.includes("單週")) weekType = "EVEN";
  let cleanRaw = raw.replace(/-[\u4e00-\u9fa5]+/g, ""); 
  const regex = /([\u4e00-\u9fa5])\s*\(([^)]+)\)/g;
  let results = [], match;
  while ((match = regex.exec(cleanRaw)) !== null) {
    let weekdayIndex = WEEKDAY_MAP[match[1]];
    let periods = match[2].split(',').map(p => {
        let s = p.trim();
        if (/^\d$/.test(s)) return '0' + s; 
        if (s === 'E' || s === '0E') return 'OE';
        if (s === 'N' || s === '0N') return 'ON';
        if (s === 'M' || s === '0M') return 'OM';
        return s;
    }).filter(p => p);
    if (weekdayIndex && periods.length > 0) results.push({ weekdayIndex, periods, weekType });
  }
  return results;
}

function renderTimeGrid() {
  const tbody = document.getElementById("timeGridBody");
  let html = "";
  PERIODS.forEach(p => {
    html += `<tr>`;
    for (let d = 1; d <= 7; d++) {
      let key = `${d}-${p}`;
      html += `<td id="tg-${key}" class="time-grid-cell" onclick="toggleTimeSlot('${key}')">${p}</td>`;
    }
    html += `</tr>`;
  });
  tbody.innerHTML = html;
}

function toggleTimeSlot(key) {
  const cell = document.getElementById(`tg-${key}`);
  if (selectedTimeSlots.has(key)) {
    selectedTimeSlots.delete(key);
    cell.classList.remove('selected');
  } else {
    selectedTimeSlots.add(key);
    cell.classList.add('selected');
  }
}

function clearTimeFilter() {
  selectedTimeSlots.clear();
  document.querySelectorAll('.time-grid-cell.selected').forEach(c => c.classList.remove('selected'));
  isTimeFilterActive = false;
  document.getElementById('strictTimeSearch').checked = false;
  updateTimeFilterBtnUI();
  filterCourses();
}

function applyTimeFilter(fromButton = false) {
  isTimeFilterActive = selectedTimeSlots.size > 0;
  updateTimeFilterBtnUI();
  if (fromButton) filterCourses();
}

function updateTimeFilterBtnUI() {
  let btn = document.getElementById('timeFilterBtn');
  if (isTimeFilterActive) {
    btn.classList.replace('btn-primary', 'btn-success');
    btn.innerHTML = `<i class="bi bi-check-circle-fill"></i> 節次 (${selectedTimeSlots.size})`;
  } else {
    btn.classList.replace('btn-success', 'btn-primary');
    btn.innerHTML = `<i class="bi bi-clock"></i> 節次`;
  }
}

function filterCourses() {
  const key = document.getElementById("keyword").value.toLowerCase();
  const classVal = document.getElementById("classInput").value;
  const deptVal = document.getElementById("deptInput").value;
  const isStrict = document.getElementById('strictTimeSearch').checked;
  const listDiv = document.getElementById("courseList");
  
  let count = 0;
  let html = '<div class="list-group list-group-flush">';
  
  for (let row of currentSemData) {
    if (count >= 50) break;
    
    let matchKey = !key || `${row[COL.NAME]} ${row[COL.TEACHER]} ${row[COL.SYS]} ${row[COL.ID]}`.toLowerCase().includes(key);
    let matchClass = !classVal || String(row[COL.CLASS]).includes(classVal);
    let matchDept = !deptVal || String(row[COL.DEPT]).includes(deptVal);
    
    let matchTime = true;
    if (isTimeFilterActive) {
        let parsedTime = parseCourseTime(row[COL.TIME]);
        let courseSlots = [];
        parsedTime.forEach(seg => { seg.periods.forEach(p => { courseSlots.push(`${seg.weekdayIndex}-${p}`); }); });
        if (courseSlots.length === 0) matchTime = false; 
        else if (isStrict) matchTime = courseSlots.every(slot => selectedTimeSlots.has(slot));
        else matchTime = courseSlots.some(slot => selectedTimeSlots.has(slot));
    }

    if (matchKey && matchClass && matchDept && matchTime) {
      let idSafe = String(row[COL.ID]);
      let displayId = idSafe.padStart(4, '0');
      let isRequired = String(row[COL.TYPE]).includes("必");
      let typeBadge = isRequired ? '<span class="badge bg-primary me-1">必</span>' : '<span class="badge bg-secondary me-1">選</span>';
      let roomIcon = row[COL.ROOM] ? `<span class="ms-2"><i class="bi bi-geo-alt"></i> ${row[COL.ROOM]}</span>` : '';
      html += `<div class="list-group-item course-list-item d-flex justify-content-between align-items-center p-2"><div style="flex-grow: 1;"><div class="fw-bold text-dark mb-1">${typeBadge} ${row[COL.NAME]}</div><div class="text-muted" style="font-size: 0.8rem;"><span class="badge bg-light text-dark border me-1">${displayId}</span><span>${row[COL.CLASS]}</span> | <span>${row[COL.TEACHER]}</span><div class="mt-1"><i class="bi bi-clock"></i> ${row[COL.TIME]} ${roomIcon}</div></div></div><button class="btn btn-sm btn-light border ms-2 shadow-sm text-primary fw-bold" onclick="addToSchedule('${idSafe}')"><i class="bi bi-plus-lg"></i></button></div>`;
      count++;
    }
  }
  if (count === 0) listDiv.innerHTML = '<div class="p-4 text-center text-muted">查無符合課程</div>';
  else listDiv.innerHTML = html + '</div>';
}

function refreshTimetableUI() {
  document.querySelectorAll("td[id^='cell-']").forEach(td => td.innerHTML = "");
  let hasConflictAlert = false;
  let gridMap = {};

  mySchedule.forEach(course => {
    let timeSegments = [];
    if (course.parsed) {
        if (Array.isArray(course.parsed)) timeSegments = course.parsed;
        else if (typeof course.parsed === 'object') timeSegments = [course.parsed]; 
    }
    timeSegments.forEach(seg => {
      let type = seg.weekType || "ALL";
      seg.periods.forEach(p => {
          let key = `${seg.weekdayIndex}-${p}`;
          if (!gridMap[key]) gridMap[key] = [];
          gridMap[key].push({ course, type });
      });
    });
  });

  for (const [key, items] of Object.entries(gridMap)) {
      let cell = document.getElementById(`cell-${key}`);
      if (!cell) continue;
      let isConflict = false;
      if (items.length > 1) {
          if (items.length === 2) {
              let t1 = items[0].type, t2 = items[1].type;
              if (!((t1 === "ODD" && t2 === "EVEN") || (t1 === "EVEN" && t2 === "ODD"))) isConflict = true;
          } else isConflict = true;
      }
      if (isConflict) hasConflictAlert = true;

      items.forEach(item => {
          let course = item.course;
          let row = course.fullData;
          if(!row) return; 
          let idSafe = String(course.id);
          let isGeneral = String(row[COL.CATEGORY]).includes("通識");
          let isRequired = String(row[COL.TYPE]).includes("必");
          let colorClass = isGeneral ? "type-general" : (isRequired ? "type-required" : "type-elective");
          if (isConflict) colorClass = "status-conflict";
          let typeChar = isRequired ? "必" : "選";
          let badgeHtml = `<span class="type-badge">${typeChar}</span>`;
          let weekBadge = "";
          if (item.type === "ODD") weekBadge = `<span class="week-badge">單週</span>`;
          if (item.type === "EVEN") weekBadge = `<span class="week-badge" style="background-color:#e83e8c">雙週</span>`;

          cell.innerHTML += `<div class="course-cell ${colorClass}" onclick="showCourseDetails('${idSafe}')"><div class="btn-delete" onclick="event.stopPropagation(); removeCourse('${idSafe}')"><i class="bi bi-trash3-fill"></i></div><div class="cell-class text-truncate">${row[COL.CLASS]}</div><div class="cell-title text-truncate">${weekBadge}${badgeHtml}${row[COL.NAME]}</div><div class="cell-teacher text-truncate"><i class="bi bi-person-fill" style="font-size:0.7rem;"></i> ${row[COL.TEACHER]}</div><div class="cell-room text-truncate"><i class="bi bi-geo-alt-fill" style="font-size:0.6rem;"></i> ${row[COL.ROOM] || "未定"}</div></div>`;
      });
  }
  document.getElementById("conflictAlert").style.display = hasConflictAlert ? "block" : "none";
}

function addToSchedule(idStr) {
  const id = String(idStr);
  let row = currentSemData.find(r => String(r[COL.ID]) === id);
  if(!row) { alert("系統錯誤：找不到該課程資料"); return; }
  if (mySchedule.some(c => String(c.id) === id)) { existModal.show(); return; }
  let parsed = parseCourseTime(row[COL.TIME]);
  mySchedule.push({ id, name: row[COL.NAME], time: row[COL.TIME], parsed, fullData: row, personalNote: "" });
  isDirty = true;
  
  let msg = document.getElementById("toastMsg");
  msg.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i> 已加入 ${row[COL.NAME]}`;
  toastEl.show();
  
  if (parsed.length > 0) { refreshTimetableUI(); } else { noTimeModal.show(); }
}

function updateNote(id, noteVal) {
    let course = mySchedule.find(c => String(c.id) === String(id));
    if(course) {
        course.personalNote = noteVal;
        isDirty = true;
    }
}

function openListModal() {
  let tbody = document.getElementById("listModalBody");
  tbody.innerHTML = "";
  let total = 0;
  if (mySchedule.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">尚未加入任何課程</td></tr>';
  } else {
      mySchedule.forEach(c => {
          let r = c.fullData;
          if(!r) return;
          let credit = parseFloat(r[COL.CREDIT]) || 0;
          total += credit;
          let idSafe = String(c.id);
          tbody.innerHTML += `<tr>
              <td><span class="badge bg-secondary">${String(r[COL.ID]).padStart(4,'0')}</span></td>
              <td>
                  <div class="fw-bold text-dark">${r[COL.NAME]}</div>
                  <input type="text" class="form-control form-control-sm mt-1 note-input" style="min-width: 140px; font-size: 0.8rem;" placeholder="輸入個人備註 (如: 志願1)" value="${c.personalNote || ''}" onchange="updateNote('${idSafe}', this.value)">
              </td>
              <td>${r[COL.TEACHER]}</td>
              <td class="small text-muted">${r[COL.TIME]}</td>
              <td><span class="fw-bold text-primary">${credit}</span></td>
              <td><button class="btn btn-outline-danger btn-sm" onclick="listRemove('${idSafe}')"><i class="bi bi-trash3"></i></button></td>
          </tr>`;
      });
  }
  document.getElementById("listTotalCredit").innerText = total;
  listModal.show();
}

function listRemove(id) { courseToRemoveId = id; removeModal.show(); }

function confirmRemove() {
  if (courseToRemoveId) {
    mySchedule = mySchedule.filter(c => String(c.id) !== String(courseToRemoveId));
    refreshTimetableUI();
    if (document.getElementById('listModal').classList.contains('show')) openListModal();
    courseToRemoveId = null;
    isDirty = true;
  }
  removeModal.hide();
}

function printList() {
  let content = `
    <html><head><title>已選課程清單</title>
    <style>
      body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 20px; color: #333; }
      h2 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th, td { border: 1px solid #ddd; padding: 12px 8px; text-align: left; }
      th { background: #f8f9fa; color: #000; font-weight: bold; border-bottom: 2px solid #ccc; }
      tr:nth-child(even) { background-color: #fcfcfc; }
      .total-row { background: #eee; font-weight: bold; font-size: 1.1em; }
      .text-right { text-align: right; }
      .note-text { color: #d97706; font-size: 0.9em; font-weight: bold; }
    </style>
    </head><body>
    <h2>${document.getElementById("scheduleTitle").innerText} - 選課清單</h2>
    <table><thead><tr><th>代碼</th><th>課程名稱</th><th>教師</th><th>時間</th><th>學分</th><th>個人備註</th></tr></thead><tbody>`;
  
  let total = 0;
  mySchedule.forEach(c => { 
      let r = c.fullData; if(!r) return; 
      let credit = parseFloat(r[COL.CREDIT]) || 0; total += credit; 
      let note = c.personalNote ? `<span class="note-text">${c.personalNote}</span>` : "";
      content += `<tr><td>${String(r[COL.ID]).padStart(4,'0')}</td><td><b>${r[COL.NAME]}</b></td><td>${r[COL.TEACHER]}</td><td>${r[COL.TIME]}</td><td>${credit}</td><td>${note}</td></tr>`; 
  });
  content += `</tbody><tfoot><tr class="total-row"><td colspan="4" class="text-right">總學分</td><td>${total}</td><td></td></tr></tfoot></table>
    <div style="text-align: center; font-size: 0.8rem; color: #666; margin-top: 30px;">印出時間: ${new Date().toLocaleString()}</div>
    </body></html>`;
  let win = window.open('', '', 'height=600,width=800'); win.document.write(content); win.document.close(); win.print();
}
function removeCourse(id) { courseToRemoveId = id; removeModal.show(); }
function openClearModal() { clearModal.show(); }

async function confirmClear() { 
  if (!currentUserId) { loginModal.show(); return; } 
  refreshSession(); 
  mySchedule = []; 
  refreshTimetableUI(); 
  clearModal.hide(); 
  await saveToBackend(true); 
}

async function saveSchedule() { 
  if (!currentUserId) { loginModal.show(); return; } 
  refreshSession(); 
  await saveToBackend(true); 
}

async function saveToBackend(showSuccess = false) {
  document.getElementById("loadingOverlay").style.display = 'flex';
  const sem = currentSemesterVal;
  try {
    const res = await apiCall('saveUserSchedule', { semester: sem, json: JSON.stringify(mySchedule), email: currentUserId });
    if(res.status === "success") {
      userSchedules[sem] = mySchedule;
      isDirty = false;
      if(showSuccess) successModal.show();
      if(pendingSemester) { 
          document.getElementById("globalSemester").value = pendingSemester; 
          changeSemester(pendingSemester); 
          pendingSemester = null; 
      }
    } else alert(res.msg);
  } catch(err) {
    alert("儲存失敗：" + err);
  } finally {
    document.getElementById("loadingOverlay").style.display = 'none';
  }
}

function printSchedule() { window.print(); }
function refreshSession() { if (currentUserId) { localStorage.setItem("schedule_uid", currentUserId); localStorage.setItem("schedule_last_active", Date.now()); } }

function updateScheduleTitle(sem, userEmail) {
    document.getElementById("scheduleTitle").innerText = formatSemesterTitle(sem);
    document.getElementById("scheduleTitle").setAttribute("data-user", userEmail || "未登入");
}

function formatSemesterTitle(sem) { 
    if (sem && sem.includes("-")) { 
        let parts = sem.split("-"); 
        let termChi = parts[1] == "1" ? "第一" : (parts[1] == "2" ? "第二" : parts[1]); 
        return `${parts[0]}學年度${termChi}學期`; 
    } 
    return sem; 
}

function updateFilterOptions() {
  let classes = [...new Set(currentSemData.map(r => r[COL.CLASS]))].sort(); document.getElementById("classOptions").innerHTML = classes.map(c => `<option value="${c}">`).join('');
  let depts = [...new Set(currentSemData.map(r => r[COL.DEPT]))].sort(); document.getElementById("deptOptions").innerHTML = depts.map(d => `<option value="${d}">`).join('');
}

function clearFilters() {
  document.getElementById("keyword").value = "";
  document.getElementById("classInput").value = "";
  document.getElementById("deptInput").value = "";
  filterCourses();
}

function renderTimetableGrid() {
  const tbody = document.getElementById("timetableBody");
  let html = "";
  PERIODS.forEach(p => {
    html += `<tr><td class="period-col"><div class="mt-1">${p}</div><div style="font-size:0.7em;font-weight:normal;">${PERIOD_MAP[p].split('-')[0]}</div><div style="font-size:0.7em;font-weight:normal;">${PERIOD_MAP[p].split('-')[1]}</div></td>`;
    for (let d = 1; d <= 7; d++) html += `<td id="cell-${d}-${p}"></td>`;
    html += `</tr>`;
  });
  tbody.innerHTML = html;
}

function showCourseDetails(id) {
  const c = mySchedule.find(x => String(x.id) === String(id)); if(!c) return; const r = c.fullData;
  document.getElementById("modalCourseTitle").innerText = r[COL.NAME];
  
  let html = `<tr><th width="30%">學期</th><td>${r[COL.SEM]}</td></tr>
              <tr><th>代碼</th><td>${String(r[COL.ID]).padStart(4,'0')}</td></tr>
              <tr><th>教師</th><td>${r[COL.TEACHER]}</td></tr>
              <tr><th>班級</th><td>${r[COL.CLASS]}</td></tr>
              <tr><th>選別</th><td>${r[COL.TYPE]}</td></tr>
              <tr><th>修別</th><td>${r[COL.CATEGORY]}</td></tr>
              <tr><th>時間</th><td>${r[COL.TIME]}</td></tr>
              <tr><th>教室</th><td>${r[COL.ROOM]}</td></tr>
              <tr><th>學分</th><td>${r[COL.CREDIT]}</td></tr>
              <tr><th>備註</th><td class="text-danger">${r[COL.NOTE] || ""}</td></tr>`;
  
  document.getElementById("modalBody").innerHTML = html;
  courseModal.show();
}

function openCreditModal() {
  let total = 0; mySchedule.forEach(c => { let r = c.fullData; if(r) { let credit = parseFloat(r[COL.CREDIT]); if(!isNaN(credit)) total += credit; }});
  document.getElementById("currentCreditDisplay").innerText = total; checkCredits(total); creditModal.show();
}

function checkCredits(currentTotal) {
  if(currentTotal === undefined) currentTotal = parseFloat(document.getElementById("currentCreditDisplay").innerText);
  let grade = document.getElementById("creditGradeSelect").value; let ruleText = "", isValid = true;
  if (grade == "1") { ruleText = "學分下限: 15 / 上限: 27"; if (currentTotal < 15 || currentTotal > 27) isValid = false; }
  else if (grade == "2" || grade == "3") { ruleText = "學分下限: 15 (無上限)"; if (currentTotal < 15) isValid = false; }
  else if (grade == "4") { ruleText = "至少修習一門課程"; if (mySchedule.length === 0) isValid = false; }
  document.getElementById("creditRuleText").innerText = ruleText;
  let alertBox = document.getElementById("creditAlert"); if (!isValid) alertBox.classList.remove("d-none"); else alertBox.classList.add("d-none");
}

function openInfoModal() {
  const sem = document.getElementById("globalSemester").value; 
  document.getElementById("infoModalTitle").innerText = formatSemesterTitle(sem).replace(" 預排課表", "") + " 選課時程公告";
  currentSchedulesForModal = schedules.filter(item => item.semester === sem);
  
  const filterGroup = document.getElementById('scheduleFilterGroup');
  
  if (sem.endsWith('-1') && currentSchedulesForModal.length > 0) {
      filterGroup.style.setProperty('display', 'flex', 'important');
      document.getElementById('schedOld').checked = true; 
      renderScheduleCards('舊生');
  } else {
      filterGroup.style.setProperty('display', 'none', 'important');
      renderScheduleCards('ALL'); 
  }
  infoModal.show();
}

function renderScheduleCards(filterTarget) {
  const container = document.getElementById("infoModalBody"); 
  if(!currentSchedulesForModal || currentSchedulesForModal.length === 0) { 
      container.innerHTML = '<div class="text-center text-muted py-4 w-100">本學期尚無選課公告</div>'; 
      return; 
  }
  
  const now = new Date(); 
  let html = "";
  
  currentSchedulesForModal.forEach(item => {
    let target = item.target || '全部';
    
    if (filterTarget !== 'ALL' && target !== '全部') {
        if (target === '新生' && (filterTarget === '大學部新生' || filterTarget === '碩博班新生')) {
        } else if (!target.includes(filterTarget)) {
            return; 
        }
    }

    let startTime = new Date(item.startISO); 
    let endTime = new Date(item.endISO); 
    let statusClass = "", badgeHtml = "";
    
    let validThemes = ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'dark'];
    let safeTheme = validThemes.includes(item.theme) ? item.theme : 'primary';
    let themeColor = `var(--bs-${safeTheme})`;

    if (now >= startTime && now <= endTime) { 
        statusClass = "active"; 
        badgeHtml = `<span class="badge bg-${safeTheme} float-end small fw-bold">進行中</span>`; 
    } else if (now > endTime) { 
        statusClass = "past"; 
        badgeHtml = '<span class="badge bg-secondary float-end small fw-bold">已結束</span>'; 
    } else {
        badgeHtml = '<span class="badge bg-light text-secondary border float-end small fw-bold">未開始</span>';
    }
    
    let stepsHtml = '<ul class="step-list">'; 
    item.steps.split('\n').forEach(step => { 
        let cleanStep = step.replace(/^[\d\.\-•、\s]+/, '');
        if(cleanStep) {
            stepsHtml += `<li class="step-item"><i class="bi bi-dot text-${safeTheme}"></i> ${cleanStep}</li>`; 
        }
    }); 
    stepsHtml += '</ul>';
    
    html += `
      <div class="timeline-item ${statusClass}" style="--item-theme: ${themeColor};">
        <div class="timeline-content shadow-sm" style="${statusClass === 'active' ? `border-color: ${themeColor};` : ''}">
          ${badgeHtml}
          <h6 class="fw-bold text-dark mb-1 fs-5" style="padding-right: 70px;">${item.title}</h6>
          <div class="small text-muted fw-bold mb-2"><i class="bi bi-clock"></i> ${item.dateRange}</div>
          ${stepsHtml}
        </div>
      </div>`;
  });
  
  if (html === "") {
      container.innerHTML = `<div class="text-center text-muted py-4 w-100">查無符合條件的選課時程</div>`;
  } else {
      container.innerHTML = html; 
  }
}

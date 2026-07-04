const SLOT_MINUTES = 30;
const STORE_KEY = "mla-booking-state-v3";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const defaultState = {
  currentStudent: null,
  invites: [],
  batches: [],
  slots: [],
  bookings: [],
  requests: [],
};

let state = loadState();
let restDraft = new Set();

function loadState() {
  try {
    return { ...defaultState, ...JSON.parse(localStorage.getItem(STORE_KEY)) };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toHHMM(minutes) {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function addMinutes(time, minutes) {
  return toHHMM(toMinutes(time) + minutes);
}

function formatDuration(minutes) {
  return minutes === 30 ? "0.5 小时" : `${minutes / 60} 小时`;
}

function parseDateParts(date) {
  return date.split("-").map(Number);
}

function dateToSerial(date) {
  const [year, month, day] = parseDateParts(date);
  return Date.UTC(year, month - 1, day) / 86400000;
}

function serialToDate(serial) {
  const date = new Date(serial * 86400000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  return serialToDate(dateToSerial(date) + days);
}

function datesBetween(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const start = dateToSerial(startDate);
  const end = dateToSerial(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const dates = [];
  for (let cursor = start; cursor <= end; cursor += 1) {
    dates.push(serialToDate(cursor));
  }
  return dates;
}

function weekday(date) {
  return ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function requiredStarts(startTime, duration) {
  const starts = [];
  for (let offset = 0; offset < duration; offset += SLOT_MINUTES) {
    starts.push(addMinutes(startTime, offset));
  }
  return starts;
}

function classDates(batch) {
  const rest = new Set(batch.restDates || []);
  return (batch.dates || datesBetween(batch.startDate, batch.endDate)).filter((date) => !rest.has(date));
}

function batchTimeline(batch, booking) {
  const rest = new Set(batch.restDates || []);
  const dates = batch.dates || datesBetween(batch.startDate, batch.endDate);
  return dates.map((date) =>
    rest.has(date)
      ? { date, type: "rest" }
      : {
          date,
          type: "class",
          startTime: booking?.startTime,
          endTime: booking?.endTime,
        },
  );
}

function canBookOnDate(batchId, date, startTime, duration) {
  const available = new Set(
    state.slots
      .filter((slot) => slot.batchId === batchId && slot.date === date && slot.status === "available")
      .map((slot) => slot.startTime),
  );
  return requiredStarts(startTime, duration).every((start) => available.has(start));
}

function canBookWholePhase(batch, startTime, duration) {
  const dates = classDates(batch);
  return dates.length > 0 && dates.every((date) => canBookOnDate(batch.id, date, startTime, duration));
}

function bookingCountForStudent(batchId, studentId) {
  return state.bookings.filter(
    (booking) => booking.batchId === batchId && booking.studentId === studentId && booking.status === "confirmed",
  ).length;
}

function activeBatches() {
  return state.batches.filter((batch) => batch.status === "active");
}

function selectedBatch() {
  const batchId = $("#studentBatch").value || activeBatches()[0]?.id;
  return state.batches.find((batch) => batch.id === batchId && batch.status === "active");
}

function switchView(view) {
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((section) => section.classList.remove("active-view"));
  $(`#${view}View`).classList.add("active-view");
  $("#pageTitle").textContent = {
    student: "学生抢课",
    teacher: "老师工作台",
    guide: "GitHub Pages",
  }[view];
}

function render() {
  renderStudent();
  renderTeacher();
  renderRestPicker();
}

function renderStudent() {
  const student = state.currentStudent;
  $("#studentStatus").textContent = student ? `已绑定：${student.name}` : "未绑定";
  $("#studentStatus").classList.toggle("active", Boolean(student));
  $("#studentName").value = student?.name || $("#studentName").value;
  $("#inviteCode").value = student?.inviteCode || $("#inviteCode").value;

  const batches = activeBatches();
  const currentValue = $("#studentBatch").value;
  $("#studentBatch").innerHTML = batches.length
    ? batches.map((batch) => `<option value="${batch.id}">${batch.title} ${batch.startDate}-${batch.endDate}</option>`).join("")
    : `<option value="">暂无阶段课程</option>`;
  if (currentValue && batches.some((batch) => batch.id === currentValue)) {
    $("#studentBatch").value = currentValue;
  }

  renderPhaseTimeline();
  renderFixedSlots();
  renderMyBookings();
  renderStudentScheduleTable();
}

function renderPhaseTimeline() {
  const batch = selectedBatch();
  const target = $("#phaseTimeline");
  if (!batch) {
    target.innerHTML = "";
    return;
  }
  const dates = batch.dates || datesBetween(batch.startDate, batch.endDate);
  const rest = new Set(batch.restDates || []);
  target.innerHTML = `
    <div class="phase-summary">
      <strong>${batch.title}</strong>
      <span>${dates.length} 天阶段 · ${classDates(batch).length} 个上课日 · ${rest.size} 个休息日</span>
    </div>
    <div class="date-strip">
      ${dates
        .map(
          (date) => `
            <span class="date-chip ${rest.has(date) ? "rest" : "class"}">
              <b>${date.slice(5)}</b>
              <small>周${weekday(date)} · ${rest.has(date) ? "休息" : "上课"}</small>
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderFixedSlots() {
  const batch = selectedBatch();
  const duration = Number($("#durationSelect").value || 90);
  const board = $("#slotBoard");
  if (!batch) {
    board.innerHTML = `<div class="empty-state">老师还没有发布阶段课程。</div>`;
    return;
  }
  const starts = [...new Set(state.slots.filter((slot) => slot.batchId === batch.id).map((slot) => slot.startTime))].sort();
  if (!starts.length) {
    board.innerHTML = `<div class="empty-state">这个阶段没有可用上课日，请联系老师调整休息日。</div>`;
    return;
  }
  board.innerHTML = `
    <div class="fixed-slot-grid">
      ${starts
        .map((start) => {
          const available = canBookWholePhase(batch, start, duration);
          return `
            <button class="slot ${available ? "available" : "occupied"}" data-start-time="${start}" ${available ? "" : "disabled"}>
              <strong>${start}</strong>
              <span>${addMinutes(start, duration)} 结束</span>
              <em>${available ? `预约整个阶段 · ${formatDuration(duration)}` : "当前课时长度不可选"}</em>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderBookingTimeline(booking) {
  const batch = state.batches.find((item) => item.id === booking.batchId);
  const timeline = batch ? batchTimeline(batch, booking) : booking.sessions || [];
  return `
    <div class="mini-timeline">
      ${timeline
        .map(
          (item) => `
            <span class="${item.type === "rest" ? "rest" : "class"}">
              <b>${item.date.slice(5)}</b>
              <small>${item.type === "rest" ? "休息" : `${item.startTime}-${item.endTime}`}</small>
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderMyBookings() {
  const studentId = state.currentStudent?.id;
  const bookings = state.bookings.filter((booking) => booking.studentId === studentId);
  $("#myBookings").innerHTML = bookings.length
    ? bookings
        .map(
          (booking) => `
            <div class="item booking-card">
              <div class="item-header">
                <div>
                  <strong>${booking.title}</strong>
                  <p>${booking.startDate || booking.date} 至 ${booking.endDate || booking.date} · 固定 ${booking.startTime}-${booking.endTime}</p>
                </div>
                <span class="mini-pill ${booking.status === "confirmed" ? "green" : ""}">${booking.status === "confirmed" ? "已预约" : "已取消"}</span>
              </div>
              ${renderBookingTimeline(booking)}
              ${
                booking.status === "confirmed"
                  ? `<div class="row-actions"><button class="danger-button" data-cancel-booking="${booking.id}">申请取消</button></div>`
                  : ""
              }
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">还没有预约课程。</div>`;
}

function renderTeacher() {
  renderInvites();
  renderCourseList();
  renderTeacherBookings();
  renderTeacherScheduleTable();
  renderRequests();
}

function renderInvites() {
  $("#inviteList").innerHTML = state.invites.length
    ? state.invites
        .map(
          (invite) => `
            <div class="item">
              <div class="item-header">
                <strong>${invite.code}</strong>
                <span>${invite.usedBy.length}/${invite.maxUses}</span>
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">暂无邀请码。</div>`;
}

function renderCourseList() {
  const batches = activeBatches();
  $("#courseSummary").textContent = `${batches.length} 个阶段课程`;
  $("#courseList").innerHTML = batches.length
    ? batches
        .map((batch) => {
          const dates = batch.dates || datesBetween(batch.startDate, batch.endDate);
          const bookings = state.bookings.filter((booking) => booking.batchId === batch.id && booking.status === "confirmed");
          return `
            <div class="item course-card">
              <div class="item-header">
                <div>
                  <strong>${batch.title}</strong>
                  <p>${batch.startDate} 至 ${batch.endDate} · ${classDates(batch).length}/${dates.length} 个上课日 · ${bookings.length} 个预约</p>
                </div>
                <button class="danger-button" data-delete-batch="${batch.id}">删除阶段</button>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">暂无阶段课程。</div>`;
}

function renderTeacherBookings() {
  const confirmed = state.bookings.filter((booking) => booking.status === "confirmed");
  $("#bookingSummary").textContent = `${confirmed.length} 个阶段预约`;
  $("#teacherBookings").innerHTML = confirmed.length
    ? confirmed
        .sort((a, b) => `${a.startDate || a.date} ${a.startTime}`.localeCompare(`${b.startDate || b.date} ${b.startTime}`))
        .map(
          (booking) => `
            <div class="item booking-card">
              <div class="item-header">
                <div>
                  <strong>${booking.studentName} · ${booking.title}</strong>
                  <p>${booking.startDate || booking.date} 至 ${booking.endDate || booking.date} · 固定 ${booking.startTime}-${booking.endTime}</p>
                </div>
                <span class="mini-pill green">${booking.location || "MLA STUDIO"}</span>
              </div>
              ${renderBookingTimeline(booking)}
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">暂无已预约课程。</div>`;
}

function renderRequests() {
  const pending = state.requests.filter((request) => request.status === "pending");
  $("#requestList").innerHTML = pending.length
    ? pending
        .map(
          (request) => `
            <div class="item">
              <div class="item-header">
                <strong>${request.studentName} 申请取消阶段课程</strong>
                <span>${request.bookingRange}</span>
              </div>
              <div>${request.reason || "未填写原因"}</div>
              <div class="row-actions">
                <button class="primary-button" data-review="${request.id}" data-decision="approved">通过</button>
                <button class="danger-button" data-review="${request.id}" data-decision="rejected">拒绝</button>
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">暂无待审核申请。</div>`;
}

function renderRestPicker() {
  const dates = datesBetween($("#startDate").value, $("#endDate").value || $("#startDate").value);
  const target = $("#restDayPicker");
  if (!dates.length) {
    target.innerHTML = `<div class="empty-state">先选择阶段开始和结束日期。</div>`;
    return;
  }
  restDraft = new Set([...restDraft].filter((date) => dates.includes(date)));
  target.innerHTML = dates
    .map(
      (date) => `
        <button class="date-toggle ${restDraft.has(date) ? "rest" : "class"}" data-rest-date="${date}">
          <strong>${date.slice(5)}</strong>
          <span>周${weekday(date)}</span>
          <em>${restDraft.has(date) ? "休息" : "上课"}</em>
        </button>
      `,
    )
    .join("");
}

function tableRowsForBookings(bookings) {
  const rows = [];
  bookings.forEach((booking) => {
    const batch = state.batches.find((item) => item.id === booking.batchId);
    if (!batch) return;
    rows.push({
      studentName: booking.studentName,
      title: booking.title,
      range: `${booking.startDate || batch.startDate} 至 ${booking.endDate || batch.endDate}`,
      timeline: batchTimeline(batch, booking),
    });
  });
  return rows;
}

function renderScheduleTable(targetSelector, bookings) {
  const target = $(targetSelector);
  const rows = tableRowsForBookings(bookings.filter((booking) => booking.status === "confirmed"));
  const dates = [...new Set(rows.flatMap((row) => row.timeline.map((item) => item.date)))].sort();
  if (!rows.length || !dates.length) {
    target.innerHTML = `<div class="empty-state">暂无可生成的课表表单。</div>`;
    return;
  }
  target.innerHTML = `
    <table class="schedule-table">
      <thead>
        <tr>
          <th>学生</th>
          <th>阶段</th>
          ${dates.map((date) => `<th>${date.slice(5)}<br><small>周${weekday(date)}</small></th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td><strong>${row.studentName}</strong></td>
                <td>${row.title}<br><small>${row.range}</small></td>
                ${dates
                  .map((date) => {
                    const item = row.timeline.find((entry) => entry.date === date);
                    if (!item) return `<td class="blank">-</td>`;
                    return item.type === "rest"
                      ? `<td class="rest-cell">休息</td>`
                      : `<td class="class-cell">${item.startTime}-${item.endTime}</td>`;
                  })
                  .join("")}
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function scheduleTableText(bookings) {
  const rows = tableRowsForBookings(bookings.filter((booking) => booking.status === "confirmed"));
  const dates = [...new Set(rows.flatMap((row) => row.timeline.map((item) => item.date)))].sort();
  if (!rows.length || !dates.length) return "";
  const lines = [["学生", "阶段", ...dates].join("\t")];
  rows.forEach((row) => {
    lines.push(
      [
        row.studentName,
        `${row.title} ${row.range}`,
        ...dates.map((date) => {
          const item = row.timeline.find((entry) => entry.date === date);
          if (!item) return "";
          return item.type === "rest" ? "休息" : `${item.startTime}-${item.endTime}`;
        }),
      ].join("\t"),
    );
  });
  return lines.join("\n");
}

function renderStudentScheduleTable() {
  const studentId = state.currentStudent?.id;
  const bookings = state.bookings.filter((booking) => booking.studentId === studentId);
  renderScheduleTable("#studentScheduleTable", bookings);
}

function renderTeacherScheduleTable() {
  renderScheduleTable("#teacherScheduleTable", state.bookings);
}

function bindInvite() {
  const code = $("#inviteCode").value.trim().toUpperCase();
  const name = $("#studentName").value.trim();
  if (!name || !code) {
    toast("请填写姓名和邀请码");
    return;
  }
  const invite = state.invites.find((item) => item.code === code);
  if (!invite) {
    toast("邀请码不存在");
    return;
  }
  if (invite.usedBy.length >= invite.maxUses && !invite.usedBy.some((item) => item.name === name)) {
    toast("邀请码已用完");
    return;
  }
  const existing = invite.usedBy.find((item) => item.name === name);
  const student = existing || { id: uid("student"), name, inviteCode: code };
  if (!existing) invite.usedBy.push(student);
  state.currentStudent = student;
  saveState();
  render();
  toast("绑定成功");
}

function bookFixedTime(startTime) {
  if (!state.currentStudent) {
    toast("请先绑定邀请码");
    return;
  }
  const batch = selectedBatch();
  const duration = Number($("#durationSelect").value);
  if (!batch) return;
  if (bookingCountForStudent(batch.id, state.currentStudent.id) >= batch.bookingLimit) {
    toast("已达到本阶段预约上限");
    return;
  }
  if (!canBookWholePhase(batch, startTime, duration)) {
    toast("这个固定时段已不可预约");
    renderFixedSlots();
    return;
  }
  const bookingId = uid("booking");
  const starts = requiredStarts(startTime, duration);
  classDates(batch).forEach((date) => {
    state.slots.forEach((slot) => {
      if (slot.batchId === batch.id && slot.date === date && starts.includes(slot.startTime)) {
        slot.status = "booked";
        slot.bookingId = bookingId;
        slot.studentId = state.currentStudent.id;
      }
    });
  });
  state.bookings.push({
    id: bookingId,
    batchId: batch.id,
    studentId: state.currentStudent.id,
    studentName: state.currentStudent.name,
    title: batch.title,
    location: batch.location,
    startDate: batch.startDate,
    endDate: batch.endDate,
    startTime,
    endTime: addMinutes(startTime, duration),
    duration,
    status: "confirmed",
  });
  saveState();
  render();
  toast("阶段课程预约成功");
}

function createInvite() {
  const code = ($("#newInviteCode").value.trim() || Math.random().toString(36).slice(2, 8)).toUpperCase();
  const maxUses = Math.max(1, Number($("#inviteUses").value || 1));
  if (state.invites.some((invite) => invite.code === code)) {
    toast("邀请码已存在");
    return;
  }
  state.invites.unshift({ id: uid("invite"), code, maxUses, usedBy: [] });
  $("#newInviteCode").value = "";
  saveState();
  render();
  navigator.clipboard?.writeText(code);
  toast(`邀请码 ${code} 已生成`);
}

function publishBatch() {
  const title = $("#batchTitle").value.trim() || "MLA STUDIO 私教课";
  const location = $("#batchLocation").value.trim();
  const startDate = $("#startDate").value;
  const endDate = $("#endDate").value || startDate;
  const bookingLimit = Math.max(1, Number($("#bookingLimit").value || 1));
  const allDates = datesBetween(startDate, endDate);
  const restDates = allDates.filter((date) => restDraft.has(date));
  const activeDates = allDates.filter((date) => !restDraft.has(date));
  const windows = $$(".window-row")
    .map((row) => ({
      start: row.querySelector(".window-start").value,
      end: row.querySelector(".window-end").value,
    }))
    .filter((window) => window.start && window.end && toMinutes(window.start) < toMinutes(window.end));
  if (!startDate || !endDate || !windows.length || !activeDates.length) {
    toast("请填写日期、时间段，并至少保留一个上课日");
    return;
  }
  const batchId = uid("batch");
  const slots = [];
  activeDates.forEach((date) => {
    windows.forEach((window) => {
      for (let start = toMinutes(window.start); start < toMinutes(window.end); start += SLOT_MINUTES) {
        slots.push({
          id: uid("slot"),
          batchId,
          date,
          startTime: toHHMM(start),
          endTime: toHHMM(start + SLOT_MINUTES),
          status: "available",
        });
      }
    });
  });
  state.batches.unshift({
    id: batchId,
    title,
    location,
    startDate,
    endDate,
    bookingLimit,
    windows,
    dates: allDates,
    restDates,
    status: "active",
  });
  state.slots.push(...slots);
  saveState();
  render();
  toast(`已发布阶段：${activeDates.length} 个上课日，${restDates.length} 个休息日`);
}

function deleteBatch(batchId) {
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch) return;
  const count = state.bookings.filter((booking) => booking.batchId === batchId && booking.status === "confirmed").length;
  const ok = confirm(`确认删除“${batch.title}”？这会移除 ${count} 个预约和相关申请。`);
  if (!ok) return;
  state.batches = state.batches.filter((item) => item.id !== batchId);
  state.slots = state.slots.filter((slot) => slot.batchId !== batchId);
  const deletedBookingIds = new Set(state.bookings.filter((booking) => booking.batchId === batchId).map((booking) => booking.id));
  state.bookings = state.bookings.filter((booking) => booking.batchId !== batchId);
  state.requests = state.requests.filter((request) => !deletedBookingIds.has(request.bookingId));
  saveState();
  render();
  toast("阶段课程已删除");
}

function requestCancel(bookingId) {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking || state.requests.some((item) => item.bookingId === bookingId && item.status === "pending")) {
    toast("已有待审核申请");
    return;
  }
  const reason = prompt("请输入取消原因，老师审核后释放整个阶段时段") || "";
  state.requests.unshift({
    id: uid("request"),
    bookingId,
    studentName: booking.studentName,
    bookingRange: `${booking.startDate || booking.date} 至 ${booking.endDate || booking.date}`,
    status: "pending",
    reason,
  });
  saveState();
  render();
  toast("取消申请已提交");
}

function reviewRequest(requestId, decision) {
  const request = state.requests.find((item) => item.id === requestId);
  const booking = state.bookings.find((item) => item.id === request.bookingId);
  request.status = decision;
  if (decision === "approved" && booking) {
    booking.status = "cancelled";
    state.slots.forEach((slot) => {
      if (slot.bookingId === booking.id) {
        slot.status = "available";
        slot.bookingId = "";
        slot.studentId = "";
      }
    });
  }
  saveState();
  render();
  toast(decision === "approved" ? "已通过，整个阶段时段已释放" : "已拒绝申请");
}

function copyText(text, emptyMessage) {
  if (!text) {
    toast(emptyMessage);
    return;
  }
  navigator.clipboard?.writeText(text);
  toast("表格已复制");
}

function copyMySchedule() {
  const bookings = state.bookings.filter(
    (booking) => booking.studentId === state.currentStudent?.id && booking.status === "confirmed",
  );
  copyText(scheduleTableText(bookings), "没有可复制的课表");
}

function copyTeacherTable() {
  copyText(scheduleTableText(state.bookings), "没有可复制的课表");
}

function seedDemo() {
  if (state.batches.length || state.invites.length) {
    toast("已有数据，无需填充");
    return;
  }
  state.invites.push({ id: uid("invite"), code: "MLA2026", maxUses: 30, usedBy: [] });
  $("#startDate").value = "2026-07-15";
  $("#endDate").value = "2026-07-25";
  restDraft = new Set(["2026-07-20"]);
  $("#bookingLimit").value = 1;
  renderRestPicker();
  publishBatch();
  toast("示例已生成，学生邀请码 MLA2026");
}

function resetDemo() {
  if (!confirm("确认清空当前浏览器里的演示数据？")) return;
  state = structuredClone(defaultState);
  restDraft = new Set();
  saveState();
  setDefaultDates();
  render();
  toast("已清空");
}

function setDefaultDates() {
  const today = "2026-07-15";
  $("#startDate").value = today;
  $("#endDate").value = addDays(today, 10);
  $("#bookingLimit").value = 1;
  restDraft = new Set();
}

function bindEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#bindInvite").addEventListener("click", bindInvite);
  $("#createInvite").addEventListener("click", createInvite);
  $("#publishBatch").addEventListener("click", publishBatch);
  $("#seedDemo").addEventListener("click", seedDemo);
  $("#resetDemo").addEventListener("click", resetDemo);
  $("#copyMySchedule").addEventListener("click", copyMySchedule);
  $("#copyTeacherTable").addEventListener("click", copyTeacherTable);
  $("#studentBatch").addEventListener("change", () => {
    renderPhaseTimeline();
    renderFixedSlots();
  });
  $("#durationSelect").addEventListener("change", renderFixedSlots);
  $("#startDate").addEventListener("change", renderRestPicker);
  $("#endDate").addEventListener("change", renderRestPicker);
  $("#addWindow").addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "window-row";
    row.innerHTML = `
      <input class="window-start" type="time" value="09:00" step="1800" />
      <input class="window-end" type="time" value="10:30" step="1800" />
    `;
    $(".window-editor").appendChild(row);
  });
  document.addEventListener("click", (event) => {
    const slot = event.target.closest("[data-start-time]");
    const cancel = event.target.closest("[data-cancel-booking]");
    const review = event.target.closest("[data-review]");
    const restDate = event.target.closest("[data-rest-date]");
    const deleteButton = event.target.closest("[data-delete-batch]");
    if (slot) bookFixedTime(slot.dataset.startTime);
    if (cancel) requestCancel(cancel.dataset.cancelBooking);
    if (review) reviewRequest(review.dataset.review, review.dataset.decision);
    if (deleteButton) deleteBatch(deleteButton.dataset.deleteBatch);
    if (restDate) {
      const date = restDate.dataset.restDate;
      if (restDraft.has(date)) restDraft.delete(date);
      else restDraft.add(date);
      renderRestPicker();
    }
  });
}

setDefaultDates();
bindEvents();
render();

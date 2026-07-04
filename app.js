"use strict";

const SLOT_MINUTES = 30;
const DURATIONS = [30, 90, 120, 150, 180];
const STORAGE_KEY = "mla-real-booking-demo-v1";

const state = {
  backend: "demo",
  user: null,
  profile: null,
  view: "auth",
  courses: [],
  courseDays: [],
  slots: [],
  bookings: [],
  leaveRequests: [],
  invites: [],
  selectedCourseId: null,
  selectedDuration: 90,
  realtimeChannel: null,
};

let supabaseClient = null;

const $ = (id) => document.getElementById(id);

function toMinutes(time) {
  const [hours, minutes] = String(time).slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function toHHMM(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function addMinutes(time, minutes) {
  return toHHMM(toMinutes(time) + minutes);
}

function dateSerial(date) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

function serialDate(serial) {
  const date = new Date(serial * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function datesBetween(startDate, endDate) {
  const dates = [];
  for (let cursor = dateSerial(startDate); cursor <= dateSerial(endDate); cursor += 1) {
    dates.push(serialDate(cursor));
  }
  return dates;
}

function formatDate(date) {
  return date.slice(5).replace("-", "-");
}

function weekday(date) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function durationLabel(minutes) {
  return `${minutes / 60} 小时`;
}

function normalizeTime(time) {
  return String(time || "").slice(0, 5);
}

function parseWindows(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [start, end] = item.split("-").map((part) => part.trim());
      if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || toMinutes(start) >= toMinutes(end)) {
        throw new Error(`时段格式不正确：${item}`);
      }
      return { start, end };
    });
}

function codeValue() {
  return `MLA${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 2600);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function activeCourses() {
  return state.courses.filter((course) => course.status !== "deleted");
}

function daysForCourse(courseId) {
  return state.courseDays
    .filter((day) => day.course_id === courseId)
    .sort((a, b) => a.course_date.localeCompare(b.course_date));
}

function classDaysForCourse(courseId) {
  return daysForCourse(courseId).filter((day) => !day.is_rest_day);
}

function slotsForDate(courseId, date) {
  return state.slots
    .filter((slot) => slot.course_id === courseId && slot.course_date === date)
    .sort((a, b) => normalizeTime(a.start_time).localeCompare(normalizeTime(b.start_time)));
}

function requiredStarts(startTime, duration) {
  const starts = [];
  for (let offset = 0; offset < duration; offset += SLOT_MINUTES) {
    starts.push(addMinutes(startTime, offset));
  }
  return starts;
}

function canBookFixedTime(courseId, startTime, duration) {
  const classDays = classDaysForCourse(courseId);
  if (!classDays.length) return false;
  return classDays.every((day) => {
    const availableStarts = new Set(
      slotsForDate(courseId, day.course_date)
        .filter((slot) => slot.status === "available")
        .map((slot) => normalizeTime(slot.start_time)),
    );
    return requiredStarts(startTime, duration).every((start) => availableStarts.has(start));
  });
}

function possibleStarts(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return [];
  const starts = new Set();
  course.windows.forEach((window) => {
    for (let cursor = toMinutes(window.start); cursor < toMinutes(window.end); cursor += SLOT_MINUTES) {
      starts.add(toHHMM(cursor));
    }
  });
  return [...starts].sort();
}

function bookingLeave(bookingId) {
  return state.leaveRequests
    .filter((request) => request.booking_id === bookingId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

function currentStudentName() {
  return state.profile?.display_name || state.user?.email?.split("@")[0] || "学生";
}

function loadDemoState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);

  const courseId = "course_summer";
  const course = {
    id: courseId,
    title: "MLA STUDIO 暑假课程",
    start_date: "2026-07-15",
    end_date: "2026-07-25",
    windows: [{ start: "08:00", end: "10:00" }, { start: "14:00", end: "18:00" }],
    booking_limit: 1,
    location: "MLA STUDIO",
    status: "active",
  };
  const courseDays = datesBetween(course.start_date, course.end_date).map((date) => ({
    id: `day_${date}`,
    course_id: courseId,
    course_date: date,
    is_rest_day: date === "2026-07-20",
  }));
  const slots = [];
  courseDays.forEach((day) => {
    course.windows.forEach((window) => {
      for (let cursor = toMinutes(window.start); cursor < toMinutes(window.end); cursor += SLOT_MINUTES) {
        slots.push({
          id: uid("slot"),
          course_id: courseId,
          course_day_id: day.id,
          course_date: day.course_date,
          start_time: toHHMM(cursor),
          end_time: toHHMM(cursor + SLOT_MINUTES),
          status: day.is_rest_day ? "blocked" : "available",
          booking_id: null,
          student_id: null,
        });
      }
    });
  });

  return {
    courses: [course],
    courseDays,
    slots,
    bookings: [],
    leaveRequests: [],
    invites: [
      { id: "invite_chen", code: "111", student_name: "春建司", status: "unused", used_by: null },
      { id: "invite_he", code: "222", student_name: "呃呃", status: "unused", used_by: null },
    ],
  };
}

function saveDemoState() {
  if (state.backend !== "demo") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      courses: state.courses,
      courseDays: state.courseDays,
      slots: state.slots,
      bookings: state.bookings,
      leaveRequests: state.leaveRequests,
      invites: state.invites,
    }),
  );
}

function applyData(data) {
  state.courses = data.courses || [];
  state.courseDays = data.courseDays || [];
  state.slots = data.slots || [];
  state.bookings = data.bookings || [];
  state.leaveRequests = data.leaveRequests || [];
  state.invites = data.invites || [];
  state.selectedCourseId = state.selectedCourseId || activeCourses()[0]?.id || null;
}

function hasSupabaseConfig() {
  const config = window.MLA_SUPABASE_CONFIG;
  return Boolean(
    window.supabase &&
      config &&
      config.url &&
      config.anonKey &&
      !config.url.includes("YOUR-PROJECT") &&
      !config.anonKey.includes("YOUR-SUPABASE"),
  );
}

async function initSupabase() {
  if (!hasSupabaseConfig()) {
    state.backend = "demo";
    applyData(loadDemoState());
    return;
  }
  state.backend = "supabase";
  const config = window.MLA_SUPABASE_CONFIG;
  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  const { data } = await supabaseClient.auth.getSession();
  if (data.session?.user) {
    state.user = data.session.user;
    await ensureProfile();
    await loadRemoteData();
    subscribeRealtime();
  }
}

async function ensureProfile() {
  const { data, error } = await supabaseClient.rpc("ensure_profile");
  if (error) throw error;
  state.profile = data;
}

async function loadRemoteData() {
  const [
    courses,
    courseDays,
    slots,
    bookings,
    leaveRequests,
    invites,
  ] = await Promise.all([
    supabaseClient.from("courses").select("*").order("start_date"),
    supabaseClient.from("course_days").select("*").order("course_date"),
    supabaseClient.from("slots").select("*").order("course_date").order("start_time"),
    supabaseClient.from("bookings").select("*, profiles:student_id(display_name,email)").order("start_time"),
    supabaseClient.from("leave_requests").select("*, profiles:student_id(display_name,email)").order("created_at", { ascending: false }),
    state.profile?.role === "teacher"
      ? supabaseClient.from("invite_codes").select("*").order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const failed = [courses, courseDays, slots, bookings, leaveRequests, invites].find((item) => item.error);
  if (failed) throw failed.error;

  applyData({
    courses: courses.data || [],
    courseDays: courseDays.data || [],
    slots: slots.data || [],
    bookings: (bookings.data || []).map((booking) => ({
      ...booking,
      student_name: booking.profiles?.display_name || booking.profiles?.email || "学生",
    })),
    leaveRequests: (leaveRequests.data || []).map((request) => ({
      ...request,
      student_name: request.profiles?.display_name || request.profiles?.email || "学生",
    })),
    invites: invites.data || [],
  });
}

function subscribeRealtime() {
  if (state.realtimeChannel || !supabaseClient) return;
  state.realtimeChannel = supabaseClient
    .channel("mla-booking-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, reloadAndRender)
    .on("postgres_changes", { event: "*", schema: "public", table: "course_days" }, reloadAndRender)
    .on("postgres_changes", { event: "*", schema: "public", table: "slots" }, reloadAndRender)
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, reloadAndRender)
    .on("postgres_changes", { event: "*", schema: "public", table: "leave_requests" }, reloadAndRender)
    .subscribe();
}

async function reloadAndRender() {
  if (state.backend === "supabase") await loadRemoteData();
  render();
}

async function signInWithEmail() {
  const email = $("loginEmail").value.trim();
  if (!email) return toast("请先输入邮箱");
  if (state.backend === "demo") return toast("当前是本地演示模式，请用下方演示入口");

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) return toast(error.message);
  toast("验证码已发送，请到邮箱完成登录");
}

async function signOut() {
  if (state.backend === "supabase") {
    await supabaseClient.auth.signOut();
  }
  state.user = null;
  state.profile = null;
  state.view = "auth";
  render();
}

async function demoLogin(role) {
  const id = role === "teacher" ? "teacher_demo" : "student_demo";
  state.user = { id, email: role === "teacher" ? "teacher@mla.studio" : "student@demo.local" };
  state.profile = {
    id,
    email: state.user.email,
    role,
    display_name: role === "teacher" ? "MLA 老师" : "演示学生",
    invite_code: role === "student" ? "DEMO" : null,
  };
  state.view = role === "teacher" ? "teacher" : "student";
  render();
}

async function bindInvite() {
  const code = $("inviteCode").value.trim();
  const typedName = $("studentName").value.trim();
  if (!code) return toast("请输入邀请码");

  if (state.backend === "supabase") {
    const { data, error } = await supabaseClient.rpc("claim_invite", { input_code: code });
    if (error) return toast(error.message);
    state.profile = data;
    await loadRemoteData();
    render();
    return toast("绑定成功");
  }

  const invite = state.invites.find((item) => item.code === code && item.status === "unused");
  if (!invite && code !== "DEMO") return toast("邀请码无效或已使用");
  state.profile.display_name = invite?.student_name || typedName || state.profile.display_name;
  state.profile.invite_code = code;
  if (invite) {
    invite.status = "used";
    invite.used_by = state.user.id;
  }
  saveDemoState();
  render();
  toast("绑定成功");
}

async function createInvite() {
  const name = $("inviteStudentName").value.trim();
  const code = $("inviteCodeValue").value.trim() || codeValue();
  if (!name) return toast("请填写学生姓名");

  if (state.backend === "supabase") {
    const { error } = await supabaseClient.from("invite_codes").insert({
      code,
      student_name: name,
      created_by: state.profile.id,
    });
    if (error) return toast(error.message);
    await loadRemoteData();
  } else {
    state.invites.unshift({ id: uid("invite"), code, student_name: name, status: "unused", used_by: null });
    saveDemoState();
  }
  $("inviteStudentName").value = "";
  $("inviteCodeValue").value = "";
  render();
  toast(`邀请码已生成：${code}`);
}

function generateCourseRows(course) {
  const restSet = new Set(
    $("restDates").value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const courseDays = datesBetween(course.start_date, course.end_date).map((date) => ({
    id: uid("day"),
    course_id: course.id,
    course_date: date,
    is_rest_day: restSet.has(date),
  }));
  const slots = [];
  courseDays.forEach((day) => {
    course.windows.forEach((window) => {
      for (let cursor = toMinutes(window.start); cursor < toMinutes(window.end); cursor += SLOT_MINUTES) {
        slots.push({
          id: uid("slot"),
          course_id: course.id,
          course_day_id: day.id,
          course_date: day.course_date,
          start_time: toHHMM(cursor),
          end_time: toHHMM(cursor + SLOT_MINUTES),
          status: day.is_rest_day ? "blocked" : "available",
          booking_id: null,
          student_id: null,
        });
      }
    });
  });
  return { courseDays, slots };
}

async function createCourse() {
  let windows;
  try {
    windows = parseWindows($("courseWindows").value);
  } catch (error) {
    return toast(error.message);
  }
  const course = {
    id: uid("course"),
    title: $("courseTitle").value.trim() || "MLA STUDIO 阶段课程",
    start_date: $("courseStartDate").value,
    end_date: $("courseEndDate").value,
    windows,
    booking_limit: Number($("bookingLimit").value || 1),
    location: $("courseLocation").value.trim(),
    status: "active",
  };
  if (!course.start_date || !course.end_date || dateSerial(course.start_date) > dateSerial(course.end_date)) {
    return toast("请检查课程日期");
  }

  const generated = generateCourseRows(course);
  if (state.backend === "supabase") {
    const { data, error } = await supabaseClient
      .from("courses")
      .insert({
        title: course.title,
        start_date: course.start_date,
        end_date: course.end_date,
        windows,
        booking_limit: course.booking_limit,
        location: course.location,
        created_by: state.profile.id,
      })
      .select()
      .single();
    if (error) return toast(error.message);

    const days = generated.courseDays.map((day) => ({ ...day, course_id: data.id, id: undefined }));
    const { data: insertedDays, error: dayError } = await supabaseClient.from("course_days").insert(days).select();
    if (dayError) return toast(dayError.message);

    const dayByDate = new Map(insertedDays.map((day) => [day.course_date, day.id]));
    const slots = generated.slots.map((slot) => ({
      course_id: data.id,
      course_day_id: dayByDate.get(slot.course_date),
      course_date: slot.course_date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      status: slot.status,
    }));
    const { error: slotError } = await supabaseClient.from("slots").insert(slots);
    if (slotError) return toast(slotError.message);
    await loadRemoteData();
  } else {
    state.courses.unshift(course);
    state.courseDays.push(...generated.courseDays);
    state.slots.push(...generated.slots);
    state.selectedCourseId = course.id;
    saveDemoState();
  }
  render();
  toast("阶段课程已发布");
}

async function deleteCourse(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;
  if (!window.confirm(`确认删除「${course.title}」吗？相关 slot、预约和请假申请都会移除。`)) return;

  if (state.backend === "supabase") {
    const { error } = await supabaseClient.from("courses").update({ status: "deleted" }).eq("id", courseId);
    if (error) return toast(error.message);
    await loadRemoteData();
  } else {
    const bookingIds = new Set(state.bookings.filter((booking) => booking.course_id === courseId).map((booking) => booking.id));
    state.courses = state.courses.filter((item) => item.id !== courseId);
    state.courseDays = state.courseDays.filter((day) => day.course_id !== courseId);
    state.slots = state.slots.filter((slot) => slot.course_id !== courseId);
    state.bookings = state.bookings.filter((booking) => booking.course_id !== courseId);
    state.leaveRequests = state.leaveRequests.filter((request) => !bookingIds.has(request.booking_id));
    state.selectedCourseId = activeCourses()[0]?.id || null;
    saveDemoState();
  }
  render();
  toast("阶段课程已删除");
}

async function bookCourse(startTime) {
  const courseId = state.selectedCourseId;
  const duration = state.selectedDuration;
  if (!state.profile?.invite_code && state.profile?.role !== "teacher") return toast("请先绑定邀请码");
  if (!canBookFixedTime(courseId, startTime, duration)) return toast("该固定时段已不可约");

  if (state.backend === "supabase") {
    const { error } = await supabaseClient.rpc("book_course", {
      input_course_id: courseId,
      input_start_time: startTime,
      input_duration_minutes: duration,
    });
    if (error) return toast(error.message);
    await loadRemoteData();
  } else {
    const booking = {
      id: uid("booking"),
      course_id: courseId,
      student_id: state.user.id,
      student_name: currentStudentName(),
      start_time: startTime,
      end_time: addMinutes(startTime, duration),
      duration_minutes: duration,
      status: "confirmed",
      created_at: new Date().toISOString(),
    };
    state.bookings.push(booking);
    classDaysForCourse(courseId).forEach((day) => {
      const required = new Set(requiredStarts(startTime, duration));
      state.slots.forEach((slot) => {
        if (slot.course_id === courseId && slot.course_date === day.course_date && required.has(normalizeTime(slot.start_time))) {
          slot.status = "booked";
          slot.booking_id = booking.id;
          slot.student_id = state.user.id;
        }
      });
    });
    saveDemoState();
  }
  render();
  toast("预约成功，课表已生成");
}

async function requestLeave(bookingId) {
  const reason = window.prompt("请输入请假原因", "临时有事需要请假");
  if (reason === null) return;

  if (state.backend === "supabase") {
    const { error } = await supabaseClient.rpc("request_leave", {
      input_booking_id: bookingId,
      input_reason: reason,
    });
    if (error) return toast(error.message);
    await loadRemoteData();
  } else {
    const booking = state.bookings.find((item) => item.id === bookingId);
    state.leaveRequests.unshift({
      id: uid("leave"),
      booking_id: booking.id,
      course_id: booking.course_id,
      student_id: booking.student_id,
      student_name: booking.student_name,
      reason,
      status: "pending",
      created_at: new Date().toISOString(),
    });
    saveDemoState();
  }
  render();
  toast("请假申请已提交");
}

async function reviewLeave(requestId, status) {
  if (state.backend === "supabase") {
    const { error } = await supabaseClient.rpc("review_leave", {
      input_request_id: requestId,
      input_status: status,
      input_teacher_note: "",
    });
    if (error) return toast(error.message);
    await loadRemoteData();
  } else {
    const request = state.leaveRequests.find((item) => item.id === requestId);
    request.status = status;
    request.reviewed_at = new Date().toISOString();
    saveDemoState();
  }
  render();
  toast(status === "approved" ? "已批准请假，名额保留" : "已驳回请假");
}

function setView(view) {
  if (!state.user && view !== "auth") return;
  if (view === "teacher" && state.profile?.role !== "teacher") return toast("学生账号不能进入老师工作台");
  if (view === "student" && state.profile?.role === "teacher") return toast("老师账号请使用老师工作台");
  state.view = view;
  render();
}

function render() {
  renderShell();
  if (!state.user) {
    state.view = "auth";
  } else if (state.view === "auth") {
    state.view = state.profile?.role === "teacher" ? "teacher" : "student";
  }
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active-view", node.id === `${state.view}View`));
  renderAuth();
  renderStudent();
  renderTeacher();
  renderSchedule();
}

function renderShell() {
  $("backendMode").textContent = state.backend === "supabase" ? "Supabase 实时版" : "本地演示模式";
  $("backendMode").classList.toggle("demo", state.backend === "demo");
  $("pageTitle").textContent = {
    auth: "欢迎登录",
    student: "学生抢课",
    teacher: "老师工作台",
    schedule: state.profile?.role === "teacher" ? "学生总课表" : "我的课表",
  }[state.view] || "MLA STUDIO";
  $("signOutButton").hidden = !state.user;
  $("appNav").hidden = !state.user;
  document.querySelectorAll(".teacher-only").forEach((node) => {
    node.hidden = state.profile?.role !== "teacher";
  });
  document.querySelectorAll(".student-only").forEach((node) => {
    node.hidden = state.profile?.role === "teacher";
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  $("sideMetrics").innerHTML = [
    ["阶段", activeCourses().length],
    ["预约", state.bookings.filter((item) => item.status === "confirmed").length],
    ["请假", state.leaveRequests.filter((item) => item.status === "pending").length],
    ["可约", state.slots.filter((item) => item.status === "available").length],
  ]
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderAuth() {
  $("demoLoginActions").hidden = state.backend !== "demo";
  $("authHint").textContent =
    state.backend === "demo"
      ? "当前没有检测到 Supabase 配置，页面使用本地演示数据。"
      : "输入邮箱后请到邮箱点击登录链接，返回本页即可进入系统。";
}

function renderStudent() {
  if (!state.user) return;
  $("studentInviteStatus").textContent = state.profile?.invite_code ? `已绑定 ${state.profile.display_name || ""}` : "未绑定";
  $("studentName").value = state.profile?.display_name || "";

  const courses = activeCourses();
  $("studentCourse").innerHTML = courses.length
    ? courses.map((course) => `<option value="${course.id}">${course.title} ${course.start_date} 至 ${course.end_date}</option>`).join("")
    : `<option value="">暂无可选课程</option>`;
  if (state.selectedCourseId) $("studentCourse").value = state.selectedCourseId;
  renderSlotBoard();
  renderStudentScheduleTable();
}

function renderSlotBoard() {
  const board = $("slotBoard");
  const courseId = state.selectedCourseId;
  if (!courseId) {
    board.innerHTML = `<div class="empty">暂无阶段课程</div>`;
    return;
  }
  const starts = possibleStarts(courseId);
  board.innerHTML = starts
    .map((start) => {
      const ok = canBookFixedTime(courseId, start, state.selectedDuration);
      const end = addMinutes(start, state.selectedDuration);
      return `<button class="slot-card ${ok ? "" : "disabled"}" data-book-start="${start}" ${ok ? "" : "disabled"}>
        <strong>${start}</strong>
        <span>${ok ? `${start}-${end} 可预约` : "已占用或时长不足"}</span>
      </button>`;
    })
    .join("");
}

function bookingRowsForStudent() {
  return state.bookings
    .filter((booking) => booking.student_id === state.user?.id && booking.status === "confirmed")
    .sort((a, b) => {
      const courseA = state.courses.find((course) => course.id === a.course_id)?.title || "";
      const courseB = state.courses.find((course) => course.id === b.course_id)?.title || "";
      return courseA.localeCompare(courseB, "zh-CN") || normalizeTime(a.start_time).localeCompare(normalizeTime(b.start_time));
    });
}

function renderStudentScheduleTable() {
  const bookings = bookingRowsForStudent();
  if (!bookings.length) {
    $("studentScheduleTable").innerHTML = `<div class="empty">还没有预约课程。</div>`;
    return;
  }
  $("studentScheduleTable").innerHTML = bookings.map((booking) => scheduleTableForBookings([booking], false)).join("");
}

function sortedTeacherBookings() {
  return state.bookings
    .filter((booking) => booking.status === "confirmed")
    .map((booking) => ({
      ...booking,
      student_name: booking.student_name || state.profile?.display_name || "学生",
      course: state.courses.find((course) => course.id === booking.course_id),
    }))
    .filter((booking) => booking.course?.status !== "deleted")
    .sort((a, b) => {
      const courseCompare = (a.course?.title || "").localeCompare(b.course?.title || "", "zh-CN");
      if (courseCompare) return courseCompare;
      const timeCompare = normalizeTime(a.start_time).localeCompare(normalizeTime(b.start_time));
      if (timeCompare) return timeCompare;
      return String(a.student_name).localeCompare(String(b.student_name), "zh-CN");
    });
}

function scheduleTableForBookings(bookings, teacherMode) {
  const course = state.courses.find((item) => item.id === bookings[0]?.course_id);
  const days = daysForCourse(course?.id);
  const header = `<tr>
    <th>${teacherMode ? "学生" : "课程"}</th>
    <th>固定时段</th>
    ${days.map((day) => `<th>${formatDate(day.course_date)}<br>${weekday(day.course_date)}</th>`).join("")}
    <th>操作</th>
  </tr>`;
  const rows = bookings
    .map((booking) => {
      const leave = bookingLeave(booking.id);
      return `<tr>
        <td>${teacherMode ? booking.student_name : course?.title || ""}</td>
        <td>${normalizeTime(booking.start_time)}-${normalizeTime(booking.end_time)}</td>
        ${days
          .map((day) => {
            if (day.is_rest_day) return `<td class="rest">休息</td>`;
            if (leave?.status === "approved") return `<td class="leave">请假</td>`;
            return `<td>上课</td>`;
          })
          .join("")}
        <td>${teacherMode ? "" : leaveAction(booking, leave)}</td>
      </tr>`;
    })
    .join("");
  return `<table><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

function leaveAction(booking, leave) {
  if (leave?.status === "pending") return `<span class="muted">请假待审批</span>`;
  if (leave?.status === "approved") return `<span class="muted">请假已通过</span>`;
  return `<button class="secondary-button" data-leave-booking="${booking.id}">请假</button>`;
}

function renderTeacher() {
  if (!state.user) return;
  renderInvites();
  renderCourseList();
  renderLeaveRequests();
}

function renderInvites() {
  $("inviteList").innerHTML = state.invites.length
    ? state.invites
        .map((invite) => `<div class="mini-item"><strong>${invite.student_name}</strong><span>${invite.code} · ${invite.status === "used" ? "已使用" : "未使用"}</span></div>`)
        .join("")
    : `<div class="empty">暂无邀请码</div>`;
}

function renderCourseList() {
  const courses = activeCourses();
  $("teacherCourseList").innerHTML = courses.length
    ? courses
        .map((course) => {
          const days = daysForCourse(course.id);
          return `<article class="course-card">
            <div class="course-card-head">
              <div>
                <h3>${course.title}</h3>
                <p class="muted">${course.start_date} 至 ${course.end_date} · ${course.windows.map((item) => `${item.start}-${item.end}`).join(" / ")} · 每人 ${course.booking_limit} 节</p>
              </div>
              <button class="danger-button" data-delete-course="${course.id}">删除阶段</button>
            </div>
            <div class="date-strip">
              ${days
                .map((day) => `<div class="date-chip ${day.is_rest_day ? "rest" : ""}"><strong>${formatDate(day.course_date)}</strong><span>${weekday(day.course_date)} · ${day.is_rest_day ? "休息" : "上课"}</span></div>`)
                .join("")}
            </div>
          </article>`;
        })
        .join("")
    : `<div class="empty">暂无阶段课程</div>`;
}

function renderLeaveRequests() {
  const requests = state.leaveRequests.filter((request) => request.status === "pending");
  $("leaveRequestList").innerHTML = requests.length
    ? requests
        .map((request) => {
          const course = state.courses.find((item) => item.id === request.course_id);
          const booking = state.bookings.find((item) => item.id === request.booking_id);
          return `<article class="request-card">
            <div class="request-card-head">
              <div>
                <strong>${request.student_name || "学生"} · ${course?.title || ""}</strong>
                <p class="muted">${normalizeTime(booking?.start_time)}-${normalizeTime(booking?.end_time)} · ${request.reason || "未填写原因"}</p>
              </div>
              <div class="top-actions">
                <button class="secondary-button" data-review-leave="${request.id}" data-review-status="rejected">驳回</button>
                <button class="primary-button" data-review-leave="${request.id}" data-review-status="approved">批准</button>
              </div>
            </div>
          </article>`;
        })
        .join("")
    : `<div class="empty">暂无待审批请假</div>`;
}

function renderSchedule() {
  const teacherMode = state.profile?.role === "teacher";
  $("scheduleTitle").textContent = teacherMode ? "学生总课表" : "我的完整课表";
  const bookings = teacherMode ? sortedTeacherBookings() : bookingRowsForStudent();
  if (!bookings.length) {
    $("masterScheduleTable").innerHTML = `<div class="empty">暂无课表数据</div>`;
    return;
  }
  const grouped = new Map();
  bookings.forEach((booking) => {
    const key = teacherMode ? `${booking.course_id}_${normalizeTime(booking.start_time)}` : booking.course_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(booking);
  });
  $("masterScheduleTable").innerHTML = [...grouped.values()]
    .map((items) => {
      const course = state.courses.find((item) => item.id === items[0].course_id);
      return `<h3>${course?.title || "课程"} · ${normalizeTime(items[0].start_time)}-${normalizeTime(items[0].end_time)}</h3>${scheduleTableForBookings(items, teacherMode)}`;
    })
    .join("");
}

function csvForCurrentSchedule(teacherMode) {
  const bookings = teacherMode ? sortedTeacherBookings() : bookingRowsForStudent();
  const rows = [["课程", "学生", "固定时段", "日期", "状态"]];
  bookings.forEach((booking) => {
    const course = state.courses.find((item) => item.id === booking.course_id);
    const leave = bookingLeave(booking.id);
    daysForCourse(booking.course_id).forEach((day) => {
      rows.push([
        course?.title || "",
        teacherMode ? booking.student_name || "" : currentStudentName(),
        `${normalizeTime(booking.start_time)}-${normalizeTime(booking.end_time)}`,
        day.course_date,
        day.is_rest_day ? "休息" : leave?.status === "approved" ? "请假" : "上课",
      ]);
    });
  });
  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}

async function copySchedule(teacherMode) {
  await navigator.clipboard.writeText(csvForCurrentSchedule(teacherMode));
  toast("课表 CSV 已复制");
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.view) setView(target.dataset.view);
    if (target.dataset.bookStart) bookCourse(target.dataset.bookStart);
    if (target.dataset.deleteCourse) deleteCourse(target.dataset.deleteCourse);
    if (target.dataset.leaveBooking) requestLeave(target.dataset.leaveBooking);
    if (target.dataset.reviewLeave) reviewLeave(target.dataset.reviewLeave, target.dataset.reviewStatus);
  });

  $("sendOtpButton").addEventListener("click", signInWithEmail);
  $("signOutButton").addEventListener("click", signOut);
  $("demoStudentButton").addEventListener("click", () => demoLogin("student"));
  $("demoTeacherButton").addEventListener("click", () => demoLogin("teacher"));
  $("bindInviteButton").addEventListener("click", bindInvite);
  $("createCourseButton").addEventListener("click", createCourse);
  $("createInviteButton").addEventListener("click", createInvite);
  $("copyStudentTable").addEventListener("click", () => copySchedule(false));
  $("copyMasterTable").addEventListener("click", () => copySchedule(state.profile?.role === "teacher"));
  $("studentCourse").addEventListener("change", (event) => {
    state.selectedCourseId = event.target.value;
    renderSlotBoard();
  });
  $("lessonDuration").addEventListener("change", (event) => {
    state.selectedDuration = Number(event.target.value);
    renderSlotBoard();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  try {
    await initSupabase();
  } catch (error) {
    console.error(error);
    state.backend = "demo";
    applyData(loadDemoState());
    toast("Supabase 初始化失败，已切换本地演示");
  }
  render();
});

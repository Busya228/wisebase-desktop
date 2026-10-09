// WiseBase CRM: Edge Function «crm-push» — фоновые push-напоминания о задачах.
// Запускается по расписанию (pg_cron, см. push_schema.sql) или вручную.
// Секреты (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
//
// Логика повторяет то, что приложение уже делает на клиенте (checkOverdueAndNotify /
// checkUpcomingReminders в index.html), но со стороны сервера — чтобы уведомления
// приходили, даже когда вкладка/приложение закрыты.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

function pluralRu(n: number, one: string, few: string, many: string) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

// «Сегодня» и «часы:минуты» В ЧАСОВОМ ПОЯСЕ ПОЛЬЗОВАТЕЛЯ, а не сервера. Deno на
// сервере всегда работает в UTC — без этого «сегодня» считалось бы по Гринвичу:
// для Екатеринбурга (UTC+5) задачи «на сегодня» до 05:00 утра выглядели бы
// вчерашними/просроченными, а напоминание «через 15 минут» срабатывало бы со
// сдвигом на 5 часов. Часовой пояс берём из profiles.timezone (см. миграцию).
function localParts(date: Date, tz: string) {
  const dateStr = date.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const timeStr = date.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }); // HH:MM
  return { dateStr, timeStr };
}
function minutesSinceMidnight(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}
const DEFAULT_TZ = "Asia/Yekaterinburg";

Deno.serve(async (_req) => {
  /* Режимы:
       reminders (по умолчанию) — обычный запуск по расписанию: считает
         просроченные задачи и задачи, у которых через 5-15 минут наступает
         указанное время, и шлёт push тем, у кого такие задачи есть.
       test — немедленно шлёт тестовое уведомление, чтобы проверить цепочку
         «функция → браузер/телефон» не дожидаясь события. Требует user_id —
         иначе тест ушёл бы всем подпискам в базе, а не только вызывающему. */
  let kind = "reminders";
  let testUserId: string | null = null;
  try {
    const b = await _req.json();
    if (b && b.kind) kind = String(b.kind);
    if (b && b.user_id) testUserId = String(b.user_id);
  } catch (_e) { /* тело пустое — обычный вызов по расписанию */ }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Ключи VAPID из Secrets. Чистим пробелы/невидимые символы — частая причина
  // «Vapid public key must be a URL safe Base 64», когда значение вставлено в форму.
  const envKey = (n: string) => (Deno.env.get(n) || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
  const pub = envKey("VAPID_PUBLIC_KEY");
  const priv = envKey("VAPID_PRIVATE_KEY");
  const subj = (Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com").trim();
  const b64url = /^[A-Za-z0-9_-]+$/;
  const problems: string[] = [];
  if (!pub) problems.push("VAPID_PUBLIC_KEY не задан");
  else if (!b64url.test(pub)) problems.push("VAPID_PUBLIC_KEY содержит недопустимые символы");
  if (!priv) problems.push("VAPID_PRIVATE_KEY не задан");
  else if (!b64url.test(priv)) problems.push("VAPID_PRIVATE_KEY содержит недопустимые символы");
  if (!/^mailto:/.test(subj)) problems.push("VAPID_SUBJECT должен начинаться с mailto:");
  if (problems.length) {
    return new Response(JSON.stringify({
      error: "Проблема с ключами VAPID в Edge Functions → Secrets",
      problems,
      publicKeyLength: pub.length,
      publicKeyStart: pub.slice(0, 12),
    }, null, 1), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  webpush.setVapidDetails(subj, pub, priv);

  if (kind === "test" && !testUserId) {
    return new Response(JSON.stringify({
      error: 'Для kind="test" нужен user_id — без него тест ушёл бы всем подпискам в базе разом',
    }, null, 1), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let subsQuery = supa.from("push_subscriptions").select("*");
  if (testUserId) subsQuery = subsQuery.eq("user_id", testUserId);
  const { data: subs, error } = await subsQuery;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const send = async (row: any, title: string, body: string, tag: string) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({ title, body, tag }),
      );
      return true;
    } catch (e) {
      const code = e && typeof e === "object" && "statusCode" in e ? (e as { statusCode: number }).statusCode : 0;
      if (code === 404 || code === 410) await supa.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
      return false;
    }
  };

  let sent = 0, removed = 0, empty = 0;

  if (kind === "test") {
    const details: unknown[] = [];
    for (const row of subs || []) {
      const ok = await send(row, "WiseBase CRM", "Уведомления работают ✓", "crm-test");
      if (ok) sent++; else removed++;
      details.push({ host: new URL(row.endpoint).host, ok });
    }
    return new Response(JSON.stringify({ kind, user_id: testUserId, subscriptions: (subs || []).length, sent, removed, details }, null, 1), { headers: { "Content-Type": "application/json" } });
  }

  // Группируем ПОДПИСКИ по user_id — раньше на каждую подписку (устройство: телефон,
  // ноутбук, переустановленный браузер) отдельно ходили в tasks и заново пересчитывали
  // просроченные/скорые задачи, хотя у одного пользователя результат один и тот же.
  // При росте базы это упёрлось бы в таймаут (N+1 запросов).
  const byUser = new Map<string, any[]>();
  for (const row of subs || []) {
    if (!row.user_id) { empty++; continue; }
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id)!.push(row);
  }
  const userIds = [...byUser.keys()];
  if (!userIds.length) {
    return new Response(JSON.stringify({ kind, subscriptions: (subs || []).length, sent, removed, empty }, null, 1), { headers: { "Content-Type": "application/json" } });
  }

  // Один запрос на всех пользователей сразу вместо одного на каждую подписку.
  // ВАЖНО: колонка называется owner_id, а не user_id (в исходнике была опечатка —
  // из-за неё запрос никогда не находил ни одной задачи ни у кого).
  const [{ data: allTasks }, { data: profiles }] = await Promise.all([
    supa.from("tasks").select("*").is("deleted_at", null).eq("done", false).in("owner_id", userIds),
    supa.from("profiles").select("id,timezone").in("id", userIds),
  ]);
  const tzByUser = new Map<string, string>();
  for (const p of profiles || []) tzByUser.set(p.id, p.timezone || DEFAULT_TZ);
  const tasksByUser = new Map<string, any[]>();
  for (const t of allTasks || []) {
    const uid = t.owner_id;
    if (!tasksByUser.has(uid)) tasksByUser.set(uid, []);
    tasksByUser.get(uid)!.push(t);
  }

  const now = new Date();

  for (const [userId, rows] of byUser) {
    const tz = tzByUser.get(userId) || DEFAULT_TZ;
    const { dateStr: todayStr, timeStr: nowHM } = localParts(now, tz);
    const nowMin = minutesSinceMidnight(nowHM);

    const list = tasksByUser.get(userId) || [];
    const overdue = list.filter((t: any) => t.date && t.date < todayStr);
    const soon = list.filter((t: any) => {
      if (t.date !== todayStr || !t.time) return false;
      const diff = minutesSinceMidnight(String(t.time)) - nowMin;
      return diff > 0 && diff <= 15;
    });

    if (!overdue.length && !soon.length) { empty++; continue; }

    // Отправка — на каждую подписку ЭТОГО пользователя (несколько устройств
    // должны получить уведомление каждое, это не дубликат, а норма push-уведомлений).
    for (const row of rows) {
      if (overdue.length) {
        const ok = await send(
          row,
          "Просроченные задачи",
          `У вас ${overdue.length} ${pluralRu(overdue.length, "просроченная задача", "просроченные задачи", "просроченных задач")}`,
          "crm-overdue",
        );
        if (ok) sent++; else removed++;
      }
      for (const t of soon) {
        const ok2 = await send(row, `Скоро: ${t.text || "Задача"}`, `В ${t.time}`, "crm-reminder-" + t.id);
        if (ok2) sent++; else removed++;
      }
    }
  }

  return new Response(JSON.stringify({ kind, subscriptions: (subs || []).length, users: userIds.length, sent, removed, empty }, null, 1), { headers: { "Content-Type": "application/json" } });
});

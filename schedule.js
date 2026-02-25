import fetch from "node-fetch";
import { DateTime } from "luxon";
import fs from "fs";

const APP_ID = process.env.ONESIGNAL_APP_ID;
const REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const SITE_URL = process.env.SITE_URL || "";
const TZ = process.env.TZ || "America/Campo_Grande";

if (!APP_ID || !REST_API_KEY) {
  console.error("Faltam secrets: ONESIGNAL_APP_ID e/ou ONESIGNAL_REST_API_KEY.");
  process.exit(1);
}

const agenda = JSON.parse(fs.readFileSync("agenda.json", "utf8"));
const defaultsUrl = agenda?.defaults?.url || SITE_URL;

const now = DateTime.now().setZone(TZ);
const windowEnd = now.plus({ days: 7 });

const events = (agenda.events || [])
  .map(e => ({ ...e, _start: DateTime.fromISO(e.start, { setZone: true }).setZone(TZ) }))
  .filter(e => e._start.isValid && e._start > now.minus({ hours: 1 }) && e._start < windowEnd)
  .sort((a,b) => a._start.toMillis() - b._start.toMillis());

function buildExternalId(evId, minutesBefore) {
  return `agenda-ccb:${evId}:${minutesBefore}`;
}

async function createNotification({ title, message, sendAtISO, externalId }) {
  const body = {
    app_id: APP_ID,
    headings: { pt: title },
    contents: { pt: message },
    included_segments: ["Subscribed Users"],
    url: defaultsUrl,
    send_after: sendAtISO,
    external_id: externalId
  };

  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Basic ${REST_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Erro ao criar notificação:", res.status, data);
    return false;
  }
  console.log("OK:", externalId, "->", sendAtISO);
  return true;
}

const OFFSETS = [
  { hours: 4, label: "4 horas" },
  { hours: 1, label: "1 hora" }
];

for (const ev of events) {
  const evId = ev.id || `${ev._start.toISO()}|${ev.title || ""}|${ev.location || ""}`.replace(/\s+/g, "_");
  for (const off of OFFSETS) {
    const sendAt = ev._start.minus({ hours: off.hours });
    if (sendAt <= now.plus({ minutes: 1 })) continue;

    const title = "Lembrete CCB";
    const when = ev._start.toFormat("dd/LL (ccc) 'às' HH:mm");
    const place = ev.location ? ` - ${ev.location}` : "";
    const msg = `Daqui ${off.label}: ${ev.title || "Culto"}${place}. Hoje ${when}.`;

    const externalId = buildExternalId(evId, off.hours * 60);
    await createNotification({
      title,
      message: msg,
      sendAtISO: sendAt.toUTC().toISO(),
      externalId
    });
  }
}

console.log(`Finalizado. Eventos: ${events.length}. Agora: ${now.toISO()}`);

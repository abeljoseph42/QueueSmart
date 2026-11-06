// Appointment times are saved in UTC and shown in Central Time (America/Chicago).
export const TIME_ZONE = 'America/Chicago'

const labelFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatCentral(utc) {
  return labelFormat.format(new Date(utc))
}

function centralParts(date) {
  return Object.fromEntries(
    partsFormat.formatToParts(date).map(({ type, value }) => [type, value]),
  )
}

// "2026-11-05" and "10:00" in Central Time -> "2026-11-05T16:00:00.000Z".
export function centralToUtc(date, time) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let guess = wall
  // Two passes settle the Central offset, including on daylight-saving change days.
  for (let i = 0; i < 2; i += 1) {
    const p = centralParts(new Date(guess))
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
    guess += wall - shown
  }
  return new Date(guess).toISOString()
}

// UTC -> { date: "2026-11-05", time: "10:00" } in Central Time, for form inputs.
export function utcToCentralInputs(utc) {
  const p = centralParts(new Date(utc))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

export function todayInCentral(now = new Date()) {
  return utcToCentralInputs(now.toISOString()).date
}

const compact = utc => new Date(utc).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function googleCalendarUrl({ title, startsAt, endsAt, details }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${compact(startsAt)}/${compact(endsAt)}`,
    details,
    ctz: TIME_ZONE,
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

const icsText = value => value.replace(/[\\;,]/g, match => `\\${match}`).replace(/\r?\n/g, '\\n')

export function icsFile({ id, title, startsAt, endsAt, details }) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QueueSmart//Appointments//EN',
    'BEGIN:VEVENT',
    `UID:${id}@queuesmart`,
    `DTSTAMP:${compact(new Date().toISOString())}`,
    `DTSTART:${compact(startsAt)}`,
    `DTEND:${compact(endsAt)}`,
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText(details)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

export function downloadIcs(appointment) {
  const blob = new Blob([icsFile(appointment)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'queuesmart-appointment.ics'
  link.click()
  URL.revokeObjectURL(url)
}

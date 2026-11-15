const chicago = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function chicagoDate(now: Date = new Date()): string {
  return chicago.format(now)
}

export { chicagoDate }

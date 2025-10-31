const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function getMonthIdentifier(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function createMonthOptions({ monthsBefore = 0, monthsAfter = 3 } = {}) {
  const today = new Date();
  today.setDate(1);

  const options = [];
  for (let offset = -monthsBefore; offset <= monthsAfter; offset += 1) {
    const optionDate = new Date(today);
    optionDate.setMonth(today.getMonth() + offset);
    const label = `${optionDate.getFullYear()}年${optionDate.getMonth() + 1}月`;
    options.push({
      value: getMonthIdentifier(optionDate),
      label,
      isCurrent: offset === 0,
    });
  }
  return options;
}

export function enumerateMonthDays(monthId) {
  const [year, month] = monthId.split("-").map((token) => parseInt(token, 10));
  if (!year || !month) {
    throw new Error(`無効な月指定です: ${monthId}`);
  }
  const start = new Date(year, month - 1, 1);
  const cursor = new Date(start);

  const days = [];
  while (cursor.getMonth() === start.getMonth()) {
    const iso = cursor.toISOString().slice(0, 10);
    const label = `${cursor.getMonth() + 1}/${String(cursor.getDate()).padStart(2, "0")}`;
    const weekdayLabel = `(${WEEKDAY_LABELS[cursor.getDay()]})`;
    days.push({
      date: new Date(cursor),
      iso,
      label,
      weekdayLabel,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

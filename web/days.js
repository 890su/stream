// Day pills of the feed: «Сегодня», «Вчера», «16 ноября». Pure.
const dayFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const dayFormatYear = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' });

export function dayKey(date) { return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }

export function dayLabel(date, today = new Date()) {
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return 'Сегодня';
  if (dayKey(date) === dayKey(yesterday)) return 'Вчера';
  return (date.getFullYear() === today.getFullYear() ? dayFormat : dayFormatYear).format(date);
}

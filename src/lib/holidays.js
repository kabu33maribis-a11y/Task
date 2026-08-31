// Japanese national holidays ('YYYY-MM-DD' -> name)

function pad(n) {
  return String(n).padStart(2, '0')
}

function ds(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function dowOf(y, m, d) {
  return new Date(y, m - 1, d).getDay() // 0=Sun, 1=Mon ... 6=Sat
}

// n-th occurrence of weekday (0=Sun..6=Sat) in month
function nthDow(y, m, n, dow) {
  const firstDow = new Date(y, m - 1, 1).getDay()
  let day = 1 + ((dow - firstDow + 7) % 7)
  day += (n - 1) * 7
  return day
}

function springEquinox(y) {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}

function autumnEquinox(y) {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}

export function getJapaneseHolidays(year) {
  const map = new Map()
  const add = (m, d, name) => { if (d >= 1 && d <= 31) map.set(ds(year, m, d), name) }

  add(1, 1, '元日')
  add(2, 11, '建国記念の日')
  add(2, 23, '天皇誕生日')
  add(3, springEquinox(year), '春分の日')
  add(4, 29, '昭和の日')
  add(5, 3, '憲法記念日')
  add(5, 4, 'みどりの日')
  add(5, 5, 'こどもの日')
  add(8, 11, '山の日')
  add(9, autumnEquinox(year), '秋分の日')
  add(11, 3, '文化の日')
  add(11, 23, '勤労感謝の日')

  // ハッピーマンデー
  add(1, nthDow(year, 1, 2, 1), '成人の日')       // Jan 第2月曜
  add(7, nthDow(year, 7, 3, 1), '海の日')         // Jul 第3月曜
  add(9, nthDow(year, 9, 3, 1), '敬老の日')       // Sep 第3月曜
  add(10, nthDow(year, 10, 2, 1), 'スポーツの日') // Oct 第2月曜

  // 国民の休日: 敬老の日と秋分の日の間に挟まれた平日
  const equinox = autumnEquinox(year)
  const kouro = nthDow(year, 9, 3, 1)
  if (equinox - kouro === 2) {
    add(9, kouro + 1, '国民の休日')
  }

  // 振替休日: 日曜に当たった祝日の翌平日
  const entries = [...map.keys()].sort()
  const subs = []
  for (const key of entries) {
    const [y, mo, dy] = key.split('-').map(Number)
    if (dowOf(y, mo, dy) === 0) {
      let next = new Date(y, mo - 1, dy + 1)
      const inMap = (d) => map.has(d) || subs.includes(d)
      while (inMap(ds(next.getFullYear(), next.getMonth() + 1, next.getDate()))) {
        next.setDate(next.getDate() + 1)
      }
      subs.push(ds(next.getFullYear(), next.getMonth() + 1, next.getDate()))
      map.set(ds(next.getFullYear(), next.getMonth() + 1, next.getDate()), '振替休日')
    }
  }

  return map
}

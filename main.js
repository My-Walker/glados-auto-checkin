'use strict'

/**
 * GLaDOS 智能高分签到
 * - 轮询 IQI，按 Cable 加成决策是否签到
 * - PushPlus 每次推送检测/签到结果
 * - AUTO_EXCHANGE 默认关闭；为 true 且积分达标才兑换 plan500
 */

const DEFAULT_DOMAIN = 'glados.cloud'
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const SOFT_HOUR = 22
const DEADLINE_HOUR = 23
const DEADLINE_MINUTE = 30
const TZ = 'Asia/Shanghai'

const mask = (str, startLen = 4, endLen = 4) => {
  if (!str || typeof str !== 'string') return '***'
  if (str.length <= startLen + endLen) return '*'.repeat(Math.min(str.length, 8))
  return str.slice(0, startLen) + '****' + str.slice(-endLen)
}

/** Cable 加成：与前端 C(e) 一致 */
function getCableBonus(score) {
  if (score == null || Number.isNaN(Number(score)) || Number(score) <= 0) return 0
  const s = Number(score)
  if (s < 80) return 8
  if (s < 85) return 5
  if (s < 90) return 3
  if (s <= 95) return 2
  return 1
}

function getBeijingParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hours: Number(parts.hour),
    minutes: Number(parts.minute),
    seconds: Number(parts.second),
    label: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  }
}

function minutesOfDay(hours, minutes) {
  return hours * 60 + minutes
}

/**
 * 策略 A：
 * - bonus >= 5 → 高分签到
 * - 北京 >= 22:00 且 bonus >= 3 → 软保底
 * - 北京 >= 23:30 → 硬保底
 */
function decideCheckin(bonus, bj) {
  const nowMin = minutesOfDay(bj.hours, bj.minutes)
  const softMin = minutesOfDay(SOFT_HOUR, 0)
  const hardMin = minutesOfDay(DEADLINE_HOUR, DEADLINE_MINUTE)

  if (nowMin >= hardMin) {
    return { shouldCheckin: true, reason: '硬保底签到' }
  }
  if (bonus >= 5) {
    return { shouldCheckin: true, reason: '高分签到' }
  }
  if (nowMin >= softMin && bonus >= 3) {
    return { shouldCheckin: true, reason: '软保底签到' }
  }
  return { shouldCheckin: false, reason: '观望' }
}

function parseEnvBoolTrue(value) {
  return String(value || '').trim().toLowerCase() === 'true'
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function apiFetch(url, { method = 'GET', headers, body } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const detail = json?.message || text.slice(0, 200) || res.statusText
    throw new Error(`HTTP ${res.status} ${detail}`)
  }
  return json
}

function commonHeaders(cookie, ua, domain) {
  return {
    cookie,
    'user-agent': ua,
    referer: `https://${domain}/console/checkin`,
    origin: `https://${domain}`,
    accept: 'application/json, text/plain, */*',
  }
}

async function fetchIqi(base, headers) {
  const data = await apiFetch(`${base}/user/iqi`, { headers })
  if (data?.code !== 0) {
    throw new Error(`IQI 失败: ${data?.message || '未知错误'} (code=${data?.code})`)
  }
  const score = data?.data?.quality?.score
  return score == null ? null : Number(score)
}

async function doCheckin(base, headers, domain) {
  const data = await apiFetch(`${base}/user/checkin`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: { token: domain },
  })
  const code = data?.code
  const already = code === 1
  if (code !== 0 && !already) {
    const reason = data?.reason ? `, reason=${data.reason}` : ''
    throw new Error(`${data?.message || '签到失败'} (code=${code}${reason})`)
  }
  return {
    code,
    already,
    message: data?.message || (already ? '今日已签到' : '签到成功'),
  }
}

async function fetchStatus(base, headers) {
  const data = await apiFetch(`${base}/user/status`, { headers })
  if (data?.code !== 0) {
    throw new Error(`状态异常: ${data?.message || '未知错误'} (code=${data?.code})`)
  }
  const leftDays = data?.data?.leftDays
  const n = Number(leftDays)
  return Number.isFinite(n) ? n : leftDays
}

async function fetchPoints(base, headers) {
  const data = await apiFetch(`${base}/user/points`, { headers })
  if (data?.code !== 0) {
    throw new Error(`积分失败: ${data?.message || '未知错误'} (code=${data?.code})`)
  }
  const raw = data?.points ?? data?.data?.points
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function doExchange(base, headers) {
  const data = await apiFetch(`${base}/user/exchange`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: { planType: 'plan500' },
  })
  if (data?.code !== 0) {
    throw new Error(`${data?.message || '兑换失败'} (code=${data?.code})`)
  }
  const remain = Number(data?.points)
  return {
    message: data?.message || '兑换成功（500 积分 → 100 天）',
    remain: Number.isFinite(remain) ? remain : null,
  }
}

async function notifyPushPlus(token, title, lines) {
  const res = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      title,
      content: lines.join('\n'),
      template: 'txt',
    }),
  })
  const result = await res.json()
  if (result.code !== 200) {
    throw new Error(`${result.msg || '推送失败'} (code=${result.code})`)
  }
}

/** 解析 NOTIFY：支持 pushplus:token / 纯 token / 多行多渠道（本期实现 PushPlus） */
async function sendNotices(noticeBlocks) {
  const raw = process.env.NOTIFY
  if (!raw || !String(raw).trim()) {
    console.log('未配置 NOTIFY，跳过推送')
    return
  }
  if (!noticeBlocks.length) {
    console.log('无通知内容，跳过推送')
    return
  }

  const options = splitLines(raw)
  for (const [idx, option] of options.entries()) {
    const no = idx + 1
    try {
      if (option.startsWith('console:')) {
        console.log(`\n[通知 ${no}] 控制台输出`)
        noticeBlocks.forEach((block) => console.log(block.join('\n')))
        continue
      }

      let token = option
      if (option.startsWith('pushplus:')) {
        token = option.slice('pushplus:'.length)
      } else if (option.includes(':') && !option.startsWith('pushplus:')) {
        console.warn(`[通知 ${no}] 未实现的渠道前缀，已跳过: ${option.split(':')[0]}`)
        continue
      }

      const flat = noticeBlocks.flatMap((b, i) => (i === 0 ? b : ['', ...b]))
      const title = flat[0] || 'GLaDOS 签到'
      console.log(`[通知 ${no}] PushPlus token=${mask(token)}`)
      await notifyPushPlus(token, title, flat)
      console.log(`[通知 ${no}] PushPlus 推送成功`)
    } catch (err) {
      console.error(`[通知 ${no}] 推送失败: ${err.message}`)
    }
  }
}

function formatDays(leftDays) {
  if (leftDays == null || leftDays === '') return '未知'
  const n = Number(leftDays)
  return Number.isFinite(n) ? `${n.toFixed(2)} 天` : `${leftDays} 天`
}

function formatPoints(points) {
  if (points == null) return '查询失败'
  return `${Number(points).toFixed(2)} 点`
}

async function processAccount(accountNo, cookie, ua, domain, autoExchange, exchangeThreshold, bj) {
  const base = `https://${domain}/api`
  const headers = commonHeaders(cookie, ua, domain)
  const lines = []
  let failed = false

  console.log(`\n[账号 ${accountNo}] ---------- 开始 ----------`)
  console.log(`[账号 ${accountNo}] Cookie: ${mask(cookie)}`)
  console.log(`[账号 ${accountNo}] UA: ${mask(ua, 8, 8)}`)
  console.log(`[账号 ${accountNo}] 域名: ${domain}`)

  let score = null
  let bonus = 0
  let decisionLabel = '未知'
  let checkinMessage = ''
  let leftDays = null
  let currentPoints = null
  let exchangeNote = ''

  try {
    score = await fetchIqi(base, headers)
    bonus = getCableBonus(score)
    const decision = decideCheckin(bonus, bj)
    decisionLabel = decision.reason

    console.log(
      `[账号 ${accountNo}] 北京 ${bj.label} | score=${score} | bonus=+${bonus} | 决策=${decision.reason}`
    )

    if (decision.shouldCheckin) {
      const action = await doCheckin(base, headers, domain)
      checkinMessage = action.message
      if (action.already) {
        decisionLabel = `${decision.reason}（今日已签）`
      }
      console.log(`[账号 ${accountNo}] 签到: code=${action.code} | ${action.message}`)
    } else {
      checkinMessage = '未签到'
      console.log(`[账号 ${accountNo}] 条件未满足，观望中`)
    }

    try {
      leftDays = await fetchStatus(base, headers)
      console.log(`[账号 ${accountNo}] 剩余天数: ${formatDays(leftDays)}`)
    } catch (e) {
      console.warn(`[账号 ${accountNo}] 状态查询失败: ${e.message}`)
    }

    try {
      currentPoints = await fetchPoints(base, headers)
      console.log(`[账号 ${accountNo}] 当前积分: ${formatPoints(currentPoints)}`)
    } catch (e) {
      console.warn(`[账号 ${accountNo}] 积分查询失败: ${e.message}`)
    }

    if (autoExchange) {
      if (currentPoints != null && currentPoints >= exchangeThreshold) {
        try {
          console.log(
            `[账号 ${accountNo}] 积分 ${currentPoints} ≥ ${exchangeThreshold}，执行自动兑换...`
          )
          const ex = await doExchange(base, headers)
          exchangeNote = `${ex.message}${ex.remain != null ? `；剩余积分 ${ex.remain}` : ''}`
          console.log(`[账号 ${accountNo}] ${exchangeNote}`)
          if (ex.remain != null) currentPoints = ex.remain
          try {
            leftDays = await fetchStatus(base, headers)
          } catch {
            /* ignore */
          }
        } catch (e) {
          exchangeNote = `兑换失败: ${e.message}`
          console.error(`[账号 ${accountNo}] ${exchangeNote}`)
        }
      } else {
        exchangeNote = `未达兑换阈值（${formatPoints(currentPoints)} < ${exchangeThreshold}）`
        console.log(`[账号 ${accountNo}] ${exchangeNote}`)
      }
    } else {
      exchangeNote = '兑换已跳过（AUTO_EXCHANGE 未开启）'
      console.log(`[账号 ${accountNo}] ${exchangeNote}`)
    }

    lines.push(
      `【账号${accountNo}】${decisionLabel}`,
      `北京时间: ${bj.label}`,
      `IQI score: ${score ?? '无'} | Cable: +${bonus}`,
      `签到: ${checkinMessage || '-'}`,
      `剩余天数: ${formatDays(leftDays)}`,
      `当前积分: ${formatPoints(currentPoints)}`,
      `兑换: ${exchangeNote}`
    )
  } catch (err) {
    failed = true
    console.error(`[账号 ${accountNo}] 失败: ${err.message}`)
    lines.push(
      `【账号${accountNo}】失败`,
      `北京时间: ${bj.label}`,
      `IQI score: ${score ?? '无'} | Cable: +${bonus}`,
      `决策: ${decisionLabel}`,
      `错误: ${err.message}`,
      `剩余天数: ${formatDays(leftDays)}`,
      `当前积分: ${formatPoints(currentPoints)}`
    )
  }

  return { failed, lines }
}

async function main() {
  console.log('========== GLaDOS 智能高分签到开始 ==========')
  const bj = getBeijingParts()
  console.log(`北京时间: ${bj.label}`)

  const cookies = splitLines(process.env.GLADOS)
  if (!cookies.length) {
    console.error('未设置 GLADOS（Cookie），退出')
    const failLines = [
      ['【配置错误】缺少 GLADOS Cookie', `北京时间: ${bj.label}`, '请在仓库 Secrets 中配置 GLADOS'],
    ]
    await sendNotices(failLines)
    process.exit(1)
  }

  const agents = splitLines(process.env.GLADOS_UA)
  const domain = String(process.env.DOMAIN || DEFAULT_DOMAIN).trim() || DEFAULT_DOMAIN
  const autoExchange = parseEnvBoolTrue(process.env.AUTO_EXCHANGE)
  const exchangeThreshold = Number(process.env.EXCHANGE_THRESHOLD || 500)

  console.log(`账号数: ${cookies.length}`)
  console.log(`DOMAIN: ${domain}`)
  console.log(`AUTO_EXCHANGE: ${autoExchange} | THRESHOLD: ${exchangeThreshold}`)
  console.log(`NOTIFY: ${process.env.NOTIFY ? '已配置' : '未配置'}`)

  const noticeBlocks = []
  let hasRealError = false

  for (const [index, cookie] of cookies.entries()) {
    const accountNo = index + 1
    const ua = agents[index] || agents[0] || DEFAULT_UA
    const { failed, lines } = await processAccount(
      accountNo,
      cookie,
      ua,
      domain,
      autoExchange,
      exchangeThreshold,
      bj
    )
    noticeBlocks.push(lines)
    if (failed) hasRealError = true
  }

  await sendNotices(noticeBlocks)

  console.log('\n========== 任务结束 ==========')
  if (hasRealError) {
    console.log('存在失败账号 → exit 1')
    process.exit(1)
  }
  console.log('全部账号处理完成 → exit 0')
  process.exit(0)
}

main().catch((err) => {
  console.error('未捕获错误:', err)
  process.exit(1)
})

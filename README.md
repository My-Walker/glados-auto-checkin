# GLaDOS 智能高分签到

使用 GitHub Actions 定时轮询 IQI（海底电缆质量指数），在高分窗口签到；接近日切未签则保底签到。每次检测/签到结果通过 **PushPlus** 推送到个人微信。

参考：[integration-intelligent/checkin](https://github.com/integration-intelligent/checkin)、[Zirui8/glados_checkin](https://github.com/Zirui8/glados_checkin)。

## 功能概览

- 每 **30 分钟** 跑一次（另有约北京 **23:45** 保底补跑）
- 策略：常规 Cable `bonus ≥ 5` 才签；北京 **22:00** 后可 `≥ 3`；**23:30** 起强制签
- 推送：每次含北京时间、score、bonus、决策、签到结果、**剩余天数**、**当前积分**
- 自动兑换：代码已支持 `500 积分 → 100 天`，**默认关闭**
- **不会**在未开开关时调用兑换接口

本地设计稿 / 接口抓包请放在 `design-assets/`（已加入 `.gitignore`，勿提交到公共仓）。

## 使用步骤

### 1. Fork / 启用 Actions

1. Fork 或推送本仓库到 GitHub  
2. 打开 **Actions**，启用工作流  
3. 在默认分支保留 `.github/workflows/checkin.yml`

### 2. 配置 Secrets

路径：**Settings → Secrets and variables → Actions**

| Name | 必填 | 说明 |
|------|------|------|
| `GLADOS` | 是 | Cookie，多账号换行；建议含 `gld:sess` / `gld:sess.sig` / `koa:sess` / `koa:sess.sig` |
| `GLADOS_UA` | 强烈建议 | 与登录浏览器一致的 UA（控制台执行 `navigator.userAgent`）；多账号可多行对应，一行则共用 |
| `NOTIFY` | 建议 | PushPlus：`pushplus:你的token`；也可只填 token |
| `DOMAIN` | 否 | 默认 `glados.cloud`；仅填主机名，如 `railgun.info` |
| `AUTO_EXCHANGE` | 否 | 默认关闭；设为 `true` 才自动兑换 |
| `EXCHANGE_THRESHOLD` | 否 | 默认 `500` |

#### 获取 Cookie

1. 浏览器登录 GLaDOS（与 `DOMAIN` 同一站点）  
2. F12 → 应用/存储 或 Network 里复制完整 Cookie  
3. UA 变更或重新登录后，请同时更新 `GLADOS` 与 `GLADOS_UA`

#### PushPlus

1. 打开 [PushPlus](https://www.pushplus.plus/)，个人微信扫码绑定  
2. 复制 token，Secret `NOTIFY` 填：`pushplus:你的token`

### 3. 手动跑一次

Actions → **GLaDOS Smart Checkin** → **Run workflow**。成功后应收到微信推送。

## 签到策略（北京时间）

| 条件 | 行为 |
|------|------|
| Cable 加成 `≥ 5`（score &lt; 85） | 高分签到 |
| `≥ 22:00` 且加成 `≥ 3` | 软保底签到 |
| `≥ 23:30` 且本轮仍需签 | 硬保底签到 |
| 其它 | 观望（仍查积分/天数并推送） |

今日已签（接口 `code === 1`）视为正常，不报失败。

## 自动兑换（默认关闭）

- 实现：`POST /api/user/exchange`，`{ "planType": "plan500" }`（约 500 积分换 100 天）  
- 仅当 Secret / 环境变量 `AUTO_EXCHANGE=true`，且当前积分 `≥ EXCHANGE_THRESHOLD`（默认 500）时调用  
- 兑换失败只记入推送，**不**把签到判失败  
- 未开启时日志为「兑换已跳过」，**不会发兑换请求**

## 如何改间隔 / 对齐时间

编辑 [`.github/workflows/checkin.yml`](.github/workflows/checkin.yml) 中的 `cron`（GitHub 默认按 **UTC**）：

```yaml
schedule:
  - cron: '*/30 * * * *'   # 每 30 分钟，对齐 :00/:30
  - cron: '45 15 * * *'    # 约北京 23:45 补跑
```

示例：

- 每小时整点：`0 * * * *`
- 每小时 :10 与 :40：`10,40 * * * *`

软保底 22:00 / 硬死线 23:30 在 [`main.js`](main.js) 顶部常量（`SOFT_HOUR` / `DEADLINE_*`），与 cron 无关。

改 cron 后需推到**默认分支**；立刻验证用手动 Run workflow。

## 本地运行

```bash
export GLADOS='koa:sess=...; ...'
export GLADOS_UA='Mozilla/5.0 ...'
export NOTIFY='pushplus:你的token'
# export DOMAIN='glados.cloud'
# export AUTO_EXCHANGE='false'
node main.js
```

需要 Node.js ≥ 18（Actions 使用 20）。无第三方 npm 依赖。

## 退出码

- `0`：本轮处理完成（含观望、已签、签到成功）  
- `1`：缺少 Cookie，或存在账号鉴权/签到等失败  

推送失败不会单独导致 `exit 1`。

# GLaDOS 智能高分签到

使用 GitHub Actions 定时轮询 IQI（海底电缆质量指数），在高分窗口签到；接近日切未签则保底签到。每次检测/签到结果通过 **PushPlus** 推送到个人微信。

参考：[integration-intelligent/checkin](https://github.com/integration-intelligent/checkin)、[Zirui8/glados_checkin](https://github.com/Zirui8/glados_checkin)。

## 功能概览

- 每 **30 分钟** 跑一次（另有约北京 **23:45** 保底补跑）
- 策略：白天优先等 Cable `bonus ≥ 8`；北京 **20:00** 后可收 `≥ 5`；**22:00** 后可 `≥ 3`；**23:30** 起强制签
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

路径：**Settings → Secrets and variables → Actions** → **New repository secret**

| Name | 必填 | 说明 |
|------|------|------|
| `GLADOS_COOKIE` | 是 | GLaDOS 登录 Cookie（多账号换行）。建议含 `gld:sess` / `gld:sess.sig` / `koa:sess` / `koa:sess.sig` |
| `GLADOS_UA` | 强烈建议 | 与登录浏览器一致的 User-Agent 字符串；**不要带引号** |
| `NOTIFY` | 建议 | PushPlus：`pushplus:` + **用户 token 或消息 token**（见下方说明）；**不要用 SecretKey** |
| `DOMAIN` | 否 | 默认 `glados.cloud`；仅填主机名，如 `railgun.info` |
| `AUTO_EXCHANGE` | 否 | 默认关闭；设为 `true` 才自动兑换 |
| `EXCHANGE_THRESHOLD` | 否 | 默认 `500` |

#### 获取 Cookie（`GLADOS_COOKIE`）— 推荐 Network / Request Headers

1. 浏览器登录 GLaDOS（与 `DOMAIN` 同一站点），打开签到页  
2. 按 **F12** → **Network（网络）**  
3. 刷新页面，或点开任意一条对当前站点的请求（如 `status`、`iqi`、`checkin`）  
4. 右侧 **Headers（标头）** → 找到 **Request Headers（请求标头）**  
5. 找到 **`cookie:`**（或 `Cookie:`）那一整行，**复制冒号后面的全部内容**（不要包含 `cookie:` 这几个字本身）  
6. 粘贴到记事本检查：应类似  
   `koa:sess=...; koa:sess.sig=...; gld:sess=...; gld:sess.sig=...`  
7. GitHub Secret **Name** 填 `GLADOS_COOKIE`，**Secret** 填上面整段（**不要加引号**）

也可在 F12 → **Application（应用）→ Cookies** 里分别复制四个字段再拼成一行。  
重新登录或 Cookie 失效后，请同时更新 `GLADOS_COOKIE` 与 `GLADOS_UA`。

#### 获取 UA（`GLADOS_UA`）

1. 在**同一登录浏览器**打开 GLaDOS 页面，F12 → **Console（控制台）**  
2. 输入并回车：`navigator.userAgent`  
3. 控制台可能显示带引号的字符串，例如 `"Mozilla/5.0 ..."`  
4. **填 Secret 时不要带两边的引号**，只保留中间内容，例如：  
   `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...`  
5. 多账号：可多行，与 Cookie 行一一对应；只写一行则所有账号共用

#### PushPlus（`NOTIFY`）用哪个 token？

打开 [PushPlus](https://www.pushplus.plus/)，个人微信扫码登录后，控制台里常见几类凭证：

| 名称 | 是否用于本项目 | 说明 |
|------|----------------|------|
| **用户 token** | **要用（推荐）** | 账号唯一的发送凭证；一对一推给你自己最省事 |
| **消息 token** | **可以用** | 可自行创建多个，适合按脚本隔离；同样填到 `token` 参数即可 |
| **SecretKey** | **不要用** | 仅用于 PushPlus「开放接口」换 AccessKey，**不能**当作本仓库 `NOTIFY` 里的推送 token |

本仓库调用的是 PushPlus [发送消息接口](https://www.pushplus.plus/doc/guide/api.html) 的 `token` 字段，官方说明为：**用户 token 或消息 token**。

Secret `NOTIFY` 填写示例（`pushplus:` 后接 token，**不要引号**）：

```text
pushplus:xxxxxxxxxxxxxxxx
```

也可只填 token 本身（不写 `pushplus:` 前缀）。  
用户 token 与消息 token 的区别见 PushPlus 说明：[用户 token 和消息 token](https://dev.pushplus.plus/doc/help/token.html)。

### 3. 手动跑一次

Actions → **GLaDOS Smart Checkin** → **Run workflow**。成功后应收到微信推送。

## 签到策略（北京时间）

白天优先等 +8，避免过早锁在 +5；傍晚再逐步放宽。

| 条件 | 行为 |
|------|------|
| Cable 加成 `≥ 8`（score &lt; 80） | 高分签到 |
| `≥ 20:00` 且加成 `≥ 5` | 收 5 分档签到 |
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

收 5 起点 20:00 / 软保底 22:00 / 硬死线 23:30 在 [`main.js`](main.js) 顶部常量（`PREFER8_UNTIL_HOUR` / `SOFT_HOUR` / `DEADLINE_*`），与 cron 无关。

改 cron 后需推到**默认分支**；立刻验证用手动 Run workflow。

## 本地运行

```bash
export GLADOS_COOKIE='koa:sess=...; ...'
export GLADOS_UA='Mozilla/5.0 ...'   # shell 里引号是给命令行用的；GitHub Secret 里不要加引号
export NOTIFY='pushplus:你的用户token或消息token'
# export DOMAIN='glados.cloud'
# export AUTO_EXCHANGE='false'
node main.js
```

需要 Node.js ≥ 18（Actions 使用 20）。无第三方 npm 依赖。

## 退出码

- `0`：本轮处理完成（含观望、已签、签到成功）  
- `1`：缺少 Cookie，或存在账号鉴权/签到等失败  

推送失败不会单独导致 `exit 1`。

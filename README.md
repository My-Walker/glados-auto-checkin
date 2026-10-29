# GLaDOS 智能高分签到

使用 GitHub Actions 轮询 IQI（海底电缆质量指数），在高分窗口签到；接近日切未签则保底签到。每次检测/签到结果通过 **PushPlus** 推送到个人微信。

参考：[integration-intelligent/checkin](https://github.com/integration-intelligent/checkin)、[Zirui8/glados_checkin](https://github.com/Zirui8/glados_checkin)。

## 功能概览

- **两种调度模式**（按触发方式区分，间隔可自行配置）：
  - **外部定时触发**（推荐）：[cron-job.org](https://cron-job.org) 等远程 `workflow_dispatch` + 北京夜间～凌晨若干 schedule 保底  
  - **仅 GitHub Schedule**：只用仓库内 `schedule` 轮询（稳定性不如外部定时）
- 策略：白天优先等 Cable `bonus ≥ 8`；北京 **20:00** 后可收 `≥ 5`；**22:00** 后可 `≥ 3`；**23:30** 起强制签
- 推送：每次含北京时间、score、bonus、决策、签到结果、**剩余天数**、**当前积分**
- 自动兑换：代码已支持 `500 积分 → 100 天`，**默认关闭**

本地设计稿 / 接口抓包请放在 `design-assets/`（已加入 `.gitignore`，勿提交到公共仓）。

## 使用步骤

### 1. Fork / 启用 Actions

1. Fork 或推送本仓库到 GitHub  
2. 打开 **Actions**，启用工作流  
3. 推送后请到 Actions → **GLaDOS签到 · 仅GitHub Schedule** → `…` → **Disable workflow**（使用外部定时模式时避免双跑）  
4. 保持 **GLaDOS签到 · 外部定时触发** 为启用状态

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

Actions → **GLaDOS签到 · 外部定时触发** → **Run workflow**。成功后应收到微信推送。

### 4. 配置 cron-job.org（外部定时模式，推荐）

GitHub 自带高频 `schedule` 常延迟或丢任务；用外部定时调用 `workflow_dispatch` 更稳。

#### 4.1 创建 GitHub PAT

1. GitHub → **Settings → Developer settings → Personal access tokens**  
2. 建议 **Fine-grained token**：只选本仓库，权限勾选 **Actions: Read and write**（能触发 workflow 即可）  
3. 生成后复制保存（只显示一次）

#### 4.2 在 cron-job.org 创建任务

1. 注册并登录 [cron-job.org](https://cron-job.org)  
2. 新建 Cronjob，大致配置：  
   - **URL**：  
     `https://api.github.com/repos/<你的用户名>/glados-auto-checkin/actions/workflows/checkin-external-cron.yml/dispatches`  
     （本仓库示例：`https://api.github.com/repos/My-Walker/glados-auto-checkin/actions/workflows/checkin-external-cron.yml/dispatches`）  
   - **Method**：`POST`  
   - **Schedule**：按需设置间隔（例如每 30 分钟）  
   - **Request Headers**：  
     - `Authorization`: `Bearer <你的PAT>`  
     - `Accept`: `application/vnd.github+json`  
     - `Content-Type`: `application/json`  
     - `X-GitHub-Api-Version`: `2022-11-28`（可选，建议带上）  
   - **Body**：`{"ref":"main"}`  
3. 保存后等一次执行，或在站点里手动测；GitHub Actions 应出现由 `workflow_dispatch` 触发的运行

PAT 只放在 cron-job.org，**不要**写进仓库。

## 两种调度模式怎么切换

| 模式 | Actions 名称 | 工作流文件 | 怎么用 |
|------|--------------|------------|--------|
| **外部定时触发**（推荐） | **GLaDOS签到 · 外部定时触发** | [`checkin-external-cron.yml`](.github/workflows/checkin-external-cron.yml) | **启用**本工作流；用 cron-job.org（等）POST；**Disable**「仅GitHub Schedule」 |
| **仅 GitHub Schedule** | **GLaDOS签到 · 仅GitHub Schedule** | [`checkin-github-schedule.yml`](.github/workflows/checkin-github-schedule.yml) | **暂停**外部定时任务；**Disable**「外部定时触发」；**Enable** 本工作流 |

不要两套主轮询同时开着，否则会双跑、双推送。

## 签到策略（北京时间）

白天优先等 +8，避免过早锁在 +5；傍晚再逐步放宽。

| 条件 | 行为 |
|------|------|
| Cable 加成 `≥ 8`（score &lt; 80） | 高分签到 |
| `≥ 20:00` 且加成 `≥ 5` | 收 5 分档签到 |
| `≥ 22:00` 且加成 `≥ 3` | 软保底签到 |
| `≥ 23:30` 且本轮仍需签 | 硬保底签到 |
| 其它 | 观望（仍查 IQI / 积分 / 天数并推送） |

每轮都会查 IQI（质量检测）与 `GET /user/points`。若积分历史中已有当日 `system:checkin`，则**跳过** `POST /user/checkin`，但仍推送 score/bonus 便于统计拥堵。今日未签且策略命中才会真正签到；签到接口返回已签（`code === 1`）视为正常，不报失败。

## 自动兑换（默认关闭）

- 实现：`POST /api/user/exchange`，`{ "planType": "plan500" }`（约 500 积分换 100 天）  
- 仅当 Secret / 环境变量 `AUTO_EXCHANGE=true`，且当前积分 `≥ EXCHANGE_THRESHOLD`（默认 500）时调用  
- 兑换失败只记入推送，**不**把签到判失败  
- 未开启时日志为「兑换已跳过」，**不会发兑换请求**

## 如何改间隔 / 对齐时间

- **外部定时模式 · 主频率**：在 cron-job.org（或你用的外部服务）改任务间隔。  
- **外部定时模式 · 夜间保底**：改 [`checkin-external-cron.yml`](.github/workflows/checkin-external-cron.yml) 的 `schedule`（值为 **UTC**，北京 = UTC+8）。当前保底点：

| 北京时间 | UTC cron |
|----------|----------|
| 23:00 | `0 15 * * *` |
| 23:30 | `30 15 * * *` |
| 23:45 | `45 15 * * *` |
| 00:00 | `0 16 * * *` |
| 00:30 | `30 16 * * *` |
| 01:00 | `0 17 * * *` |

- **仅 GitHub Schedule 模式**：改 [`checkin-github-schedule.yml`](.github/workflows/checkin-github-schedule.yml) 里的 cron 表达式（间隔按需改，不限定 30 分钟）。

签到策略里的 20:00 / 22:00 / 23:30 在 [`main.js`](main.js) 顶部常量，与 cron 无关。改 workflow 后需推到**默认分支**。

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

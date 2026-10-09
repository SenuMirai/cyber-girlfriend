# 赛博女友 · 公网部署说明

把这份程序挂到免费托管平台上，得到一个网址，**任何人都能打开用**。
不用租服务器，不用买域名。

---

## 先搞清楚：这个「公网版」和本机版有什么区别

| | 本机版（双击「启动.cmd」） | 公网版（本文档） |
|---|---|---|
| 谁能用 | 只有你这台电脑 | 拿到网址的所有人 |
| API Key | 存在你自己电脑的 `config.json` | **每位使用者在网页上填自己的 Key**，存在他自己浏览器里 |
| 角色数据 | 存在你电脑上，永久 | 每人一份，互相看不见；免费档重启会清（见下方） |
| 形象图 | 传到你自己的 GitHub | 传到你部署的这台服务上，自动生成公网直链 |
| 网址 | `localhost` 或局域网 IP | `https://xxx.onrender.com` 这样 |

**为什么要「自带 Key」？** 因为程序本身只是界面，真正说话的能力（声音、数字人视频）
是调 Vivix 的接口，接口按用量收费。如果服务器上放一把公共 Key，任何人点几下就能烧你的钱。
所以设计成：**使用者自己注册 Vivix、自己填 Key，用多少算他自己头上**，你只出托管费（免费档=0 元）。

---

## 第 0 步：把代码传到 GitHub

托管平台都是「读你的 GitHub 仓库」来部署的，所以代码得先上去。

```bash
cd "赛博女友项目目录"
git add -A
git commit -m "公网版：自带 Key、按浏览器隔离数据"
git push
```

> ⚠️ **推之前确认 `config.json` 没有跟着上传。**
> 这个文件里有你本机的 API Key，仓库的 `.gitignore` 已经把它排除掉了，
> 用 `git status` 看一眼，如果看到 `config.json` 出现在待提交列表里，立刻 `git rm --cached config.json`。

**仓库建议设为 Private（私有）。** 公开仓库别人能看到你的代码；
程序本身没什么见不得人的，但私有更省心。

---

## 路线 A：Render（推荐，界面最友好）

Render 有免费档，用 Dockerfile 一把部署，还支持「蓝图」——把 `render.yaml` 里的配置自动建好。

### 1. 注册
打开 <https://render.com>，用 GitHub 账号登录（右上角 `Get Started` → `GitHub`）。

### 2. 建服务
登录后点 `New` → `Blueprint`。

第一次用会让你授权访问 GitHub 仓库，选 `Only select repositories`，
只勾选你刚才推上去的那个仓库，然后 `Install`。

### 3. 选仓库
回到 Render，在列表里点选那个仓库 → `Connect`。

Render 读到仓库里的 `render.yaml`，会显示一个叫 `cyber-girlfriend` 的服务，
直接点 `Apply`（或 `Create`）。

### 4. 等
它会自己装环境、打包、启动。**第一次大概 3–8 分钟**（免费档的机器比较慢，正常）。
页面上会滚动日志，看到类似 `server listening` 就是好了。

### 5. 拿网址
服务状态变成绿色的 `Live` 后，页面上会显示网址，形如：

```
https://cyber-girlfriend-xxxx.onrender.com
```

点开就是你的赛博女友，发给朋友他就能用。

> 网址太长不好记，可以在 Render 的 `Settings` → `Custom Domain` 里绑自己的域名，
> 但那是可选的，不影响使用。

### 免费档的两个脾气，提前告诉你

1. **睡懒觉。** 15 分钟没人访问，实例会被挂起。下个人打开时页面会转圈约 30–60 秒才醒——
   这是 Render 免费档的机制，不是程序坏了。想让它一直醒着，就升付费档。
2. **记性差。** 免费档不能挂持久磁盘，容器重启后 `/data` 里的东西会被清空，
   **大家存的角色会丢**（但浏览器里的 API Key 不受影响，因为压根没存在服务器上）。
   应对办法：在设置面板点「导出角色包」存到本地，换机器或重启后再「导入角色包」。
   嫌麻烦就升付费档挂一块磁盘，1 GB 也就 $0.25/月。

---

## 路线 B：Fly.io（不睡觉，免费额度也够用）

优点：免费额度内的实例**不会因为没人访问而挂起**，反应更快。
缺点：要用命令行，比 Render 多几步。

### 1. 装命令行工具
Windows 上用 PowerShell 跑：

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

装完关掉终端重开一个，输入 `flyctl version` 能看到版本号就成了。

### 2. 登录
```bash
flyctl auth signup     # 没账号就注册（要绑卡，但免费额度内不扣钱）
flyctl auth login      # 已有账号
```

### 3. 建应用
在项目目录里：

```bash
flyctl launch
```

它会问几个问题，照这样答：

- `App name`：随便起，比如 `my-cyber-girlfriend`（要全球唯一）
- `Region`：选离你近的，国内用户选 `hongkong`（中国香港）延迟最低
- `Would you like to set up a Postgresql database?` → **No**
- `Would you like to deploy now?` → **No**（先把环境变量配好再部署）

### 4. 配环境变量和存储

```bash
# 公网模式 + 数据目录
flyctl secrets set CG_PUBLIC=1
flyctl secrets set CG_DATA_DIR=/data
flyctl secrets set CG_CLIENT_TTL_DAYS=30

# 挂一块 1 GB 的盘，让角色数据活过重启（免费额度内）
flyctl volumes create cg_data --size 1 --region hongkong
```

然后打开项目里生成的 `fly.toml`，在文件末尾加上磁盘挂载：

```toml
[mounts]
  source = "cg_data"
  destination = "/data"
```

顺手把端口也对一下，找到 `[env]` 段，确认里面有：

```toml
[env]
  PORT = "3000"
```

### 5. 部署
```bash
flyctl deploy
```

完了它会打印网址，形如 `https://my-cyber-girlfriend.fly.dev`。

### 6. 以后改代码
`flyctl deploy` 一条命令重新部署。看日志 `flyctl logs`。

---

## 路线 C：Railway（界面好看，免费额度小）

跟 Render 很像，登 GitHub 选仓库就行，但它会自己认 Dockerfile，**不需要 `render.yaml`**。

1. 打开 <https://railway.app>，GitHub 登录
2. `New Project` → `Deploy from GitHub repo` → 选你的仓库
3. 进项目 → 服务的 `Variables` 页，加这几条：
   - `CG_PUBLIC` = `1`
   - `CG_DATA_DIR` = `/data`
   - `CG_CLIENT_TTL_DAYS` = `30`
4. `Settings` → `Networking` → `Generate Domain`，拿到网址

> Railway 免费额度是每月 $5 的用量，跑这个小服务大概够，
> 但要看紧点——用超了会直接停或者开始扣钱。**如果你想长期免费，推荐还是 Render 或 Fly。**

---

## 环境变量速查

部署时在平台控制台的 `Environment` / `Variables` 里加。**只有前两条是必须的。**

| 变量 | 填什么 | 说明 |
|---|---|---|
| `CG_PUBLIC` | `1` | 必填。开公网模式：数据按浏览器隔离、Key 由使用者自带 |
| `CG_DATA_DIR` | `/data` | 必填。数据目录，挂了磁盘就指向挂载点 |
| `CG_CLIENT_TTL_DAYS` | `30` | 可选。多少天没人访问就清掉这个人的数据 |
| `PORT` | 一般不用填 | Render/Fly/Railway 会自己注入 |
| `PUBLIC_BASE_URL` | 一般不用填 | 只有当形象图链接推断错了（挂在 CDN 后面）才需要手填，如 `https://xxx.onrender.com` |
| `VIVIX_API_KEY` | **强烈建议留空** | 留空=使用者自带 Key。填了=所有人共用你的额度，账单是你的 |

---

## 常见问题

### 打开页面转圈很久，或者第一次很慢
Render 免费档在「睡觉」。等一下，或者升付费档。

### 提示「还没填写你自己的 Vivix API Key」
正常，说明自带 Key 机制生效了。点右上角「设置」，
把你在 <https://vivix.ai> 注册后拿到的 API Key 填进去。
**它只存在你这台设备的浏览器里，不会上传到服务器**，换浏览器要重填。

### 朋友说填了 Key 还是不能说话
让他确认两件事：① Key 有没有多余的空格；② Key 在 Vivix 那边是不是还有额度。
程序会把 Key 原样转发给 Vivix，如果 Key 本身不对，Vivix 会直接拒绝。

### 角色形象图显示不出来 / 提示「读不到这张图」
说明 Vivix 的服务器抓不到这张图。检查一下：网址是不是 `https://` 开头的（Vivix 通常要求 https）。
如果套了 CDN 或自定义域名，按上表给 `PUBLIC_BASE_URL` 填上确切地址。

### 上传的图人变窄、拉长了
这是 Vivix 的规定：**首图比例必须和输出比例一致**。
程序已经自动处理了——上传时会把图片裁成和目标比例完全相同，所以正常不会变形。
如果你是按竖版（9:16）用，上传的图也应该是竖版。

### 想重启/关掉服务
去平台控制台点 `Restart` / `Suspend`。
程序自带的 `/shutdown` 接口在公网模式下是**关闭**的（返回 403），防止别人乱关你的服务。

### 服务是不是还活着？
访问 `你的网址/health`，会返回一段 JSON：

```json
{"ok":true,"mode":"public","version":"2.0.0","uptime_seconds":123,"clients":2}
```

`mode` 是 `public` 就说明公网模式生效了，`clients` 是当前有几个人的数据。

### 别人的数据我会不会看到？
不会。每个浏览器会被发一个身份 cookie，数据分别存在 `/data/clients/<身份>/` 下，
互相看不见。但请注意：**这不是账号系统，没有密码**——同一个人换浏览器就是一份新数据，
也没法登录回旧数据。够用就好，别拿它存敏感东西。

---

## 附：本机版不受影响

上面这些改动全都在「公网模式」里生效。
你双击「启动.cmd」跑起来时，程序检测不到 `CG_PUBLIC=1`，
仍然是本机自用模式：读你电脑上的 `config.json`、局域网能访问、带 HTTPS 和二维码。

两套模式共用一个程序，不会互相干扰。

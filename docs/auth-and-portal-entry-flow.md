# 门户接入、鉴权换取与 WHIP 地址下发流程

> 编制日期：2026-06-05
> 目的：说明 H5 推流助手从管理门户进入时的「一次性 code → token + 推流地址」换取流程、刷新复用机制，以及服务端下发的 WHIP 推流地址如何落到推流设置。

---

## 一、背景

H5 推流助手不独立登录，而是由灵犀视频云**管理门户**（`b-test.lxi-tech.com`）跳转进入。门户在「网页开播」入口处生成一个**一次性授权码 `code`**，并以 URL 参数形式带入 H5 应用：

```
https://qdd-test.lxi-tech.com:14116/?roomInfoId=<房间ID>&code=<一次性code>
```

H5 拿到 `code` 后，POST 到 SaaS 换取接口，换回**会话 token、用户信息，以及该房间的 WHIP 推流地址 `pushStreamUrl`**。后续所有业务接口（云盘等）用这个 token 作 `Authorization: Bearer`，推流则用换回的 `pushStreamUrl`。

| 概念 | 说明 |
|------|------|
| `roomInfoId` | 直播间 ID，门户跳转时带入，留在地址栏不清除 |
| `code` | 一次性授权码，单次有效、约 1 分钟过期，换取成功后立即从地址栏抹除 |
| `token` | 会话令牌（JWT），换取返回，写入 cookie `lh_token` 供刷新复用 |
| `pushStreamUrl` | 该房间的 WebRTC（WHIP）推流地址，换取返回，写入 cookie `lh_push` |

---

## 二、整体流程图

```
管理门户 (b-test.lxi-tech.com)
  │  直播详情页 → 开播方式 → 「网页开播」
  │  生成一次性 code
  ▼
新标签打开 H5 助手
  https://qdd-test.lxi-tech.com:14116/?roomInfoId=...&code=...
  │
  ▼
App.vue onMounted → roomStore.bootstrap()
  │
  ├─① URL 带 code ?  ──是──►  POST https://qdd-test.lxi-tech.com:15816/livesaas/exchange
  │                              body: { roomInfoId, code }
  │                              resp: { token, userId, username, pushStreamUrl }
  │                            ├─ 写 cookie lh_token / lh_push
  │                            ├─ cleanUrl() 抹掉地址栏的 code
  │                            └─ 换取失败 → 回退到已有 cookie；无 cookie 则抛错
  │
  ├─② 无 code（刷新）?  ──是──►  读 cookie lh_token / lh_push 复用，不再请求
  │
  └─③ 开发环境兜底  ────────►  读 VITE_DEV_* 环境变量
  │
  ▼
鉴权成功 → streamStore.updateConfig({ whipUrl: pushStreamUrl })
  │
  ▼
设备检测页 → 直播控制台 → 推流设置里 WHIP 地址 = 真实下发地址
  │
  ▼
开始直播 → WebRTC(WHIP) 推流到该地址
```

---

## 三、换取接口

### 3.1 请求

```
POST {VITE_SASS_URL}/livesaas/exchange
Content-Type: application/json

{ "roomInfoId": "2054045384996683776", "code": "ecb834c9..." }
```

- `VITE_SASS_URL` 生产值：`https://qdd-test.lxi-tech.com:15816`
- 也支持 URL 参数 `?sassUrl=` 覆盖（优先级：URL 参数 > `VITE_SASS_URL` > 开发兜底）

### 3.2 响应

```json
{
  "requestId": "ef8e422d3d5c455496bbcb55d3426bb0",
  "code": 200,
  "msg": "操作成功",
  "data": {
    "token": "eyJhbGciOiJIUzUxMiJ9...",
    "userId": "1985263669063319552",
    "username": "2377测试主账号",
    "pushStreamUrl": "https://qdd-test.lxi-tech.com:20081/index/api/whip?app=live&stream=test"
  }
}
```

| 字段 | 用途 |
|------|------|
| `token` | 业务接口鉴权令牌，写入 cookie `lh_token` |
| `userId` / `username` | 主播身份信息 |
| `pushStreamUrl` | WHIP 推流地址，写入 cookie `lh_push`，落到 `streamStore.config.whipUrl` |

成功判定：HTTP 2xx **且** `json.code === 200` **且** `json.data` 非空；否则透传 `json.msg` 抛错（如「链接已过期或已被使用，请刷新页面」）。

---

## 四、bootstrap 三分支解析顺序

`roomStore.bootstrap()` 在 `App.vue onMounted` 时调用一次，按以下顺序决定 token 来源：

| 顺序 | 条件 | 行为 | 关键设计 |
|------|------|------|---------|
| **① 门户进入（优先）** | URL 同时有 `code` 和 `roomInfoId` | 调换取接口，写 token + pushStreamUrl 到 cookie，`cleanUrl()` 抹掉 code | 地址栏里**残留的 code 必为新鲜 code**（换取成功后会被立刻抹除），所以即使存在旧 cookie 也要优先换取，避免旧 cookie 短路掉新的 pushStreamUrl |
| **② 刷新复用** | 无 code | 读 cookie `lh_token` / `lh_push` 复用，不再请求 | 刷新时已无 code，靠 cookie 维持会话与推流地址；推流地址随 token 一起持久化，刷新不丢 |
| **③ 开发兜底** | 开发环境、无 code 无 cookie | 读 `VITE_DEV_TOKEN` / `VITE_DEV_USER_ID` / `VITE_DEV_ROOM_ID` | 本地开发免门户跳转 |

> ⚠️ **历史坑**：早期版本把分支顺序写反了（先查 cookie 再换 code）。结果浏览器里残留的旧 token cookie 会让分支①永远命中、直接 return，**即使门户带着新鲜 code 进来也不会换取**，导致 `pushStreamUrl` 永远拿不到。修复方式即「有 code 优先换取」。

### 4.1 换取失败的容错

分支①换取失败（code 过期/已用、网络、CORS）时：
- 若仍有有效 cookie token → **回退复用**，不把用户锁在外面；
- 若无 cookie 兜底 → 抛错，`App.vue` 进入 `authState='error'` 引导刷新；
- 硬失败时**保留地址栏的 code**，使手动刷新能复现同样的错误，而非静默进入无 token 状态。

### 4.2 URL 清理（cleanUrl）

换取成功（或无 code 进入）后，从地址栏删除 `code` 和遗留的 `token` 参数（`history.replaceState`），避免：
- 一次性 code 被二次使用、分享、或经 Referer 泄漏；
- `roomInfoId` **保留**，刷新时仍可解析。

---

## 五、WHIP 推流地址的落地

推流设置面板的 WHIP 地址来源于 `streamStore.config.whipUrl`。该值的解析优先级：

```
服务端下发 pushStreamUrl（换取/cookie）
        ▼ App.vue 鉴权成功后写入
streamStore.config.whipUrl
        ▲ 默认兜底
VITE_WHIP_URL 环境变量  →  硬编码 localhost 兜底
```

```typescript
// App.vue onMounted，bootstrap 成功后
if (roomStore.pushStreamUrl) {
  streamStore.updateConfig({ whipUrl: roomStore.pushStreamUrl })
} else {
  // 未下发则沿用 streamStore 默认（VITE_WHIP_URL 或 localhost 兜底）
}
```

- 服务端**下发了** `pushStreamUrl` → 设置页显示真实地址，WebRTC 走真实地址；
- 服务端**未下发**（空）→ 沿用 `VITE_WHIP_URL`（生产留空时落到 `http://localhost:1985/...` 兜底，仅本地有意义）。

> 这意味着不同直播间通过门户进入会拿到各自的推流地址，无需手动填写。

---

## 六、刷新行为确认

| 场景 | token | roomInfoId | pushStreamUrl |
|------|-------|-----------|---------------|
| 门户首次进入（带 code） | 换取获得，写 cookie | URL 解析 | 换取获得，写 cookie，落 whipUrl |
| 刷新页面（无 code） | cookie 复用 ✅ | URL 仍保留 ✅ | cookie 复用 ✅，重新落 whipUrl |
| 清除 cookie 后刷新（无 code） | 无 → 进入无 token 态 | URL 仍保留 | 无 |

结论：**刷新不会丢失 token / roomInfoId / pushStreamUrl**，因为三者分别由 cookie 与 URL 残留参数维持，不依赖一次性 code。

---

## 七、设备检测的网络探测

设备检测页的「网速」检测项探测目标为**同源资源**而非外部站点：

```typescript
// src/components/setup/DeviceCheck.vue checkNetwork()
await fetch(`${location.origin}/favicon.svg`, { mode: 'no-cors', cache: 'no-store' })
```

- 应用部署在国内，早期用 `https://www.google.com/generate_204` 探测会被墙、`ERR_CONNECTION_TIMED_OUT` 并卡满 3 秒；
- 改为同源（页面已从该源加载，必可达），既能测真实往返延迟，又消除红色报错；
- 顺带 `public/favicon.svg` 补齐，消除标签页图标 404。

---

## 八、关键代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| bootstrap 三分支解析 | `src/stores/roomStore.ts` | 70-173 |
| 分支①门户换取 + 失败回退 | `src/stores/roomStore.ts` | 103-141 |
| 分支②刷新复用 cookie | `src/stores/roomStore.ts` | 145-153 |
| URL 清理 cleanUrl | `src/stores/roomStore.ts` | 176-180 |
| 换取接口封装 | `src/services/authService.ts` | 49-114 |
| 响应体类型（含 pushStreamUrl） | `src/services/authService.ts` | 22-41 |
| WHIP 地址落到 streamStore | `src/App.vue` | 126-131 |
| whipUrl 默认值 | `src/stores/streamStore.ts` | 8 |
| cookie 读写工具 | `src/utils/cookie.ts` | 全文件 |
| 设备网络探测（同源） | `src/components/setup/DeviceCheck.vue` | 115-125 |

---

## 九、环境变量

| 变量 | 生产值 | 说明 |
|------|--------|------|
| `VITE_SASS_URL` | `https://qdd-test.lxi-tech.com:15816` | SaaS 接口基地址，换取接口与业务接口共用 |
| `VITE_WHIP_URL` | 留空 | 默认 WHIP 地址兜底；服务端下发 `pushStreamUrl` 时不使用 |
| `VITE_SIGNAL_URL` | 留空 | 信令地址，留空时跳过 socket.io 连接（连麦/聊天未部署） |
| `VITE_VERBOSE_LOG` | `true`（测试环境） | 详细诊断日志开关，正式上线应改回 `false` |

> Cookie 键：`lh_token`（会话令牌）、`lh_push`（WHIP 推流地址），均为非 HttpOnly（SPA 需读取后作请求头）、SameSite=Lax、HTTPS 下 Secure。

---

## 十、一句话总结

```
门户带 code 进入 → 换取 token + pushStreamUrl → 写 cookie → 落到推流设置 WHIP 地址
刷新（无 code）→ cookie 复用，token / roomInfoId / pushStreamUrl 均不丢
换取失败 → 有 cookie 回退，无 cookie 抛错引导刷新
```

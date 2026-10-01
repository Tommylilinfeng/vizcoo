# 统一画布 MVP 计划（v3，audit 修订版）

**最终方向**：单画布、左 Map（自由 3D 视角）+ 右 Stage（永远正交，正面对屏）。Edit/Write 文件从所属 Map 模块飞到 Stage，Read 仅在 Map 上闪。Stage chip 默认极简，hover 展开 HoverCard 全信息。

---

## 决策清单（v3）

| 项 | 结果 | 备注 |
|---|---|---|
| 渲染栈 | **三层 SVG**：Map（带旋转）/ Stage（正交）/ Flight overlay（全屏） | DOM overlay 仅用于交互浮层（HoverCard） |
| Stage 相机 | **始终垂直画布**，不参与 Map 旋转 | 这是硬约束 |
| Map 旋转锁 | 飞行进行中临时锁定，飞行结束释放 | 防起点漂移 |
| Stage 与 Map 空间关系 | **横分 50:50**（已定，user sign-off 2026-04-26） | Map 视觉会缩水，跑出来不满意再调 |
| 动画工具 | **Web Animations API（`element.animate`）+ CSS cubic-bezier** | 不引入 d3 / framer-motion |
| Read 节流 | **前端 viewStore 节流**，不动 `src/core/` | 同 module 200ms |
| Read 后端改动 | live 事件加 `type='read'` 字段，仅由现有 hook dispatcher 转发 | 不加 per-session 状态 |
| HoverCard 实现 | **DOM overlay（React Portal）**，明文化为允许的例外 | 渲染主体仍 SVG |
| Stage 空闲 | 真空，零占位（dev-only flag 调试时显示锚点） | |
| Turn 回放 | MVP 不做，selectTurn 退化为 Timeline UI 高亮 | |
| Reset 期间 Stage 行为 | 暂停所有飞行 + 清空 chip；overlay 消失后重新订阅 | |

---

## 必须先解决的依赖（audit 引出）

### A. 数据集成基线
- **path → moduleId**：现有 `live-pending` 只带 path。后端在 dispatcher 推送时附带 moduleId（查 SQL 一行：`SELECT module_id FROM files WHERE path=?`）。前端不预取大表
- **Map 相机状态外提**：`pan/zoom/rotZ/rotX` 当前是 `ArchScene.tsx:44-45` 的 local state。要让 Flight overlay 算飞行起点屏幕坐标，必须提到全局 store（新建 `src/ui/arch/cameraStore.ts`）
- **Stage 焦点布局**：横向一行 / 纵向堆叠 / 网格 — Phase 0 出 mockup 拍板，否则 Phase C 飞不准

### B. Map 现存 P0 bug（audit doc/audit/ 列出）
- 双 fetch 竞态（WS+mutation）
- pan/zoom 在 WS 后 snap

Stage 上线后 WS 频率会显著升高，必须先修这两个，否则会暴露竞态 bug。

### C. http.ts 现状
当前 243 行（红线 150）。**Phase D 之前必须先拆分 http.ts**，否则 Phase D 加 Read hook 路由会继续超。

---

## Phase 拆解（v3）

### Phase 0 — 集成基线 + Map P0 修复（1.5 天）

不写 Stage 代码，先把所有"集成性"问题解决。

**0.1 数据层**
- 后端 live dispatcher 推送时附带 `moduleId`（`live-pending` / `live-done` / 新 `live-read`）
- 前端 `viewStore` 类型同步加 `moduleId` 字段

**0.2 Map 相机状态外提**
- 新建 `src/ui/arch/cameraStore.ts`（zustand，约 30 行）
- 字段：`pan`, `zoom`, `rotZ`, `rotX`
- ArchScene 改为消费此 store，不再自管 local state
- 暴露 `getModuleScreenRect(moduleId)` selector — Flight overlay 用

**0.3 Stage 空间关系（已定 — 横分 50:50）**
- 不出 mockup，直接 Phase B 实现
- 跑出来视觉不满意再调（候选 fallback：上下分 / overlay）

**0.4 Stage 焦点布局（默认横向单行）**
- chip 横向并排，超过 N 个换行（按 Stage 宽度自适应）
- Phase C 落地后 user 看效果再调

**0.5 Map audit P0 修复**
- doc/audit/ 中标记 #1 #2 的 bug 修掉
- 验收：连续 WS 推送下不再 snap、不再双 fetch

**0.6 http.ts 拆分**
- 当前 243 行 → 拆出 ws/route 注册子模块，主文件 ≤150 行
- 不改路由行为，纯结构调整

**Phase 0 验收：**
- [ ] live 事件带 moduleId 字段
- [ ] cameraStore 立得起来，ArchScene 消费正常
- [ ] Map audit P0 #1 #2 修复
- [ ] http.ts < 150 行

---

### Phase A1 — 前端清 Three.js 引用（0.5 天）

**只删代码引用，不卸 npm 依赖**（依赖留到 A2 卸，避免编译炸）

**删除文件：**
- `src/ui/view/ViewScene.tsx`
- `src/ui/view/FileNode.tsx`
- `src/ui/view/HoverCard.tsx`（Three.js 版，Phase E 重写）
- `src/ui/view/scene-constants.ts`
- `src/ui/view/dev-probes.tsx`
- `src/ui/view/EmptyState.tsx`
- `src/ui/view/layout.ts`

**改 viewStore.ts**（必须显式列出）：
- 移除 `import { buildLayout, type Layout } from './layout.js'`
- 移除 `Layout` 类型字段、`EMPTY_LAYOUT` 常量、`layout` 状态字段
- 移除 `buildLayout(d.files)` 调用
- 同时移除 `activatedPaths` 字段（无消费者了，FileNode 已删）
- 保留：`conversations`, `selectedId`, `files`, `turns`, `liveActivePath`, `livePaths`, `loadConversations`, `selectConversation`, `handleLive`
- selectTurn / selectedTurnIndex 暂保留为接口预留

**改 App.tsx：**
- View 路由暂时渲染 `<MapView />`（占位）+ 空 div placeholder
- V/M 切换 state 保留（A2 删）

**验收：**
- [ ] `npm run build` 通过
- [ ] Map 路由功能完全不变
- [ ] V 路由跳到 Map 视图（占位行为，不挂）

---

### Phase A2 — 卸依赖 + 删路由（0.5 天）

**npm uninstall：**
- `@react-three/fiber`
- `@react-three/drei`
- `@react-three/postprocessing`
- `@react-spring/three`
- `three`
- `@types/three`

**App.tsx 路由清理：**
- 删 V/M state
- 删 localStorage 路由记忆 key
- Sidebar V/M 按钮删除（保留会话列表）

**验收：**
- [ ] `npm run build` 通过
- [ ] 包体积下降验证（首屏 chunk 减小）
- [ ] 单视图 = Map 全屏（暂时）

---

### Phase B — 三层 SVG 布局 + Stage 静态（1 天）

**布局结构（依 Phase 0.3 决策）：**

```
┌─────────┬──────────────────────────┬─────────┐
│         │  Flight overlay SVG      │         │
│ 会话    │  z-index: 高，pointer-none│ Timeline│
│ 列表    │  ┌──────────┬───────────┐│ 折叠    │
│         │  │ Map SVG  │ Stage SVG ││         │
│         │  │ 旋转/缩放│ 永远正交  ││         │
│         │  └──────────┴───────────┘│         │
└─────────┴──────────────────────────┴─────────┘
```

- Flight overlay 是绝对定位的全屏 SVG，覆盖 Map+Stage 区域
- Map 和 Stage 各有 viewBox，互不干涉
- Stage 永远 0 旋转，纯 2D，矩形 chip 平铺

**零会话态：**
- 中央显示 "No conversation yet — chat in another terminal"（继承旧 EmptyState 文案）
- hooks 未装时显示 hooks 安装提示

**Phase B 收尾再次确认 Stage 焦点布局**：
画一张静态 chip 占位图（无飞行），跑出来给 user 看是否符合预期。

**验收：**
- [ ] 三层 SVG 立得起来
- [ ] Map 在自己的子区域内能旋转、拖拽，不影响 Stage
- [ ] Stage 在 Map 旋转时**完全不动**（核心约束）
- [ ] 零会话态文案显示

---

### Phase C — live 飞行（Edit/Write）（2 天）

**飞行实现（Web Animations API）：**

```js
chip.animate(
  [
    { transform: `translate(${startX}px, ${startY}px) scale(0.7)`, opacity: 0.4 },
    { transform: `translate(${midX}px, ${midY}px) scale(1.05)` },  // 弧形顶点
    { transform: `translate(${endX}px, ${endY}px) scale(1.0)`, opacity: 1 },
  ],
  { duration: 600, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'forwards' }
)
```

- 起点：`cameraStore.getModuleScreenRect(moduleId)` 顶面中心 → 屏幕坐标
- 终点：Stage 焦点位（按布局策略算）
- 弧形：中点位移给一个负 Y 偏移，模拟抛物线
- bounce：cubic-bezier 末端过冲实现

**Map 旋转锁：**
- cameraStore 加 `flightInProgress: number`（计数器）
- ArchScene 拖拽 handler 检测到 > 0 时禁止 pan/rotate
- chip 飞入 +1，飞行结束 -1

**触发链路：**
- `live-pending` (kind=edit/write) → Flight overlay 创建临时 chip → 飞 → 落到 Stage（Stage 接管，从 overlay 移除）
- `live-done` → chip kind 已知，颜色不变，更新 stats（hover 时显示）

**Turn 切换：**
- `live-turn-end` → 当前 chip 集合标记 stale
- 下个 `live-pending` → 旧 chip 反向飞回 Map（300ms 淡出归位）→ 同帧新 chip 入场

**多 chip 错开：**
- 同 turn 内 100ms / chip 起飞，最多并发 5 条飞行轨迹

**Reset 期间：**
- 监听 reset overlay 状态（已存在）
- overlay 显示时：暂停所有 active animation、清空 Stage chip 列表
- overlay 消失时：清掉 livePaths（陈旧 moduleId），重新订阅

**验收：**
- [ ] Edit 工具触发 → chip 飞过去
- [ ] Write 工具触发 → 颜色不同
- [ ] 同 turn 多文件 → 错开飞行
- [ ] turn 切换 → 旧 chip 干净退场
- [ ] 飞行中拖 Map → 拖不动（锁住）
- [ ] Reset 期间触发 live → Stage 静默
- [ ] Stage 在 Map 旋转时 chip 位置不动

---

### ~~Phase D — Read 闪烁~~ **已跳过**（user 2026-04-26）

MVP 不做 Read 状态。如果将来要加，参考此 plan 历史版本。

---

### Phase E — HoverCard DOM Portal（1 天）

**明文例外**：HoverCard 用 React Portal + 绝对定位 `<div>`。
理由：SVG `<foreignObject>` 在事件冒泡和样式层面有兼容坑，DOM Portal 是行业实践。
影响：渲染主体仍是 SVG，仅交互浮层是 DOM。

**实现：**
- chip onMouseEnter → 算 chip 屏幕位置 → Portal 渲染 HoverCard
- Card 内容继承现有 `HoverCard.tsx:23-67` 的 JSX（folder/basename/kind/diff）
- 复用 `buildDiffLines` 函数（76-90 行）— 这部分是纯逻辑，直接 copy
- 离开 chip + 离开 card → 卡片消失

**验收：**
- [ ] hover chip → 卡片弹出 180ms 缓动
- [ ] 显示 folder / basename / kind / +N -N / mini diff
- [ ] 内容跟旧版一致

---

### Phase F — viewStore 简化 + Timeline 改造（0.5 天）

**viewStore 字段最终态：**

| 字段 | 保留 | 来源 |
|---|---|---|
| conversations / selectedId | ✓ | API |
| files / turns | ✓ | API |
| liveActivePath / livePaths | ✓ | hook live |
| selectedTurnIndex | ✓（仅 Timeline UI） | Timeline 选中 |
| ~~layout~~ | A1 已删 | — |
| ~~activatedPaths~~ | A1 已删 | — |

**Timeline.tsx 改造：**
- 删除 `ReviewBanner`（69-70 行 + 163-170 行）
- selectTurn 仅写 `selectedTurnIndex`，不触发 Stage
- "back to live" 按钮删除

**验收：**
- [ ] Timeline 仍能展开/折叠、点 turn
- [ ] 点 turn 仅自身高亮
- [ ] Stage 行为完全不响应 Timeline

---

### Phase G — 视觉打磨 + 验收（1.5 天）

**SVG 发光（bloom 替代）：**

```xml
<filter id="chip-glow" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="2.5" result="blur" />
  <feFlood flood-color="rgb(100,200,255)" flood-opacity="0.6" />
  <feComposite in2="blur" operator="in" />
  <feMerge>
    <feMergeNode />
    <feMergeNode in="SourceGraphic" />
  </feMerge>
</filter>
```

不同 kind 用不同 filter id（蓝/橙）。

**全链路验收清单：**
- [ ] `npm run build` 通过 + 包体积验证
- [ ] 真机跑 vizcoo 启动
- [ ] Edit 飞行 → 停留 → hover 全链路
- [ ] Write 颜色正确
- [ ] Read 闪烁（如 Phase D 完成）
- [ ] 多文件 turn → 错开飞行
- [ ] turn 切换 → 干净退换
- [ ] hover chip → HoverCard 信息完整
- [ ] Timeline 折叠/展开/选 turn 正常
- [ ] Stage 在 Map 旋转 / 缩放 / 拖拽时**纹丝不动**
- [ ] Map 飞行进行中拖拽被锁
- [ ] Reset 期间 Stage 静默
- [ ] 整体审美符合 Linear/Rams 克制标准

---

## 工作量（修订）

| Phase | 工时 |
|---|---|
| 0 集成基线 + Map P0 修复 | 1.5 天 |
| A1 前端清 Three.js | 0.5 天 |
| A2 卸依赖 + 删路由 | 0.5 天 |
| B 三层 SVG 布局 | 1 天 |
| C live 飞行 | 2 天 |
| ~~D Read 闪烁~~ | ~~跳过~~ |
| E HoverCard | 1 天 |
| F viewStore + Timeline | 0.5 天 |
| G 视觉打磨 + 验收 | 1.5 天 |
| **总计** | **8.5 天** |

---

## 红线（与 CLAUDE.md 对齐 + 例外明文化）

- `src/core/modules/` 零改动
- `src/core/server/api/hook.ts` 仅扩展事件 type，不加 per-session 状态
- `src/core/server/http.ts` 拆分到 ≤150 行（Phase 0.6）
- 不引入新 npm 依赖（包括 d3 / framer-motion）
- 动画用 Web Animations API + CSS cubic-bezier
- 渲染层全 SVG；**例外**：HoverCard / Tooltip 用 DOM Portal
- Phase 顺序不跳过；每 Phase 完成 user 验收

---

## 启动条件

- [x] 决策清单 v3 确认
- [x] Stage 横分 50:50（user 2026-04-26）
- [x] Phase D Read 闪烁跳过（user 2026-04-26）
- [x] Map P0 修复由 Claude 做（所有 phase Claude 实施）

**全部就绪，可启动 Phase 0。**

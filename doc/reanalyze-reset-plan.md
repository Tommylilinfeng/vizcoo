# Re-analyze: soft refresh vs hard reset

Date: 2026-04-26

## Why

`/api/re-analyze` 目前只有一种行为："软重跑" —— 重新跑启发式发现，强制重跑 LLM 聚合，但用户的所有手动整理（rename / 拖拽 / merge / split / tier）都被 `locked=1` 保护下来。

需要一个"硬重跑"出口：当用户觉得整理乱了、或者重构后旧聚合完全不合理，想让 LLM 从零开始用 AI 视角重新分析整个项目时使用。

## Decisions (locked in)

| # | Decision |
|---|---|
| Surface | **同一端点 + body 参数**：`POST /api/re-analyze` body `{ reset?: boolean }`。不新建端点。 |
| Reset 范围 | **全清**：所有 `modules` 行 + 所有 `tiers` 行 + 清 `aggregation_fingerprint` / `aggregation_result` meta。 |
| 保留什么 | `files` 表的行保留（路径还在），但 `module_id` 设为 NULL；`edges` 完全不动（文件级，跟模块无关）。 |
| `origin='ai'` 模块 | 也清掉（split 出来的也算手动产物）。 |
| `display_name` / `description` 保护 | 软重跑保留 `diffWithHeuristic` 现有的保护逻辑；硬重跑全清，无视这个保护。 |
| 事务 | wipe + 重建 必须在同一个事务里。失败回滚，不留半空状态。 |
| UI | Toolbar 拆成两个按钮：`↻ Refresh`（软）+ `⟲ Reset all`（硬，confirm 弹窗，文案提示丢失所有手动整理）。或者一个按钮带下拉。 |
| Confirm 文案 | "This will discard all your renames, tier assignments, and module reorganization. The AI will rebuild module structure from scratch. Continue?" |

## What gets cleared

```
DELETE FROM modules                    -- 所有 origin（heuristic / ai / user）
DELETE FROM tiers                      -- 用户自定义层级也清
UPDATE files SET module_id = NULL      -- 解除文件归属
DELETE FROM meta WHERE key IN          -- 清掉聚合缓存指纹
  ('aggregation_fingerprint', 'aggregation_result')
-- edges 不动
```

外键参照：`modules.parent_id → modules.id`、`modules.tier_id → tiers.id`、`files.module_id → modules.id`。删除顺序需要先清 `modules.parent_id`（自引用，但全删时无所谓），再删 `modules`（先于 `tiers` 防止 FK 报错，因为 `tier_id` 引用 `tiers`）。

正确顺序：
1. `UPDATE files SET module_id = NULL`
2. `DELETE FROM modules` （这会断掉所有 `parent_id` 自引用、`tier_id` 引用）
3. `DELETE FROM tiers`
4. `DELETE FROM meta WHERE key IN (...)`

全部包在一个 `db.transaction(...)` 里。

## Architecture

### 1. `src/core/server/api/re-analyze.ts` 改造

```ts
export async function reanalyzeEndpoint(deps: {
  db: Database.Database
  root: string
  analyzers: LanguageAnalyzer[]
  ai: AIProvider | null
  model?: string
  reset?: boolean              // NEW
}): Promise<{ status: string; mode: 'refresh' | 'reset'; added: string[]; removed: string[]; kept: number; aggregation: string }> {
  if (deps.reset) wipeAllStructure(deps.db)

  const files = scanProject(deps.root, deps.analyzers)
  const heuristic = discoverHeuristic(deps.root, files)
  const diff = diffWithHeuristic(deps.db, heuristic)
  const out = await aggregateAndApply(deps.db, deps.ai, heuristic, { force: true, model: deps.model })
  return {
    status: 'ok',
    mode: deps.reset ? 'reset' : 'refresh',
    added: diff.added,
    removed: diff.removed,
    kept: diff.kept.length,
    aggregation: out.status,
  }
}
```

新增小工具（同一个文件，仍在 50 行预算内 —— 当前 21 行）：

```ts
function wipeAllStructure(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE files SET module_id = NULL').run()
    db.prepare('DELETE FROM modules').run()
    db.prepare('DELETE FROM tiers').run()
    db.prepare("DELETE FROM meta WHERE key IN ('aggregation_fingerprint', 'aggregation_result')").run()
  })
  tx()
}
```

注意 wipe 之后流程不变：`scanProject` → `discoverHeuristic` → `diffWithHeuristic`（DB 空，全部走 `added` 分支）→ `aggregateAndApply(force: true)`（无 fingerprint 命中，走 LLM）。

### 2. `src/core/server/http.ts:168-176` 路由改造

读取 body，传 `reset`：

```ts
async function handleReanalyze(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig): Promise<void> {
  const body = (await readJson(req)) as { reset?: boolean }
  try {
    const result = await reanalyzeEndpoint({ db: cfg.db, root: cfg.root, analyzers: cfg.analyzers, ai: cfg.ai, model: cfg.model, reset: body.reset === true })
    cfg.onAfterSplit?.()
    sendJson(res, 200, result)
  } catch (err) {
    sendJson(res, 500, { error: (err as Error).message })
  }
}
```

### 3. `src/ui/api.ts` 新签名

```ts
export async function reanalyzeRequest(opts?: { reset?: boolean }): Promise<{ status: string; mode: 'refresh' | 'reset' }> {
  const r = await fetch('/api/re-analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reset: opts?.reset === true }) })
  if (!r.ok) throw new Error(`re-analyze failed: ${r.status}`)
  return r.json()
}
```

### 4. UI 入口 (`MapView.tsx`)

`Toolbar` 当前一个 `↻` 按钮。改成两个：

```tsx
<button onClick={onReanalyze} title="Refresh — re-detect modules, keep your changes">↻</button>
<button onClick={onResetAll} title="Reset all — discard manual changes, AI rebuilds from scratch" className="...text-red-tinted...">⟲</button>
```

`onResetAll` 实现：

```ts
const onResetAll = useCallback(async () => {
  const ok = confirm('This will discard all your renames, tier assignments, and module reorganization. The AI will rebuild module structure from scratch. Continue?')
  if (!ok) return
  setError(null)
  try { await reanalyzeRequest({ reset: true }) }
  catch (err) { setError((err as Error).message) }
}, [])
```

WebSocket 已有的 `update` push 会自动触发 `load()`，UI 不需要手动 reload。

## Edge cases

| Case | Handling |
|---|---|
| Reset 期间用户拖拽 / split | 服务端在事务里，并发请求会被 SQLite 串行化 —— 后到的 PATCH 在新模块 ID 上跑（旧 ID 已不存在），可能报 404，前端忽略+toast |
| Reset 期间 LLM 调用失败 | `aggregateAndApply` 里 catch 后走 `applyStaticFallback`（按目录命名）—— 用户至少能看到一个干净的启发式结构，不会卡在空状态 |
| 没有 AI provider（`cfg.ai` null） | 同上，走 fallback。`cfg.ai` 在 startServer 是 required，应该不会 null，但 `reanalyzeEndpoint` 签名仍是 `AIProvider | null`，保留兼容 |
| 用户误点 reset | confirm 弹窗，文案明确点出"discard all"。第二次确认（typing "RESET"）感觉过度，先不做 |
| Reset 后没 LLM 钱了 / API 限速 | LLM 失败回到 fallback 状态，所有模块走目录命名。用户可以再点 Refresh 重试 |
| 首次启动数据库为空 + reset | wipe 全跑空操作，然后正常流程跑出新结构。无害 |

## What's *not* changing

- `diffWithHeuristic` 里 `display_name` / `description` 的保护逻辑：软重跑场景这个保护**应当继续生效**（用户改过名的模块即便 unlocked 也保留）。reset 模式不走这条路径，因为 wipe 已经把所有行删了。
- `locked` 字段语义：仍是 PATCH / merge / split 路径写入的"用户已动过"标记。reset 是无视它，不是改它的语义。
- Edges：reset 不动 edges。文件级 edges 跟模块结构正交，重建模块后 aggregation 自动按新 module 边界算 module-level edges。

## Phases

### Phase 1 — 后端 (45min)

1. `re-analyze.ts` 加 `wipeAllStructure` + `reset` 参数
2. `http.ts:handleReanalyze` 读 body 传 `reset`
3. 手动 curl 验证：
   - `curl -X POST localhost:PORT/api/re-analyze -d '{}' -H 'content-type: application/json'` → 软重跑（现有行为）
   - `curl -X POST localhost:PORT/api/re-analyze -d '{"reset":true}' -H 'content-type: application/json'` → 硬重跑

### Phase 2 — 前端 (30min)

4. `api.ts:reanalyzeRequest` 加 `reset` 选项
5. `MapView.tsx:Toolbar` 加第二个按钮
6. `onResetAll` + confirm

### Phase 3 — 验证 (15min)

7. 启动 vizcoo，手动整理一些模块（rename + 拖拽 + 改 tier）
8. 点 Refresh → 验证整理保留
9. 点 Reset → 验证全部恢复成 AI 视角的初始结构、tier 也重新生成
10. `npm run build`

**Total: ~1.5h**

## Done means

- [ ] `POST /api/re-analyze {}` 行为不变（软重跑）
- [ ] `POST /api/re-analyze { reset: true }` 清空 modules + tiers + meta + 解绑 files，再重跑发现+LLM
- [ ] Toolbar 出现第二个按钮，title 文案明确
- [ ] Confirm 弹窗能拦住误点
- [ ] Reset 后数据库状态干净：`SELECT COUNT(*) FROM modules` 等于 LLM 聚合后的数量，没有遗留 `locked=1` 行
- [ ] Edges 数量在 reset 前后不变
- [ ] WebSocket 推送触发 UI 自动刷新，用户不用手动重载页面
- [ ] `npm run build` 通过
- [ ] 错误（LLM 失败、网络失败）不留半空状态：要么完整 reset 成功，要么事务回滚，要么走 static fallback

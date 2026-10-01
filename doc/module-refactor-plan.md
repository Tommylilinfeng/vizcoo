# Module 数据模型重构计划

Date: 2026-04-25

## 重构目标

把当前 `mega / detail / heuristic / ai-mega / ai-split` 的多类型概念统一为**单一 Module**,树形结构由 `parent_id` 决定。文件事件实时驱动 module 表增量更新。Module ID 跨重启稳定,用户/LLM 改过的内容自动保留。

---

## 设计决策(已与用户确认)

| # | 决策 |
|---|---|
| 1 | 数据原语只有 `Module`。一个 Module 可以挂任意 Module 子节点 + 任意 Files 直接子节点。不区分 mega/detail。 |
| 2 | Module ID **跨重启稳定**。不使用 "DELETE-then-INSERT" 重建模式。 |
| 3 | 启发式只在两个时机跑:**(a) 第一次建立**(modules 表为空),**(b) 用户主动 Re-analyze**。 |
| 4 | 中间过程:**文件事件实时驱动**,新文件按目录路径找现有 module 挂接;找不到则立即创建一个新的 module(用路径名)。 |
| 5 | 用户/LLM 改过的 module(`display_name OR description IS NOT NULL`)在 diff 时**保护**,不被启发式覆盖。 |
| 6 | LLM 装饰只写 `display_name` + `description` + `parent_id`。`name` 字段是稳定 key,永远是目录路径(启发式产)或 LLM 起的人话名(LLM 产)。 |
| 7 | Split 操作**统一**:任何有 ≥2 个孩子(modules 或 files)的 node 都可以拆,用户指定 K(2/3/4/5)。结果:原 module 保留,新增 K 个 sub-module 作为它的子节点(深度 +1)。 |
| 8 | 空 module(无 files、无 children)在渲染时**自动跳过**,数据保留。 |
| 9 | 删除目录时,旧 module 自动变空,孤儿渲染处理。重命名目录视为"删 + 加",用户的 LLM 装饰丢失,接受这个代价。 |
| 10 | `origin` 列保留作为内部 diff 逻辑的元数据,但**渲染逻辑绝不分支于 origin**,只看 `parent_id` 和 `children`。新 origin 枚举:`'heuristic' \| 'aggregate' \| 'split' \| 'manual'`。 |

---

## 总览:新流程

```
vizcoo 启动
  ↓
scanProject → 当前文件路径列表
  ↓
processFile loop:
  - UPSERT files 行
  - 重建 edges
  - 关键新逻辑:文件归属决定
      target_dir = twoLevelDir(path)
      module = SELECT id FROM modules WHERE name = target_dir
      if module 找到:
        files.module_id = module.id
      else:
        // 新目录,立刻创建一个 module
        INSERT INTO modules (name=target_dir, origin='heuristic', parent_id=NULL, ...)
        files.module_id = new module.id
        broadcast('module-added')
  ↓
pruneStaleFiles (已有)
  ↓
if modules 表本来是空的(第一次建立):
  跑完整启发式 H = discoverHeuristic(root, files)
  跟"裸创建"的 modules 行做 diff:
    - 启发式说该有 IQR 下钻 → INSERT 新 sub-modules + UPDATE files
    - 启发式说该 tiny-merge → DELETE 该 module + UPDATE files 挂到父
    - 启发式说该有 Foundation → INSERT Foundation module + 把跨切文件挪过去
  跑 LLM aggregateAndApply (装饰 + 分组)
else:
  // 后续启动:module 表已经在,不做大动作
  // aggregateAndApply 走缓存命中路径(若 fingerprint 不变,replay LLM 装饰)
  // 若 fingerprint 变了(说明文件结构有显著变化),也只是更新 LLM 装饰,不破坏树结构

文件 watcher (chokidar) 持续运行:
  add 事件 → processFile 同样的归属决定逻辑
  change 事件 → 只重跑 imports / edges
  delete 事件 → deleteFile + edges prune,空 module 留着不动
  每个事件 → broadcast('update') → UI refetch
```

---

## Schema 变更

### `modules` 表

**字段:**
- `id INTEGER PRIMARY KEY` — 跨重启稳定
- `parent_id INTEGER REFERENCES modules(id)` — 任意嵌套
- `name TEXT NOT NULL` — 稳定 key:目录路径(`src/core/storage`)或 LLM 起的人话名(`Foundation`)
- `display_name TEXT` — LLM 起的人话名(可叠加在 name 之上)
- `description TEXT` — LLM 一行描述
- `origin TEXT NOT NULL` — `'heuristic' | 'aggregate' | 'split' | 'manual'`(无 CHECK 约束,TS 校验)
- `created_at TEXT`
- `key_exports TEXT` — JSON array(可选)
- `dir_paths TEXT` — JSON array(可选)

**保留 `origin` 但语义变了:**
- `heuristic` — 启发式产出(name = 目录路径,稳定)
- `aggregate` — LLM aggregate 产出的顶层组(name = 人话名,LLM 决定)
- `split` — 用户/LLM split 产出的子组(name = 人话名)
- `manual` — V0.2 用户手动创建的(暂时不用)

**渲染逻辑禁止 branch on origin。**仅用于:
- replaceHeuristic 知道哪些行是它管的
- aggregateAndApply 知道哪些行是它管的
- diff 时知道哪些是机器货可被改写

### `files` 表

无变更(已有 `module_id NULL` 支持 orphan)。

### `edges` 表

无变更。

### `meta` 表

无变更(aggregation_fingerprint + aggregation_result 继续用)。

### 迁移

旧 DB 有可能存在的状态:
- `origin = 'ai-mega'` → 改名为 `'aggregate'`
- `origin = 'ai-split'` → 改名为 `'split'`
- `origin = 'heuristic'` → 不变

迁移代码:`UPDATE modules SET origin = 'aggregate' WHERE origin = 'ai-mega'; UPDATE modules SET origin = 'split' WHERE origin = 'ai-split';`

---

## 文件改动清单

### 1. `src/core/storage/db.ts`
- 加一段 origin 重命名迁移
- 已有的 rebuildIfOldOriginCheck 可保留(但要确保新 schema 不带 CHECK)

### 2. `src/core/storage/schema.sql`
- 已经没 CHECK 了,确认 origin 列还在
- 无大改

### 3. `src/core/modules/discover-heuristic.ts`
**无改动。** 继续返回 `HeuristicModule[]`。

### 4. `src/core/modules/classify.ts`
**重写。**之前是"擦掉旧的 + 写新的",新版本是:
```ts
classifyProject(db, root, files, detectors): { detectorResult, isFirstRun: boolean }
  // 不再调 replaceHeuristic
  // 框架检测器还跑(返回 winner)
  // 启发式只是产 H,但 classifyProject 本身不写库
  // 写库的事交给上层 indexProject 决定(根据是否第一次)
```

### 5. `src/core/modules/tree.ts`
**整体替换为 `module-sync.ts`。** 主要导出三个函数:

```ts
// 第一次建立时调
seedFromHeuristic(db, heuristic: HeuristicModule[]): void
  // INSERT 启发式所有 module + UPDATE files.module_id

// re-analyze 时调
diffWithHeuristic(db, heuristic: HeuristicModule[]): { added, removed, kept }
  // 按 name 匹配:
  //   - H 有 D 没有 → INSERT
  //   - D 有 H 没有 → 检查 origin 和 display_name:
  //       - origin = 'heuristic' AND display_name IS NULL → DELETE (孤儿文件挂到父或 NULL)
  //       - 其他 → 保留
  //   - 都有 → 不动 id,只更新 dir_paths/key_exports

// processFile 增量调
findOrCreateModule(db, path: string): number
  // SELECT WHERE name = twoLevelDir(path)
  // 找到返回 id
  // 没找到 INSERT 新行,返回新 id
```

老的 `replaceHeuristic` 删除。

### 6. `src/core/modules/aggregate-and-apply.ts`
**改 UPDATE 而非 DELETE+INSERT。**

```ts
// 之前:
DELETE FROM modules WHERE origin = 'ai-mega'
INSERT new megas
UPDATE detail rows

// 之后:
对于每个 LLM 输出的 mega:
  SELECT id FROM modules WHERE name = mega.name AND origin = 'aggregate'
  if 找到: UPDATE display_name/description (如有变化)
  if 没找到: INSERT 新 mega 行 (origin='aggregate')
对于每个 detail:
  UPDATE display_name, description, parent_id (parent_id 指向对应 mega 的 id)
对于 LLM 没列的旧 mega:
  DELETE FROM modules WHERE origin = 'aggregate' AND id NOT IN (...)
```

### 7. `src/core/modules/persist-aggregation.ts`
跟着 aggregate-and-apply 一起改。

### 8. `src/core/modules/static-fallback.ts`
同样改 UPDATE-or-INSERT。删除 `DELETE FROM modules WHERE origin = 'ai-mega'`。

### 9. `src/core/modules/split.ts`
**重写。**接受 `count` 参数,统一处理 children/files。

```ts
splitModule(input: {
  db, root, moduleId, ai, count, model?, analyzers
}): SplitResult
  
  target = SELECT * WHERE id = moduleId
  childModules = SELECT * FROM modules WHERE parent_id = moduleId
  childFiles = SELECT path FROM files WHERE module_id = moduleId
  items = childModules ++ childFiles
  
  if items.length < 2: throw
  if items.length < count: throw "cannot split N items into K > N groups"
  
  prompt = buildSplitPrompt(target.name, items, count, root, analyzers)
  raw = await ai.complete(prompt)
  parsed = parseSplitResponse(raw)
  validate(parsed, items, count)
  
  // 核心写库逻辑:保留原 module,加深一层
  in tx:
    for each group in parsed.subModules:
      INSERT INTO modules (parent_id=moduleId, origin='split', name=group.name, display_name=group.name)
      newId = lastInsertRowid
      for each item in group:
        if item is module: UPDATE modules SET parent_id = newId WHERE id = item.id
        if item is file:   UPDATE files   SET module_id = newId WHERE path = item.path
  
  return { subModules: [...] }
```

Prompt 区分 children 模式和 files 模式。Children 给 LLM 看 child 模块的 name + display_name + description;files 给 LLM 看 path + exports。

### 10. `src/core/index-project.ts`
**主要改动。**

```ts
indexProject(root, db, analyzers, options):
  for each analyzer: init
  files = scanProject(root, analyzers)
  pruneStaleFiles(db, files)
  
  isFirstRun = SELECT COUNT(*) FROM modules == 0
  
  for each file:
    processFile(db, root, file, analyzers)  // 写 files + edges
  
  // processFile 内部的 module 归属决定:
  //   if 已在 DB 有 module 名字 = 该 file 的 twoLevelDir → 挂上
  //   else → 创建一个新 module 用路径名,挂上
  // 所以 first run 时,处理完所有文件后,modules 表已经填好(每个目录一个)
  
  if isFirstRun:
    // refine:跑完整启发式做一次 IQR + tiny-merge + Foundation 整理
    H = discoverHeuristic(root, files)
    refineHeuristic(db, H)  // 把"裸目录-1-module"重组成 H 的形状
  
  // aggregate 走缓存或 LLM
  fingerprint = computeFingerprint(从 DB 读 module names)
  cached = readMeta('aggregation_fingerprint')
  if cached === fingerprint AND 'aggregation_result' 在:
    replayAggregation(...)  // 注意改成 UPDATE-or-INSERT
  else if ai 可用:
    LLM call → applyAggregation(...)
  else:
    applyStaticFallback(...)
```

`processFile` 改造:
```ts
processFile(db, root, relPath, analyzers): edgeCount
  analyzer = ...
  if !analyzer: return 0
  if !exists(absPath): deleteFile(db, relPath); return 0
  source = read(absPath)
  
  // 决定 module_id
  moduleId = findOrCreateModule(db, relPath)
  
  INSERT INTO files (path, module_id) VALUES (?, ?) ON CONFLICT UPDATE module_id = excluded.module_id
  
  // 但要小心:如果该文件之前已挂在某 module 下(用户/LLM 改过的 module),不要覆盖
  // 简单做法:INSERT OR IGNORE,只在新文件时设 module_id
  // 后处理:文件归属"重新挂接"只在 isFirstRun 或 re-analyze 时做
  
  imports = analyzer.extractImports(source, relPath)
  edges = edgesFromImports(...)
  replaceEdgesForFile(db, relPath, edges)
  return edges.length
```

### 11. `src/core/server/api/tree.ts`
- 输出去掉 `origin` 字段(或保留但 UI 不用)
- 排序保持当前逻辑

### 12. `src/core/server/api/split.ts`
- 接受 `{ moduleId, count }` body
- 调新版 splitModule

### 13. `src/core/server/api/re-analyze.ts` (新)
- POST endpoint
- 调 `discoverHeuristic` + `diffWithHeuristic` + `aggregateAndApply` (force=true)
- 返回 `{ status, diff: { added, removed, kept } }`

### 14. `src/core/server/http.ts`
- 注册 `/api/re-analyze`

### 15. `src/ui/api.ts`
- `Module` 类型去掉 `origin` 字段(若 server 也不再返回)
- `splitModuleRequest(moduleId, count)` 接受 count
- 加 `reanalyzeRequest()`

### 16. `src/ui/arch/types.ts`
- `ArchNode.origin` 字段保留(如果仍输出)但不用作渲染分支
- 新加的 module 类型不需要

### 17. `src/ui/arch/ArchScene.tsx`
- 删除任何 `origin === 'ai-mega'` 这种分支,改为 `parent_id IS NULL` 判断 floor
- 渲染逻辑全靠 tree 结构

### 18. `src/ui/MapView.tsx`
**主要改动。**
- DetailPanel 中的 "Split with AI" 显示条件:`children.length >= 2 OR fileCount >= 2`(任何有 ≥2 子项的 node)
- 加 K 选择器:点 split → 弹一个小 popover,4 按钮 "Split into 2 / 3 / 4 / 5"
- 加 "Re-analyze" 按钮(放在工具栏的 ⚙ 旁边或者 settings 里)

### 19. `src/ui/SettingsModal.tsx` 或 工具栏
- 加 Re-analyze 按钮 + 当前 module/file count 提示

---

## 执行顺序(按依赖关系)

### Phase 1:Schema + 基础迁移(15 分钟)
1. 更新 `schema.sql`(确认 origin 列保留,无 CHECK)
2. `db.ts` 加 origin 重命名迁移('ai-mega' → 'aggregate', 'ai-split' → 'split')
3. typecheck + 启动验证旧 DB 迁移正确

### Phase 2:`module-sync.ts` 新文件(30 分钟)
4. 创建 `src/core/modules/module-sync.ts`,实现:
   - `seedFromHeuristic(db, heuristic)`
   - `diffWithHeuristic(db, heuristic)`
   - `findOrCreateModule(db, path)` (供 processFile 用)
   - `refineHeuristic(db, heuristic)` (供 first-run 调用)
5. 删除 `tree.ts` 的 `replaceHeuristic`,改成只导出 helper

### Phase 3:processFile 增量逻辑(20 分钟)
6. 修改 `index-project.ts processFile`,改为 find-or-create 模式
7. 修改 `index-project.ts indexProject` 加 isFirstRun 检测 + refineHeuristic
8. 验证:vizcoo 启动 + 文件 add/delete/rename 实时反映

### Phase 4:aggregateAndApply 改 UPDATE(30 分钟)
9. 改写 `persist-aggregation.ts` 为 UPDATE-or-INSERT
10. 改写 `aggregate-and-apply.ts` (cache 路径调用新版 apply)
11. 改写 `static-fallback.ts` 同样 UPDATE-or-INSERT
12. 验证:重启不破坏 module id

### Phase 5:Split 重写(45 分钟)
13. 改写 `split.ts`:接受 count + 处理 children/files 统一
14. 改写 `api/split.ts` endpoint
15. 改写 prompt(区分 children mode 和 files mode)
16. 测试:拆 mega 成功;拆 detail 成功;count 验证

### Phase 6:Re-analyze endpoint(15 分钟)
17. 创建 `api/re-analyze.ts`
18. 注册到 `http.ts`
19. UI api 加 `reanalyzeRequest`

### Phase 7:UI 改动(30 分钟)
20. 删除 ArchScene 中 `origin` 分支(只看 parent_id)
21. MapView DetailPanel:Split 条件改 + 加 K 选择器
22. 工具栏加 Re-analyze 按钮(简单版,有 confirm)
23. 验证视觉无回归

### Phase 8:验证 + 测试(15 分钟)
24. typecheck
25. vite build
26. 4 个 puppeteer 测试
27. 大型测试仓实测:启动后改文件 → Map 实时反映;拆 mega 成功

**总工时估计:3.5-4 小时。**

---

## 测试场景

### 启动场景
- **场景 A:全新 DB** — 第一次扫描,modules 从 0 到 113 个,显示 Map
- **场景 B:已有 DB** — 重启,id 全部稳定,LLM 装饰保留
- **场景 C:有 ai-mega/ai-split 旧 DB** — 迁移后变成 'aggregate' / 'split',功能不变

### 实时事件
- **场景 D:在已有目录加新文件** — files 表新增,挂到现有 module,Map 上 chip 略变大
- **场景 E:加新目录的第一个文件** — 立即创建新 module,Map 上多一个楼板(无 LLM 装饰,显示路径名)
- **场景 F:删一个文件** — files 表删,edges prune,module 留着;若该 module 因此变空,渲染时跳过
- **场景 G:删整个目录的所有文件** — module 变空,渲染跳过
- **场景 H:重命名目录** — 旧 module 变空 + 新 module 出现,LLM 装饰丢失(已知代价)

### Split
- **场景 I:拆 mega 成 K=2** — mega 保留,新增 2 个 sub-mega,detail 重新分配 parent_id
- **场景 J:拆 detail 成 K=3** — detail 保留,新增 3 个子模块,文件重新分配 module_id
- **场景 K:拆已经被拆过的 sub-module** — 又加一层,深度递归
- **场景 L:K > items 数** — 报错"cannot split into more groups than items"

### Re-analyze
- **场景 M:用户拆完后 Re-analyze** — 启发式重跑,新加的目录被识别;用户的 split sub-modules 因 origin='split' 被保留;LLM 装饰保留
- **场景 N:Re-analyze 时启发式说应删某 module(空目录)** — display_name 为空才删,有 display_name 的保留

---

## 风险点

1. **Cache fingerprint 改变** — 老 fingerprint 是基于 module names。新模型下,refineHeuristic 之后的 module names 跟启发式直接产的不一样(IQR 下钻、tiny-merge 后的 names)。需要验证 fingerprint 仍稳定。
2. **applyAggregation 的 UPDATE 路径** — 旧版 DELETE+INSERT 简单,UPDATE 路径有几个坑(LLM 给的 mega 名字跨运行不稳定 → 找不到现有行 → INSERT 新的 + DELETE 旧的)。最坏情况就退化到 DELETE+INSERT,语义不变,id 仍然变。先实现简单版,后续优化稳定 id。
3. **processFile 内部决定 module_id 不能覆盖用户已改的归属** — V0.1 没"用户改文件归属"UI,所以暂时安全。
4. **首次启动的 refineHeuristic** — 它要把"按目录路径裸创建的 module 树"重组成启发式想要的形状(IQR 下钻 + tiny-merge + Foundation)。这是个真实的 diff 实现,比启动 diff 复杂一些。

---

## V0.2 预留

- 用户重命名 module(`name_locked` 列或类似)
- 用户拖动 module 调整 parent_id(`assignment_origin` 列)
- 用户手动移动文件归属
- 智能识别"目录重命名"
- LLM 自动装饰新出现的 module(后台延迟调用)

---

## 不在范围内

- 文件大小拆分(用户已 override)
- 重命名 `tree.ts` → `module-sync.ts` 是这次的一部分,不另算
- 命名空间冲突(启发式 name = 目录路径,LLM name = 人话名,空间天然不重合)
- View 路由的任何改动
- arch 渲染的视觉调整(已经在做的另一个任务)

---

## 完成标准

- typecheck 通过
- vite build 通过
- 4 个 puppeteer 测试中,test:map-nav 和 test:settings 通过
- 实测:vizcoo 启动后,在终端执行 `touch <project>/src/<new-dir>/new.ts` 后 1 秒内,Map 上有反应(新 module 出现或现有 chip 变化)
- Module ID 在重启后保持稳定(SELECT id FROM modules 跑两次,id 集合一致)
- splitModule 接受 mega 节点
- splitModule 接受 count 参数

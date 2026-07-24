# 记忆助手 v11 行为规格文档（扇贝单词算法对齐版）

> 依据：扇贝官方《学习记忆曲线》(web.shanbay.com)、百度经验扇贝复习说明、扇贝产品说明站、今日头条算法测评；对齐 v10 主理人已核实逻辑。
> 本文件只规定**确定行为**，不含实现代码。所有结论均为终态，无"待定"。

---

## 全局常量（确定性，v11 统一使用）

| 常量 | 值 | 说明 |
|------|----|------|
| `EF_INIT` | 2.5 | 易度因子初始值（新卡与迁移卡统一） |
| `EF_FLOOR` | 1.3 | EF 下限（SM-2 标准，不低于此） |
| `EF_CAP` | 3.0 | EF 上限（防止间隔失控增长） |
| `EF_DELTA.认识` | +0.2 | 每次"认识"后 EF 增量 |
| `EF_DELTA.模糊` | −0.2 | 每次"模糊"后 EF 减量 |
| `EF_DELTA.不认识` | −0.4 | 每次"不认识"后 EF 减量 |
| `WEAK_DISCOUNT` | 0.6 | "认识"时若 `weakStreak>=2`，间隔 ×0.6（下限 1 天） |
| `LAPSE_REPEATS_CAP` | 3 | "不认识"当天最多再穿插出现次数（当前这次之外再 2–3 次） |
| `VAGUE_REPEATS_CAP` | 2 | "模糊"当天最多再穿插出现次数 |
| `LAPSE_GAP` | randInt(3,5) | "不认识"重插位置：当前索引 + gap（中间偏前） |
| `VAGUE_GAP` | randInt(5,8) | "模糊"重插位置：当前索引 + gap（更靠后=更轻） |
| `MASTERED_STEPS` | [90, 180] | 已掌握后超长间隔插空巩固（天） |
| `INTERVALS` | [1,2,4,7,15,30,60] | **仅**用于：存量迁移映射(F)、stageLabel/统计分桶显示回退；**不再参与 nextReview 计算** |
| `APP_VERSION` | 11 | 版本号 |
| `version.json.version` | 11 | 线上版本号 |
| `sw.js` 注册串 | `'sw.js?v=12'` | 缓存破击（v10 用 v=11，v11 递增） |
| `MAX_FORCE_RELOAD` | 2 | 强制刷新上限，保持 v10（防死循环） |

**按钮语义对齐**（内部 `rating` key 不变，仅 UI 文案对齐扇贝）：
- `forgot` → 显示「不认识」（😰）= 扇贝"不认识"
- `vague` → 显示「模糊」（🤨）= 扇贝"模糊/提示一下"
- `remembered` → 显示「认识」（😎）= 扇贝"认识"

---

## A. EF（易度因子，SM-2）引入方案

**A1. 是否用 EF 替换离散 INTERVALS？**
是。v11 起 `nextReview` 由 `EF + rep` 连续计算，`INTERVALS` 不再驱动间隔。
`INTERVALS` 仅保留于三处：① 存量迁移映射（F）；② `stageLabel`/统计分桶显示回退；③ 旧备份兼容。

**A2. EF 初始值**：`2.5`（新卡与迁移卡统一）。

**A3. 各评分对 EF 的调整**（每次评分后 clamp 到 `[1.3, 3.0]`）：
- 认识（remembered）：`EF += 0.2`
- 模糊（vague）：`EF −= 0.2`
- 不认识（forgot）：`EF −= 0.4`
（模糊降幅 0.2 < 不认识降幅 0.4，实现"模糊比不认识轻一档"。）

**A4. 间隔由 EF 计算（SM-2 连续公式）**：
- `rep` = 连续"认识"次数；"不认识"/"模糊"时 `rep` 清零为 0。
- 首轮（`rep` 由 0→1）：`interval = 1` 天。
- 次轮（`rep == 2`）：`interval = 6` 天（SM-2 固定二阶间隔）。
- 三轮及以上（`rep >= 3`）：`interval = max(1, round(prevInterval × EF))`，`prevInterval` 为上次调度间隔。
- 弱项打折：若"认识"时 `weakStreak >= 2`，`interval = max(1, round(interval × 0.6))`。
- 已掌握阶梯：当计算所得 `interval >= 60`（即走完基础进度）时进入 `MASTERED_STEPS=[90,180]`（见 D）。

**A5. 与现有 `stage` / `weakStreak` 的共存关系**：
- `stage`：**保留为派生显示字段**，由 `rep`/`mastered` 计算，不再决定 `nextReview`。
  - 新卡：`stage = 0`
  - 未掌握：`stage = min(rep, 6)`
  - 已掌握：`stage = 7`（✅ 已掌握）
- `weakStreak`：**保留，语义不变**（认识 −2 不穿 0；模糊 +1；不认识 +1），专用于 🔥 待攻克 筛选与队列置顶，与 EF 并存互补，不被替代（详见 E）。

---

## B. 「不认识」→ 当天穿插反复出现直到认识

**评分即时效果**：
- `EF −= 0.4`（clamp `[1.3,3.0]`）
- `rep = 0`
- `weakStreak += 1`
- `nextReview = 明天`（`now + 1天`，幂等：每次"不认识"都重设为明天）

**当天重插（穿插，非立即、非仅一次）**：
- 重插条件：本卡"今日不认识计数"（从 `reviewLog` 统计 `date==today && rating=='forgot'` 的条数）`< LAPSE_REPEATS_CAP(3)`。
- 重插位置：`reviewQueue` 中当前索引 `+ randInt(3,5)`（中间偏前，确保"穿插"而非"立刻重来"）。
- 终止条件：用户给出"认识"即停止重插并转入间隔调度；或当日"不认识"计数达 3 后停止当日重插（明日仍复习）。

**结论**：不认识后当天再出现 **2–3 次**（穿插于 3–5 张其他卡之间），直至认识或达到当日上限。删除 v10"插队首立即再考 1 次"逻辑。

---

## C. 「模糊」→ 反复直至掌握（比不认识轻一档）

**评分即时效果**：
- `EF −= 0.2`（clamp `[1.3,3.0]`）— 降幅小于不认识(0.4)
- `rep = 0`
- `weakStreak += 1`
- `nextReview = 明天`（`now + 1天`，幂等）

**档位区分（模糊 vs 不认识）**：
- EF 降幅：模糊 −0.2 < 不认识 −0.4。
- 当日重插次数：模糊最多 1–2 次（`VAGUE_REPEATS_CAP=2`）< 不认识 2–3 次（3）。
- 重插位置更靠后：模糊 `gap = randInt(5,8)`（比不认识的 3–5 更靠后=更轻）。

**当天重插**：
- 条件：本卡"今日模糊计数"（`reviewLog` 中 `date==today && rating=='vague'`）`< 2`。
- 位置：当前索引 `+ randInt(5,8)`。
- 第 1、2 次模糊各重插一次；第 3 次模糊起当日停止重插。

**"反复直至掌握"判定**：
- 沿用 EF 自适应：模糊使 EF 下降、`rep` 清零、明日仍到期，因此**跨日持续出现**，直至用户给出"认识"（认识后 `rep+1`、`EF+0.2`、按 A 调度间隔）。
- 即"直至掌握"由 `EF + 明日到期` 实现，而非 v10 的"第 2 次模糊就停今天"。**删除 v10"第2次模糊停今天"逻辑。**

---

## D. 「认识」→ 进间隔 + EF 调整 + 已掌握超长间隔

**评分即时效果**：
- `EF += 0.2`（clamp `[1.3,3.0]`）
- `rep += 1`
- `weakStreak = max(0, weakStreak − 2)`（SM-2 退 2 级不归零，与 v10 一致）
- 当天不再出现（不重插）

**间隔计算**（按 A.4）：`rep1→1天`；`rep2→6天`；`rep≥3→round(prev×EF)`；弱项 `×0.6`。

**已掌握超长间隔（照搬扇贝）**：
- 引入 `MASTERED_STEPS = [90, 180]`。
- 当计算所得 `interval >= 60` 时：置 `mastered=true`、`masteredStep=0`、`interval=90`（首次超长）。
- 已掌握卡再次"认识"：`masteredStep = min(masteredStep+1, 1)`，`interval = MASTERED_STEPS[masteredStep]`（90→180→180 封顶，不再无限增长，对应扇贝"低频插空巩固"）。
- 已掌握卡若被"不认识/模糊"击穿：`mastered=false`、`masteredStep=0`、`rep=0`，按 B/C 重入"反复出现直至掌握"流程。
- "熟悉度高拉长间隔、低频插空巩固"由 ① 高 EF→长 interval 与 ② `MASTERED_STEPS` 共同实现，无需额外机制。

---

## E. weakStreak 与 EF 的关系 / 🔥 待攻克

**结论**：保留 `weakStreak` 作为 🔥 待攻克 的**唯一判定字段**，不改用 EF 阈值。

**阈值**：`weakStreak >= 2`（与 v10 完全一致）。

**用途（与 v10 一致，保持不变）**：
- 笔记列表 / 复习页 "🔥 待攻克" 筛选：`weakStreak >= 2`。
- 卡片角标：`weakBadge = weakStreak>=2 ? '🔥 ' : ''`。
- 队列置顶：`weakStreak >= 2` 的卡排队列首（其余 shuffle）。

**weakStreak 与 EF 同步更新规则（每评分后）**：
- 认识：`weakStreak = max(0, weakStreak − 2)`
- 模糊：`weakStreak += 1`
- 不认识：`weakStreak += 1`

**关系定位**：EF 负责"下次间隔长短 / 出现频率"；`weakStreak` 负责"是否标记待攻克"。两者并存，`weakStreak` 不被 EF 替代。

---

## F. 存量数据迁移（旧笔记无 ef 字段）

**触发**：v11 `init()` 遍历全库，凡缺 `ef` 字段的笔记执行迁移（v10 已用同类迁移补 `category`/`reviewLog`）。

**逐字段初始化**：
- `ef = 2.5`（统一初值）。
- 由旧 `stage` 推导 `rep`：
  - `stage==0`（且 `reviewCount==0`）：`rep = 0`（新学）
  - `stage ∈ [1,6]`：`rep = stage`
  - `stage >= 7`（原已掌握）：`rep = 6`，`mastered = true`，`masteredStep = 0`
- `interval`（天）由旧 `stage` 推导（保持原节奏，连续过渡）：
  - `stage ∈ [0,6]`：`interval = INTERVALS[stage]`（`stage0→1`）
  - 原已掌握：`interval = 90`（`MASTERED_STEPS[0]`）
- `mastered`：原 `stage>=7 → true` 且 `masteredStep=0`；否则 `false`。
- `masteredStep`：默认 `0`。
- `weakStreak`：保留旧值；若旧值 `undefined → 0`。
- `nextReview` / `reviewLog` / `reviewCount` / `category` / `front` / `back` / `content`：原样保留，不动。
- `stage`：重写为派生值（= 推导后的 `rep` 或 `7`），与 v11 显示一致。

**完成判据**：写入 `ef` 后即视为已迁移（以 `ef !== undefined` 为判据，无需额外 flag）。

**保证**：不删除、不覆盖任何用户笔记与学习进度；`nextReview` 不变 → 升级后到期行为合理；EF 调度自下一次评分生效。

**DB 结构**：仅向 `notes` 对象新增属性，无需改 objectStore / 索引；`DB_VER` 可保持 3（非必须）。`APP_VERSION → 11`。

---

## G. 配比 1:3 是否引入

**结论**：不硬引入 1:3 强制配比，也不加全局 50–100 日总量上限；保持 v10 "复习不限量 + 新卡按分类限额" 策略。

**保留项**：
- 复习卡不限量（到期即出，保障"不丢复习"）。
- 新卡每分类日限额（默认 30，用户可自定义）保持不变。

**新增（软提示，非限制）**：
- 复习页仪表盘展示「新学 X · 复习 Y · 配比≈1:N」，让用户自行参考扇贝 1:3 节奏调节。

**理由**：
1. 个人自用工具，用户已习惯"到期全清"，硬上限会导致到期卡滚存累积，违背核心"不丢复习"承诺。
2. 扇贝的 1:3 与 50–100 上限是为保护大规模用户的注意力/防疲劳；个人工具无此约束，且"复习不限量"反而更贴合艾宾浩斯"及时复习"原则。
3. 仅以软提示传递扇贝配比理念，不牺牲灵活性。

---

## H. v11 相对 v10 逐条行为变更清单

1. **新增字段**：`ef` / `rep` / `interval` / `mastered` / `masteredStep`（notes 对象）；`stage` 改为派生显示字段。
2. **删除离散 INTERVALS 对 nextReview 的驱动**；改为 `EF+rep` 连续计算（`rep1→1天`, `rep2→6天`, `rep≥3→round(prev×EF)`）。
3. **EF 初值 2.5**，每次评分调整：认识 +0.2 / 模糊 −0.2 / 不认识 −0.4，clamp `[1.3,3.0]`。
4. **不认识**：由"插队首立即再考 1 次"改为"当天穿插 2–3 次（gap 3–5），明日必复习，直至认识"。
5. **模糊**：由"第1次插中间、第2次停今天"改为"当天穿插 1–2 次（gap 5–8），明日必复习，跨日反复直至认识（走 EF 自适应）"。
6. **认识**：新增 `EF+0.2`、`rep+1`；间隔按 EF 连续计算；弱项(`weakStreak>=2`)仍 ×0.6；原 stage 推进逻辑改为 rep 推进。
7. **新增已掌握阶梯** `MASTERED_STEPS=[90,180]`：`interval>=60` 进入，再次认识 90→180→180 封顶；被不认识/模糊击穿则退出重练。
8. **🔥 待攻克**：保留 `weakStreak>=2` 判定与队列置顶，语义不变；新增 `weakStreak` 与 EF 同步更新规则。
9. **按钮文案对齐扇贝**：显示「不认识 / 模糊 / 认识」（内部 `rating` key 保持 `forgot/vague/remembered` 不变，保证 `reviewLog` 兼容）。
10. **卡片/列表新增"熟悉度"展示**（由 `ef` 映射 1–5 级：`familiarity = clamp(round((ef-1.3)/(3.0-1.3)*4)+1, 1, 5)`），替代旧纯 stage 天数展示；`stageLabel` 显示改用 `note.interval` 天数。
11. **迁移**：`init` 补 `ef` 等字段（F），`nextReview` 不动；`APP_VERSION→11`、`version.json→11`、`sw.js?v=12`。
12. **配比**：复习不限量 + 新卡分类限额保持；新增软提示 1:N 配比展示；无全局上限。
13. **撤销(undo)与重插**：重插机制通用化（按 rating 决定 是否重插 / 次数上限 / gap）；undo 仍需正确移除当日重插副本（同 v10 思路）。
14. **统计页**：进度分桶改为基于 `rep`/`mastered`（或沿用派生 stage），可附带 ef 分布；其余不变。

---

## 实现者检查清单

- [ ] `notes` 对象新增 `ef` / `rep` / `interval` / `mastered` / `masteredStep` 五个字段；`stage` 改为派生。
- [ ] 定义常量：`EF_INIT=2.5`, `EF_FLOOR=1.3`, `EF_CAP=3.0`, `EF_DELTA{认识:+0.2,模糊:−0.2,不认识:−0.4}`, `WEAK_DISCOUNT=0.6`, `LAPSE_REPEATS_CAP=3`, `VAGUE_REPEATS_CAP=2`, `LAPSE_GAP∈[3,5]`, `VAGUE_GAP∈[5,8]`, `MASTERED_STEPS=[90,180]`。
- [ ] `rateCard` 重写三分支：
  - [ ] 认识：`ef+=0.2`(clamp)；`rep+=1`；`weakStreak=max(0,weak−2)`；不重插；按 A.4 算 `interval`（`rep1→1`, `rep2→6`, `rep≥3→round(prev×ef)`；`weak>=2` 则 ×0.6）；mastered 阶梯处理；`nextReview=now+interval`。
  - [ ] 模糊：`ef−=0.2`；`rep=0`；`weakStreak+=1`；`nextReview=明天`；若今日模糊计数 < 2 则重插 `gap∈[5,8]`。
  - [ ] 不认识：`ef−=0.4`；`rep=0`；`weakStreak+=1`；`nextReview=明天`；若今日不认识计数 < 3 则重插 `gap∈[3,5]`。
- [ ] `reviewLog` 记录 `{date,rating}`（沿用）；今日计数从 `reviewLog` 按 `date==today` 统计。
- [ ] 重插通用函数：参数(是否重插, 次数上限, gap 范围)，同 v10 `splice` 思路；当日副本可被 undo 移除。
- [ ] 队列构建：`weakStreak>=2` 置顶，其余 shuffle（沿用 v10）。
- [ ] 🔥 筛选 / 角标 / 置顶：全部基于 `weakStreak>=2`（沿用）。
- [ ] 卡片展示：显示 `note.interval` 天（非 `INTERVALS[stage]`）；新增熟悉度 1–5 级（由 `ef` 映射）。
- [ ] 按钮文案：不认识 / 模糊 / 认识（`rating` key 不变）。
- [ ] `init` 迁移：补 `ef=2.5`、`rep`/`interval`/`mastered` 由旧 `stage` 推导、`weakStreak` 保留/补 0、`nextReview` 不动；写入后 `ef!==undefined` 即完成。
- [ ] `APP_VERSION=11`；`version.json=11`；`sw.js?v=12`；`MAX_FORCE_RELOAD=2` 保持。
- [ ] 配比：复习不限量 + 分类新卡限额保持；仪表盘新增 1:N 软提示；无全局上限。
- [ ] 统计页：进度分桶适配 `rep`/`mastered`（或派生 stage），可加 `ef` 分布。
- [ ] 回归：旧备份 JSON 导入不覆盖学习进度（沿用）；导出含新字段。
- [ ] 边界：`ef` clamp 不越 `[1.3,3.0]`；`interval` 最小 1；重插上限防死循环；已掌握被击穿正确重置。

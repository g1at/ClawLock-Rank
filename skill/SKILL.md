---
name: clawlock-rank
description: >
  基于 ClawLock 体检结果构建的排行榜上传技能。
  当用户明确想上传安全分、上报体检分数、同步排行榜成绩时触发：
  「上传安全分」「上传安全体检分数」「上传排行榜」「上报安全分」「提交体检成绩」
  「把体检结果传到排行榜」「同步安全分到 ClawLockRank」「upload score」「submit leaderboard score」
  Do NOT trigger for general security scans, normal Claw usage, debugging, or leaderboard browsing without upload intent.
version: 0.1.0
metadata:
  openclaw:
    emoji: "📊"
    homepage: "https://github.com/g1at/ClawLock-Rank"
    skillKey: "clawlock-rank"
    os: [linux, macos, windows]
    requires:
      bins:
        - clawlock
        - python
      anyBins:
        - python3
        - python
      config:
        - config.json
---

# ClawLockRank

基于 ClawLock 体检结果构建的排行榜上传技能。面向“本地体检后，自愿上传分数到排行榜”的场景。

[English Version → SKILL_EN.md](SKILL_EN.md)

---

## 安装与使用

```bash
python scripts/submit_score.py
```

作为 Claw Skill 安装：复制本文件到 skills 目录后，在对话中说：

- 「上传安全分」
- 「上传体检分数」
- 「把这次体检结果传到排行榜」
- 「同步我的 ClawLock 安全分到 ClawLockRank」

---

## 隐私声明

本技能默认先在**本地**执行 `clawlock scan --format json`，只有在用户明确确认后才会发起网络上传。

| 场景 | 上传内容 | 明确不会上传 |
|------|----------|--------------|
| 排行榜分数上传 | `tool`、`clawlock_version`、`adapter`、`adapter_version`、`device_fingerprint`、`score`、`grade`、`nickname`、`findings[].scanner`、`findings[].level`、`findings[].title`、`timestamp` | 原始配置文件、修复建议、文件路径 / location、环境变量、完整原始报告、`scan_history.json` |

设备指纹说明：

- 原始 `device_fingerprint` 只发送给排行榜 Worker
- Worker 在服务端用 salt 哈希后再入库
- 前端不会公开展示原始设备指纹

---

## 触发边界

只在“用户明确要上传排行榜成绩”时触发：

| 用户意图 | 是否触发 |
|---------|---------|
| 上传安全分 / 上传体检分数 / 提交排行榜成绩 | 触发 |
| 本地安全体检，但未提到上传 | 不触发 |
| 查看排行榜网页 | 不触发 |
| 普通 Claw 调试、编码、安装依赖 | 不触发 |

如果用户只是说“开始安全体检”，应该优先交给 ClawLock 主技能；只有在用户明确提到“上传分数 / 排行榜 / 上报成绩”时才启用本技能。

---

## 执行流程

启动后按以下流程执行：

1. 本地运行 `clawlock scan --format json`
2. 从扫描结果里裁剪出最小化上传 payload
3. 展示公开摘要：
   - 分数
   - 等级
   - 适配器与版本
   - 发现项数量
   - 将要公开上传的字段
4. 先询问用户想公开显示的昵称
   - 留空时使用 `Anonymous`
5. 再询问用户是否上传
6. 如果用户同意，再上传到 ClawLockRank

默认入口：

```bash
python scripts/submit_score.py
```

推荐对话顺序：

1. 告诉用户排行榜会公开显示一个昵称
2. 询问用户要展示的昵称，允许留空
3. 展示上传预览
4. 再做最终上传确认

默认会读取 `skill/config.json` 中配置的排行榜后端地址，也支持通过 `CLAWLOCK_RANK_API_BASE` 覆盖。

高级两步模式：

```bash
python scripts/run_scan.py --adapter openclaw --output ./clawlock-rank-payload.json
python scripts/upload.py --input ./clawlock-rank-payload.json
```

---

## 启动提示

在开始执行前，先输出一行提示：

```text
📊 ClawLockRank 正在执行本地体检并准备排行榜上传，请稍候...
```

---

## 失败处理

- 如果 `clawlock` 未安装，提示用户先安装 ClawLock
- 如果扫描失败，直接展示命令错误
- 如果用户拒绝上传，明确提示“已取消上传，本地扫描结果未外传”
- 如果上传失败，直接展示 Worker 返回结果

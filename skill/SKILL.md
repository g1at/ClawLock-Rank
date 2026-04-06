---
name: clawlock-rank
description: >
  基于 ClawLock 体检结果构建的排行榜上传技能。
  仅当用户明确表达“上传安全分、上传体检成绩、提交排行榜结果、同步分数到 ClawLockRank”等意图时触发。
  不要在普通安全体检、普通 Claw 使用、调试开发、仅浏览排行榜时触发。
version: 1.0.0
metadata:
  openclaw:
    emoji: "🦞"
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

基于 ClawLock 体检结果构建的排行榜上传技能，面向“本地完成体检后，自愿上传成绩到排行榜”的场景。

[English Version → SKILL_EN.md](SKILL_EN.md)

## 触发边界

仅在用户明确要上传排行榜成绩时触发，例如：

- 上传安全分
- 上传安全体检分数
- 提交排行榜成绩
- 把这次体检结果上传到 ClawLockRank
- 同步我的 ClawLock 分数到排行榜

以下场景不要触发本技能：

- 只想做一次本地安全体检
- 只想查看排行榜
- 普通 Claw 使用
- 调试、开发、安装依赖

如果用户只是说“开始安全体检”，优先交给 ClawLock 主技能，而不是本技能。

## 隐私与上传范围

本技能默认先在**本地**执行 `clawlock scan --format json`，只有在用户明确确认后才会发起上传。

允许上传的字段仅包括：

- `tool`
- `clawlock_version`
- `adapter`
- `adapter_version`
- `device_fingerprint`
- `evidence_hash`
- `score`
- `grade`
- `nickname`
- `findings[].scanner`
- `findings[].level`
- `findings[].title`
- `timestamp`

明确不会上传：

- 原始配置文件
- 修复建议与 remediation 文本
- 本地文件路径 / `location`
- 环境变量
- 完整原始扫描报告
- `scan_history.json`

设备指纹说明：

- 原始 `device_fingerprint` 只发送给排行榜 Worker
- Worker 会在服务端使用 salt 哈希后再入库
- 前端不会公开展示原始设备指纹

## 推荐流程

触发后按以下顺序执行：

1. 本地运行 `clawlock scan --format json`
2. 将扫描结果裁剪为最小上传 payload
3. 告知用户排行榜会公开展示一个昵称
4. 询问用户想展示的昵称，留空则使用 `Anonymous`
5. 展示上传预览，包括：
   - 分数
   - 等级
   - 适配器与版本
   - 发现项数量
   - 即将上传的字段清单
6. 询问用户是否确认上传
7. 只有在用户明确同意后才上传到 ClawLockRank

默认入口：

```bash
python scripts/submit_score.py
```

高级两步模式：

```bash
python scripts/run_scan.py --adapter openclaw --output ./clawlock-rank-payload.json
python scripts/upload.py --input ./clawlock-rank-payload.json
```

默认会读取 `skill/config.json` 中配置的后端地址，也支持通过 `CLAWLOCK_RANK_API_BASE` 覆盖。

## 服务端防刷说明

排行榜后端会额外执行以下限制：

- 同一设备默认 `24` 小时冷却
- 只接受最近一段时间内生成的扫描结果
- 同一 IP 有单独的频率限制
- 排行榜和漏洞热点统计都只按设备最新一次有效结果计算

## 失败处理

- 如果 `clawlock` 未安装，提示用户先安装 ClawLock
- 如果扫描失败，直接展示扫描命令返回的错误
- 如果用户拒绝上传，明确说明“已取消上传，本地结果未外传”
- 如果上传失败，直接展示 Worker 返回的错误信息

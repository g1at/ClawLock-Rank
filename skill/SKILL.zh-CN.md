# ClawLockRank 上传技能

[English Version](./SKILL.md)

当用户希望在本地运行 ClawLock 安全体检，并选择是否将结果上传到 ClawLockRank 排行榜时，使用本技能。

## 目标

1. 本地执行 `clawlock scan --format json`
2. 基于扫描结果生成最小化上传 payload
3. 向用户展示公开摘要
4. 只有在用户明确确认后才上传

## 核心约束

- 未经用户明确确认，不得上传任何数据
- 不修改上游 `ClawLock` 项目
- 不使用 `~/.clawlock/scan_history.json`
- 只以 `clawlock scan --format json` 作为扫描数据源
- 只上传排行榜必需字段，不上传用户敏感信息

## 推荐工作流

优先使用一键脚本：

```bash
python scripts/submit_score.py --api-base "<worker-url>"
```

它会自动完成：

- 执行扫描
- 裁剪上传字段
- 提示用户输入昵称
- 展示将上传的数据摘要
- 二次确认后再上传

它也支持读取 `CLAWLOCK_RANK_API_BASE`。

如果需要拆分流程，也可以使用两步模式：

```bash
python scripts/run_scan.py --adapter openclaw --output ./clawlock-rank-payload.json
python scripts/upload.py --input ./clawlock-rank-payload.json --api-base "<worker-url>"
```

## 允许上传的字段

- `tool`
- `clawlock_version`
- `adapter`
- `adapter_version`
- `device_fingerprint`
- `score`
- `grade`
- `nickname`
- `findings[].scanner`
- `findings[].level`
- `findings[].title`
- `timestamp`

## 明确不会上传的内容

- 原始配置内容
- 修复建议文本
- 本地文件路径 / location
- 环境变量
- 任何 token / key / password
- `scan_history.json`
- 完整原始扫描报告

设备指纹说明：

- 原始 `device_fingerprint` 只发送给 Worker
- Worker 会在服务端进行哈希后再写入数据库
- 前端不会公开展示原始设备指纹

## 失败处理

- 如果 `clawlock` 未安装，提示用户先安装 ClawLock
- 如果扫描失败，直接展示命令错误
- 如果上传失败，直接展示 Worker 的返回结果

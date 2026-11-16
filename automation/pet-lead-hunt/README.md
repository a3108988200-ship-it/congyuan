# B2B Lead Hunt

本地 B2B 获客看板与执行器：公开来源研究、证据核验、客户分层、开发草稿和 CRM-ready 导出。

## 启动看板

在 PowerShell 中运行：

```powershell
& ".\start-dashboard.ps1"
```

然后打开 <http://127.0.0.1:4179>。启动脚本会在后台运行 Node 服务，并将日志保存在 `data` 目录。

运行前需要本机可用的 Codex CLI、已登录的 Codex 会话与项目内 Skills。服务只绑定 `127.0.0.1`。

## 选择本轮目标

点击研究按钮，依次输入细分产品、目标市场、优先买家，最后预览确认。厨师鞋、箱包、宠物是可编辑的填写示例，自定义接受其他产品。启动前可以增加渠道、采购模式和排除条件。原有宠物试跑结果仍可读取。

## 部署说明

将此目录放到找客户项目下的 `automation/pet-lead-hunt`。本机须有相邻的 HQ 项目、岗位 Skills 和已登录的 Codex CLI。Excel 导出依赖可解析的 `@oai/artifact-tool`。GitHub 保存源码，网页由本机服务提供。

## 运行边界

- 运行会读取项目已有宠物客户 CSV/XLSX 的公司名、国家和官网，用于重复识别。
- 每轮由 HQ 读取总控路由与销售中心岗位材料，记录分派结果，再按 E03、E08、E05、E09 执行。HQ 分派记录保存在本机运行记录中，不重复创建 command-center 待办。
- HQ 与各岗位阶段调用 Codex CLI 时显式指定 `GPT-6.1 Sol`（模型 ID：`gpt-6.1-sol`），并将推理强度设为 `medium`；模型和强度会写入运行记录及 Excel 总览，单阶段上限为 30 分钟。
- 现有公司键由本地确定性去重全量覆盖。E03 不再接收整份旧名单，减少无关上下文，不影响后续去重。
- Codex 按岗位分步生成带证据的候选、评分、开发草稿和 CRM-ready 本地记录；确定性代码负责去重、状态和导出。
- E03 与 E08 按智能设备、宠物用品、宠物食品的独立买家画像和品类匹配锚点评估；食品合规资料缺失会保留为未知。
- 邮件、WhatsApp、LinkedIn 和官网入口草稿会按渠道证据核验；未核验邮箱或号码不会通过本地渠道门槛。
- 草稿只保存在本地审核池；不会发送消息、提交表单、写入客户档案或生成正式报价。
- 宠物食品市场合规信息不完整时保留为未知。证据或候选不足时允许少于 10 家。
- CSV 与 XLSX 导出到 `项目根目录下的 outputs/pet-lead-hunt/<run-id>`。

## 目录

```text
pet-lead-hunt/
  public/       本机看板
  prompts/      HQ / E03 / E08 / E05 / E09 阶段提示词
  schemas/      阶段输出 JSON Schema
  data/runs/    本机运行状态与阶段响应
  workflow.json 市场、品类与安全边界配置
  server.mjs    本地 HTTP API 与 Codex 执行器
  start-dashboard.ps1  幂等本机启动脚本
```

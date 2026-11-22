# DivaVidol

DIVA-OLV 数字人板块里的第二张卡。来源是主人自己的 **VRM 舞台**项目
`C:\Users\Administrator\Desktop\diva-stage-vrm` —— 从
[lobe-vidol](https://github.com/lobehub/lobe-vidol) 分叉出来、改造成「3D 教室场景 + VRM 角色」
的那个版本。

## 来源

- 上游血统：`lobehub/lobe-vidol`，上游最后一次提交 `fa50051`（`0.30.0` 之后）
- 本地工作树：`diva-stage-vrm`（分支 `main`）；相对上游 **396 个文件有真实改动**，
  +2908 / −71998 行：删掉 PWA、语音列表与部分 agent runtime，加入 VRM 舞台相关模块
- 导入方式：复制工作树，排除 `node_modules`、`.next`、`.npm-cache`、`.downloads`、
  `.perf-tmp`、`shots`、`scratch` 与日志；2026-11-22
- 目录名沿用 `apps/diva-vidol/`（面板入口与窗口标题也叫 DivaVidol）；源项目目录叫
  `diva-stage-vrm`，两个名字指同一个应用
- 许可证：Apache-2.0，`LICENSE` 原样保留

## 本地资产（不入库）

这三个目录在源项目里也是未跟踪的，共约 246 MB，已写进 `public/` 下的 `.gitignore`：

| 目录 | 内容 | 大小 |
| --- | --- | --- |
| `public/assets/` | VRM 模型、贴图、动捕数据 | 158 MB |
| `public/environments/` | 教室 / 公寓 / 阁楼等场景 | 55 MB |
| `public/vrma/` | VRM 动画片段 | 33 MB |

本机已从源项目复制过来，所以能直接跑。换机器时复制这三个目录，或照源项目的
`scripts/buildLocalAssets.mjs` 重新构建。缺了它们应用能开，但场景清单是空的、没有角色。

## 依赖

- `node_modules/` 在本机是从源项目做的 **junction**（`mklink /J`），省掉 1.5 GB 重复安装。
  要变成独立副本：删掉 junction，再 `npm install --legacy-peer-deps`
  （上游锁 `antd ~5.18.3`，当前 `@lobehub/icons` 要 `antd ^5.23`，标准安装会 ERESOLVE）。
- `@emotion/is-prop-valid` 是 `framer-motion` 的 optional peer，`--legacy-peer-deps` 不自动装；
  缺它时 Next dev 会一直报 `Module not found`。源项目的依赖树里已经有。
- `package-lock.json` 在源项目里被 `.gitignore` 挡住，本机保留它只为复现依赖，不入库。

## 运行

面板会自己拉起（见仓库根 `vidol-session.cjs`）：

```
next dev -p <随机端口> -H 127.0.0.1
```

冷启动约 20–25 秒（首次编译 17711 个模块）。手动排查：`npx next dev -p 3211 -H 127.0.0.1`。

## 已知

- 字体从 `registry.npmmirror.com` 拉（HarmonySans），本机网络经常失败，控制台会有
  `ERR_CACHE_MISS`；不影响舞台渲染。
- 冷启动那一次 Next dev 徽标可能报一次 issue（热启动探测不到）。
- 对话仍是关键词占位回复，后台没有模型。
- Watchpack 会去扫 `C:\` 根（`pagefile.sys` 之类报 EINVAL），开发服务器的噪音，不影响页面。
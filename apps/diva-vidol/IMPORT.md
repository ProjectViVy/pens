# DivaVidol

这是 [lobe-vidol](https://github.com/lobehub/lobe-vidol) 的本地移植，在 DIVA-OLV 里叫
**DivaVidol**。

- 上游：`lobehub/lobe-vidol`，版本 `0.30.0`，提交 `fa50051`（`chore: fix broken README image links (#201)`）
- 许可证：Apache-2.0（见本目录 `LICENSE`），保留原版权与声明
- 导入方式：`git archive HEAD`（只取被跟踪的文件；上游工作区那 1100 个「已修改」全是
  CRLF 行尾差异，没有真实改动）
- 导入日期：2026-11-22（Asia/Shanghai）
- 相对上游的改动：目录改名为 `apps/diva-vidol/`（产品名 DivaVidol）；其余源码未改

## 依赖

上游没有提交 lockfile，且 `@lobehub/icons` 的当前版本要求 `antd ^5.23`，而根 `package.json`
锁在 `antd ~5.18.3`。所以 npm 标准安装会 ERESOLVE，必须：

```
npm install --legacy-peer-deps
```

`node_modules/`、`.next/`、`.env*` 都不入库。

## 运行

面板会自己拉起 `next dev`（见仓库根的 `vidol-session.cjs`），不需要单独起服务。手动排查时：

```
npx next dev -p 3210 -H 127.0.0.1
```

模型供应商的 Key 在应用内的设置里填，也可以用环境变量（`DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 等，
见上游 README）。没有 Key 时界面照常打开，聊天不出结果。

## 我们额外加的一个依赖

`@emotion/is-prop-valid`：`framer-motion` 把它列为 optional peer，`npm install --legacy-peer-deps`
不会自动装，缺它时 Next dev 会一直报 `Module not found: Can't resolve '@emotion/is-prop-valid'`
（页面能开，但左下角挂着「1 error」）。已写进本目录 `package.json` 的 dependencies。

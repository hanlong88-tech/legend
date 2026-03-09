# ⊞ CutOptimizer — 开料优化系统

板材切割排版优化软件，支持修边量、锯缝、木纹方向设置。

## 功能

- ✅ 多种板材管理（规格、修边量、锯缝、价格）
- ✅ 零件列表管理（尺寸、数量、木纹方向）
- ✅ 自动排版优化（Guillotine 算法）
- ✅ 可视化排版图（SVG，木纹方向箭头）
- ✅ 切割清单（件号、坐标、旋转状态）
- ✅ 一键打印 PDF 报告
- ✅ 导出 CSV 切割清单
- ✅ 本地存储（自动保存，刷新不丢失）

---

## 快速部署

### 方法 1 — Vercel（推荐，最简单，永久免费）

1. 在 [github.com](https://github.com) 新建一个仓库，把本项目文件上传
2. 去 [vercel.com](https://vercel.com) 注册（用 GitHub 账号登录）
3. 点 **"New Project"** → 选刚才的仓库 → 点 **Deploy**
4. 等 1 分钟，系统会给你一个网址，如 `https://cutoptimizer.vercel.app`

> 之后每次修改代码 push 到 GitHub，Vercel 自动重新部署。

---

### 方法 2 — Netlify（同样免费）

1. 上传代码到 GitHub
2. 去 [netlify.com](https://netlify.com) 注册
3. 点 **"Add new site"** → **"Import an existing project"**
4. 选 GitHub 仓库 → Build command: `npm run build` → Publish: `dist` → Deploy

---

### 方法 3 — 本地运行（测试用）

```bash
# 安装 Node.js 18+ 后执行
npm install
npm run dev
# 浏览器打开 http://localhost:5173
```

---

### 方法 4 — 静态文件部署（适合公司内网）

```bash
npm install
npm run build
# 把 dist/ 文件夹复制到任意 Web 服务器（Nginx、Apache）
```

---

## 项目结构

```
cutoptimizer/
├── index.html          # 入口 HTML
├── package.json        # 依赖配置
├── vite.config.js      # 构建配置
├── vercel.json         # Vercel 部署配置
├── netlify.toml        # Netlify 部署配置
└── src/
    ├── main.jsx        # React 入口
    └── App.jsx         # 完整应用（含算法+UI）
```

---

## 使用说明

1. **板材管理**：在左侧点"新增"，填写规格、修边量（四边各 Xmm）、锯缝宽度、单价
2. **零件列表**：点"新增零件"，填写名称、宽高、数量/套、木纹方向、所用板材
3. **立即优化**：点左下角黄色按钮，系统自动计算最优排版
4. **导出**：优化后可打印 PDF 报告或导出 CSV 交给锯床

---

## 木纹方向说明

| 设置 | 含义 | 适用场景 |
|------|------|----------|
| ↕ 顺纹 | H 方向沿板材纹路（正常放置） | 门板、侧板、背板 |
| ↔ 横纹 | H 方向横跨纹路（强制旋转 90°） | 特殊工艺要求 |
| ↻ 任意 | 系统自由选择最优方向 | 无纹路要求的小零件 |

---

MIT License · 如需定制开发请联系

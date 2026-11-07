# Three.js 特效参考画廊 · Effects Reference Gallery

Agent / 人类可浏览的 Three.js 特效模块库：侧边栏选分类 → 实时画布 → lil-gui 调参 → 复制模块源码。

## GitHub Pages

静态文件位于仓库根目录，用相对路径加载样式、模块和 `vendor/`。项目 Pages 子路径（`/<repo>/`）下无需改写 import。根目录 `.nojekyll` 关闭 Jekyll，避免漏发 ES module。

线上地址（Pages 从 `main` 分支 `/` 发布后）：

https://8vdpxdrv4c-dot.github.io/threejs-effects-demos/

## 如何打开 How to serve

必须通过 **HTTP** 静态服务打开（ES modules + import map 无法用 `file://`）。

在仓库根目录执行其一：

```bash
# Node
npx --yes serve .

# 或 Python 3
python3 -m http.server 8080
```

然后浏览器打开提示的地址（例如 `http://localhost:3000` 或 `http://localhost:8080`）。

依赖 CDN（需联网）：

- `three@0.160.0`（unpkg）
- `lil-gui@0.19.2`（unpkg）

## 目录结构

```
index.html      # 中文画廊壳
main.js         # 切换 / dispose
styles.css
lib/            # setup / gui / dispose
effects/        # 各特效模块 + index.js 注册表
vendor/         # Linear Ability Casting（MIT）
.nojekyll       # 让 GitHub Pages 按原样发布模块
```

## 特效模块约定

每个 `effects/*.js` 导出：

- `id`, `title`, `category`, `guiSchema`
- `create(ctx, params)`, `update(dt, params, ctx)`, `dispose()`

切换特效时会调用上一模块的 `dispose()` 并清理场景子节点，避免泄漏。

## 局限

- 气体混合 / 碰撞为 **风格化粒子力场**，不是完整 CFD。
- Godray 为光柱网格 + 尘埃近似，非屏幕空间体积光。
- 玻璃依赖 `MeshPhysicalMaterial.transmission`（WebGL2 效果更好）。

## 质量档 Quality tier

画廊默认工业暗场 + `RoomEnvironment` PMREM IBL + ACES。核心特效使用自定义 GLSL（软粒子 FBM/curl、域扭曲火焰、管道 Fresnel 流、电影级后处理栈）。刷新浏览器即可加载最新模块；切换特效会完整 `dispose`。

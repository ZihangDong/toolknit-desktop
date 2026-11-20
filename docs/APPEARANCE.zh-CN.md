# 统一布局与界面配色

全部主题共用原白色主题的布局。设置中心提供浅色／深色、八种配色模板以及自选主题色。自选颜色先预览，保存后持久化；取消或关闭设置页会恢复保存的配色。恢复默认配色保留当前深色／浅色主题，恢复经典灰及默认自选颜色，不改变壁纸开关或删除壁纸文件。

图片和视频壁纸由独立开关控制，两种明暗模式均可使用。关闭后释放媒体资源，保留文件选择。新用户默认浅色、经典灰、关闭壁纸；旧用户保留明暗偏好，原浅色用户的壁纸默认关闭。

桌面端视频壁纸支持不超过 500 MB 的 MP4、WebM、OGV、OGG 和 MOV 文件；导入时转为兼容视频，转码后文件也不得超过 500 MB。图片上限为 250 MB。浏览器开发预览仍限制为 8 MB。

主题配置保存在 `toolknit.appearance.v1`，字段为 `version`、`mode`、`preset`、`customColor`、`wallpaperEnabled`。首次读取兼容 `toolknit.theme.v3`，保存时同时更新旧明暗键。配置异常或无法访问存储时，界面仍可在当前会话切换。

颜色由 `src/app/theme-palette.js` 集中生成，Vite 将同一引擎嵌入首次绘制脚本。主窗口与截图、文件搜索辅助窗口使用相同算法，原生上下文只传校验后的配置。`themeRuntime.get()/set()/subscribe()` 保留明暗接口，完整配置通过 `getConfig()/setConfig()/subscribeConfig()` 访问。

组件读取 `src/styles/tokens.css` 的语义变量；组件样式不按明暗条件改变结构。新增模板只需在共享引擎的 `PRESETS` 中添加一条包含名称、颜色和标识的配置；设置按钮、明暗色阶和辅助窗口支持自动生成。文档纸张、导出图表、图片、截图标注和取色结果不参与界面换色；提词器专注阅读区保留固定深色。

验证入口：`npm run test:theme`、`npm run test:theme-browser`、`npm run test:appearance-windows-browser`、`npm run audit:tool-theme-colors`，以及现有已填充工具、启动和截图浏览器回归。浏览器脚本支持现有 `TOOLKNIT_TEST_MODULES` / `TOOLKNIT_TEST_BROWSER` 环境变量。

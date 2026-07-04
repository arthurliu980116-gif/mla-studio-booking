# MLA STUDIO 排课抢课系统

这是 MLA STUDIO 公开演示版排课抢课网页，可直接部署到 GitHub Pages。

## 使用方式

1. 打开网页。
2. 在老师工作台生成邀请码。
3. 发布阶段课程，设置开课日期、结课日期、可选时间窗口，并手动点选休息日。
4. 学生使用邀请码绑定身份，选择阶段课程、课程时长和固定开始时间。
5. 老师端和学生端都会生成完整课表表单。

## 数据说明

此版本是 GitHub Pages 静态网页版本，数据保存在访问者自己的浏览器 `localStorage` 中。它适合公开展示、流程试用和单设备演示。

如果要让所有学生共享同一套真实课程库存，需要接入后端数据库和 API。GitHub Pages 只能托管前端静态文件。

## 发布到 GitHub Pages

1. 新建公开仓库，建议名称：`mla-studio-booking`。
2. 将本目录里的所有文件上传到仓库根目录。
3. 打开仓库 `Settings -> Pages`。
4. `Source` 选择 `Deploy from a branch`。
5. `Branch` 选择 `main`，目录选择 `/(root)`。
6. 保存后等待 Pages 发布完成。


# MLA STUDIO 排课抢课系统

这是 MLA STUDIO 真实抢课系统的 GitHub Pages 前端包。页面默认支持两种模式：

- 未配置 Supabase：自动进入本地演示模式，数据只保存在当前浏览器。
- 已配置 Supabase：使用邮箱验证码登录、老师/学生隔离、共享库存、实时刷新和请假审批。

## 文件说明

- `index.html`：网页入口，必须放在 GitHub Pages 发布源根目录。
- `styles.css`：清新简约视觉样式。
- `app.js`：登录、抢课、请假、老师工作台逻辑。
- `supabase-config.js`：运行时配置。上线前填入 Supabase Project URL 和 anon key。
- `supabase-config.example.js`：配置示例。
- `assets/`：MLA STUDIO logo 和品牌图。

## Supabase 上线步骤

1. 在 Supabase 创建新项目。
2. 打开 SQL Editor，依次执行项目里的：
   - `supabase/schema.sql`
   - `supabase/policies.sql`
   - `supabase/functions.sql`
3. 在 `teacher_whitelist` 表中插入老师邮箱。
   当前已准备好默认老师邮箱：`arthurliu980116@gmail.com`。如果使用完整包，可以直接执行 `supabase/seed.sql`。
4. 把 `supabase-config.js` 改成你的项目配置：

```js
window.MLA_SUPABASE_CONFIG = {
  url: "https://你的项目.supabase.co",
  anonKey: "你的 anon public key",
};
```

5. 把本目录所有文件上传到 GitHub Pages 仓库根目录。
6. 在仓库 `Settings -> Pages` 选择 `Deploy from a branch`，分支选 `main`，目录选 `/(root)`。

## 注意

Supabase anon key 是公开前端 key，不是数据库密码；真正的数据安全依靠 RLS 策略和 RPC 事务函数。不要把 Supabase service role key 放进本目录。

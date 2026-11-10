# 言语词库 V1

公务员、事业单位「言语理解」成语与实词记忆系统。项目独立于「公考错题本」，不共用账号或数据。

## 运行

需要 Node.js 20 以上，无第三方运行依赖：

```bash
node server/server.mjs
```

默认打开 `http://127.0.0.1:8080/`，监听 `0.0.0.0:8080`。可用环境变量：

```bash
PORT=8080 HOST=0.0.0.0 DATA_FILE=/path/to/app-data.json node server/server.mjs
```

运行测试：

```bash
npm test
```

## 结构

```text
public/          浏览器端页面、样式、PWA、Service Worker
shared/          前后端共用的初始词库、数据变更逻辑、间隔重复与统计
server/          Node 原生 HTTP 服务、账号、同步接口、JSON 持久化
data/            运行时数据与每日备份（已 gitignore）
docs/            任务书与 V1 验收说明
tests/           Node 内置测试
```

## 账号与数据

- 用户名 + 密码注册登录；密码用 scrypt 加盐哈希，不保存明文。
- 每个用户首次登录时复制一份初始词库（60 条、4 个易混组），之后完全独立。
- 学习记录采用“本机先写、联网补传”的方式；同一账号可在不同设备登录。
- 浏览器端使用 IndexedDB 保存离线快照与待补传记录，应用外壳由 Service Worker 缓存。
- 服务端数据写入 `data/app-data.json`，写盘前每日保留一份 `data/backups/app-data-YYYY-MM-DD.json`。
- 删除词语/分组/错词为软删除，学习历史保留。

## 发布说明

当前版本没有绑定任何付费服务、域名或云账号。长期公网托管需要另行授权；详见 `docs/V1-acceptance.md`。

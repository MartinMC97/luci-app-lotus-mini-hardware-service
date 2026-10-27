# LuCI Lotus Mini Hardware Service

Lotus Mini 本机硬件服务的独立管理界面。读取电量、供电、温度、全局音量、
麦克风静音和应用使用状态；提供音量/静音、服务管理、短时灯效测试及日志。
兼容 LuCI 主题的标准布局，不依赖某个语音应用，不直接访问硬件节点。

## 安装与使用

适用现有 Lotus Mini OpenWrt / AArch64 musl；先安装并验证
`lotus-hardware-service`。开发 APK 未签名，校验来源和 SHA-256 后安装：

```sh
apk --no-network add --allow-untrusted /tmp/luci-app-lotus-mini-hardware-service-0.1.0-r4.apk
```

刷新 LuCI 后进入 **状态 → Lotus Mini Hardware**。
所有日常操作集中在这一个页面，不再提供单独的底层配置页。
启动/停止影响当前运行状态；开机自动运行决定下次开机是否启动硬件服务。
两者不会启动语音应用。音量和麦克风静音设置保存在设备上，重启后保留。
平时不显示内部保存状态，保存失败时才提示；解除静音期间需等保存成功。

- 音量按键每次 ±5；滑条显示 0–100%，拖动时预览，释放/确认变化后提交一次。
  轮询不会覆盖拖动中的值。高音量可能很响；设置不会主动播放音频。
- 已运行时禁用启动按钮；自启按钮按当前自启状态禁用重复操作。
- 静音立即请求；解除需确认，并等待服务持久保存成功。
- 软件静音不是麦克风物理断电；解除不启动或授权任何应用。
- 应用占用时禁止停止/重启和灯效测试，先在应用自己的页面停止它。
- 灯效测试约两秒、亮度 20%；应用使用硬件或麦克风静音时不能测试。
- 日志按需读取硬件服务最近 80 行，不轮询日志、不写日志文件。
- 页面每 3 秒查询一次；服务失联清除旧读数，未知/不可用不伪装成 0。

## 替换旧 sensors 页面

旧 `Lotus Mini sensors` 随 `lotus-mini-base` 安装，不能卸载整个基础包。
本包仅在旧菜单与已知模板完全一致时增加「新 RPC 后端不存在才显示」条件。
不删旧传感器 CLI、thermal 脚本或 ACL，不触碰内核/分区。
如果旧菜单被用户改过，保持不动并写日志；不会覆盖未知修改。

卸载本包前恢复已知旧菜单；若页面仍显示旧入口，刷新浏览器/重新登录。
基础包未来更新可能重新写入旧菜单，可显式重新执行：

```sh
/usr/libexec/lotus-hardware-ui-menu install
```

菜单模板就是已核对的旧页面备份，源码保留在 `root/usr/share/lotus-hardware-ui/`。
脚本 restore 只还原本包写入的精确模板，不覆盖新修改。
卸载界面不卸载或停止硬件服务，不恢复旧应用的直接硬件后端。

## SDK 构建

先用匹配 SDK 构建硬件服务，导出其客户端头文件，然后：

```sh
sh test.sh
sh build-sdk.sh /path/to/matching-openwrt-sdk
```

输出在 `artifacts/`。不构建内核/整机镜像；脚本仅增补 SDK 配置并编译本包。
测试需要主机 g++、Python、Node.js 以及允许本地 Unix socket；通过
`HARDWARE_SERVICE_REPO` 可指定硬件服务源码目录，用 mock 服务验证，无实机采音。

## 接口与权限

`/usr/libexec/rpcd/lotus_hardware` 通过受限 socket 查询/控制。固定 RPC 方法：
status、logs、set_volume、adjust_volume、set_privacy、service、test_led。
ACL 分离读写，没有通用 file.exec 权限、任意命令、路径、寄存器或 socket 参数。
界面不再申请 UCI 配置权限，不读取应用密钥。
read-only 登录可查看状态和日志，不能执行控制。

后端请求最多 16 KiB、严格 JSON/schema、连接/命令有超时；固定系统命令输出
上限 64 KiB、时间上限 4 秒。资源登记是协作约定，同 UID/root 仍可绕过接口。
服务停止的空闲检查与 init 调用之间存在竞争窗口，不宣称操作系统强制互斥。

首次安装时的 `enabled`（允许启动）、`handoff_confirmed`（部署交接确认）、
`global_keys`（音量及麦克风键处理）仍由硬件服务的 `/etc/config/lotus_hardware`
管理，本包不会修改这些设置。这些属于安装/维护配置，不是日常用户开关；
安装前请参阅硬件服务仓库的部署说明。原配置页已移除，不影响现有配置。

## 翻译

界面文字统一使用 LuCI `_()`，默认文案为中文，不强制修改用户的 LuCI 全局
语言。当前提供 `po/zh_Hans/lotus-mini-hardware-service.po`，模板在
`po/templates/lotus-mini-hardware-service.pot`。中文源字符串也是 gettext
消息键，未有其他语言翻译时回退到中文。

SDK 使用 LuCI 的 `po2lmo` 编译为标准 `*.zh-cn.lmo` 并随应用包安装；
运行时不额外启动翻译服务。新增语言时复制模板到相应 `po/<语言>/` 目录，
填写 msgstr，并在构建中加入对应 LuCI 语言别名的 LMO 输出。测试会检查页面
所有翻译消息都包含在中文目录及模板中。当前只交付中文，不宣称已有其他语言。

代码 GPL-3.0-only；使用硬件服务导出的 GPL 客户端和 picojson BSD-2-Clause 头文件。
来源/许可见 [NOTICE](NOTICE)。

# Leyu-awa GitHub 贡献热力图诊断与修复流程

> 日期：2026-07-24  
> 目标账号：`Leyu-awa`  
> 现象：旧账号 `Kawayideleyu` 提交可生成贡献绿格，当前账号 `Leyu-awa` 提交后个人主页贡献热力图无记录。  
> 本地诊断结果：当前仓库提交作者为 `LeYu-awa <160152866@qq.com>`，仓库级提交邮箱来自 `.git/config`。

## 1. 关键结论

当前最可能原因是：本地 Git 提交邮箱 `160152866@qq.com` 没有添加到 `Leyu-awa` 账号的 GitHub Emails 列表，或该邮箱已添加但尚未完成验证。

GitHub 贡献图对 commit 的核心要求是：commit author email 必须关联到对应 GitHub 账号；commit 还需要进入仓库默认分支或 `gh-pages` 分支，并满足仓库权限/协作关系等条件。

## 2. 本地核查命令

在项目根目录执行：

```powershell
git config --show-origin --get user.name
git config --show-origin --get user.email
git log -1 --format="%an <%ae>"
git log --format="%h %an <%ae>" -5
```

本次已核查到：

```text
user.name  = LeYu-awa
user.email = 160152866@qq.com
latest commit author = LeYu-awa <160152866@qq.com>
```

说明本地提交确实使用了 `160152866@qq.com`。下一步必须到 GitHub 账号 `Leyu-awa` 检查这个邮箱是否已添加并验证。

## 3. GitHub 账号侧核查

登录 `Leyu-awa` 后检查：

1. 打开 GitHub 右上角头像。
2. 进入 `Settings`。
3. 进入 `Access` → `Emails`。
4. 检查 `160152866@qq.com` 是否在邮箱列表中。
5. 检查该邮箱是否显示为已验证。
6. 如果未添加，点击 `Add email address` 添加。
7. 如果未验证，打开 QQ 邮箱收取 GitHub 验证邮件并完成验证。
8. 如果收不到邮件，检查垃圾箱、拦截规则、退信提示；仍失败则换用可正常收信的邮箱或使用 GitHub 提供的 no-reply 邮箱。

## 4. 修复方式 A：继续使用 QQ 邮箱

适用场景：希望 commit 显示真实邮箱 `160152866@qq.com`。

1. 确认 `Leyu-awa` 的 GitHub Emails 中包含并已验证 `160152866@qq.com`。
2. 在当前仓库固定提交邮箱：

```powershell
git config user.name "LeYu-awa"
git config user.email "160152866@qq.com"
```

3. 新建一次测试提交并推送到默认分支：

```powershell
git log -1 --format="%an <%ae>"
git push
```

4. 等待 GitHub 更新贡献图；如果没有立即出现，稍后刷新个人主页。

## 5. 修复方式 B：改用 GitHub no-reply 邮箱

适用场景：希望隐藏真实邮箱，或 QQ 邮箱无法验证。

1. 在 GitHub `Settings` → `Emails` 中找到账号专属 no-reply 邮箱，格式通常类似：

```text
<ID>+Leyu-awa@users.noreply.github.com
```

2. 在当前仓库配置提交邮箱：

```powershell
git config user.name "LeYu-awa"
git config user.email "<ID>+Leyu-awa@users.noreply.github.com"
```

3. 验证本地配置：

```powershell
git config --show-origin --get user.email
git log -1 --format="%an <%ae>"
```

4. 后续新提交使用 no-reply 邮箱后，应归属到 `Leyu-awa`。

## 6. 常见问题排查

| 问题 | 判断方式 | 处理方式 |
| --- | --- | --- |
| 邮箱未绑定 | GitHub Emails 没有 `160152866@qq.com` | 添加邮箱并验证 |
| 邮箱未验证 | Emails 中有邮箱但未 verified | 完成验证邮件流程 |
| 本地仓库覆盖了全局邮箱 | `git config --show-origin --get user.email` 显示 `.git/config` | 以仓库级配置为准，必要时重新设置 |
| 提交邮箱属于旧账号 | commit author email 仍绑定 `Kawayideleyu` | 从旧账号移除或在新账号添加并验证该邮箱 |
| 使用隐私邮箱但配置错 | 本地邮箱不是 GitHub no-reply 格式 | 使用 GitHub Emails 页面显示的完整 no-reply 地址 |
| 提交不在默认分支 | commit 只在 feature 分支/未合并 | 合并或推送到默认分支后再看贡献图 |
| 私有仓库贡献不可见 | 个人主页未开启 private contribution 显示 | 在贡献图设置中开启 private contributions 可见性 |
| 邮件被拦截/无法验证 | 收不到 GitHub 验证邮件 | 检查垃圾箱、拦截规则，或换 no-reply/其他可验证邮箱 |

## 7. 历史提交修复

如果过去已经用错误邮箱提交，修复本地配置只影响未来提交；历史 commit author 不会自动改变。

可选方案：

1. 如果历史提交不重要：只修复未来提交即可。
2. 如果必须修复历史绿格：需要重写提交作者邮箱，然后强制推送。
3. 重写历史会改变 commit hash，若仓库已多人协作，不建议直接操作；应先备份分支并与协作者确认。

单人仓库可参考流程：

```powershell
git checkout -b backup-before-email-rewrite
git checkout main
# 使用 git filter-repo 或交互式 rebase 重写 author email
git push --force-with-lease
```

当前建议：先修复 `Leyu-awa` 的 GitHub Emails 绑定和未来提交邮箱，不急于重写历史。

## 8. 最小验证闭环

1. `git config --show-origin --get user.email` 输出 `160152866@qq.com` 或正确 no-reply 邮箱。
2. GitHub `Leyu-awa` Emails 页面显示该邮箱已 verified。
3. 新提交的 `git log -1 --format="%an <%ae>"` 与 GitHub verified email 一致。
4. 新提交进入默认分支并推送成功。
5. GitHub 个人主页贡献图出现对应日期绿格。

# `src-tauri/target` —— mbx 缓存 symlink

`src-tauri/target` 是 **mbx 缓存 symlink**（mode `120000`，内容指向
`D:/mbx/targets/v1/<hash>`，hash 来自 `Cargo.lock`）。它让 cargo 编译在不同项目间
共享增量缓存。

## 禁止

- ❌ `rm -rf src-tauri/target` / `rmdir /s /q src-tauri/target` —— 会破坏缓存
- ❌ `mkdir src-tauri/target` —— 会把 symlink 变成空目录
- ❌ `git rm src-tauri/target` / `git update-index --remove` —— 会从仓库里删掉
- ❌ 在 `.gitignore` 里写错规则导致 symlink 被解引用为普通目录
- ❌ 修改 Cargo.lock 后忘记重建 symlink（mbx 会按新 hash 自动建，但 symlink 仍要保留）

## 已知状态

本机 `core.symlinks=false`（`git config core.symlinks` 查看），所以工作树里的形态
和 git 索引里的形态**天然不一致**，这是正常状态：

| 位置 | 形态 | 说明 |
| --- | --- | --- |
| git 索引 / HEAD | `120000` symlink → `D:/mbx/targets/v1/<hash>` | 唯一正确的入库形态 |
| 工作树（clone 出来） | 82 字节普通文件，内容是路径 | git 的占位形式；**会挡构建** |
| 工作树（构建可用态） | 真实目录 | mbx 报 `not a directory` 时就切到这个 |

## 故障恢复（按实际验证过的步骤）

mbx（1.17.0，`mbx --help` / `mbx doctor` 查看状态）负责管理这个 link —— **不要手工
删建，走 mbx 官方命令**：

1. **工作树是占位文件，mbx 报 `could not inspect Cargo target directory ...: not a directory`**
   → 在 `src-tauri\` 下执行：
   ```powershell
   mbx adopt --dry-run   # 先看会收编什么
   mbx adopt             # 若报「目录不是空的」，先 mbx clean 再 adopt
   ```
   `mbx adopt` 会把真实 target 目录**移动**进 `D:\mbx\targets\v1\<hash>`，
   并在原地**留下一个真正的 `<SYMLINKD>`**（mbx 自己能建 symlink，不需要管理员）。
2. **managed 目录已存在导致 adopt 报错（os error 145「目录不是空的」）**
   → `mbx clean`（只删本 workspace 的 managed target + 学到的增量状态，
   **不动**工作树目录）→ `mbx adopt`。
3. **`git status` 出现 ` D src-tauri/target`**（工作树形态 vs 索引 symlink 条目不一致）
   → 绝不要 `git add` / `git rm` 这个路径。要让 status 干净：
   `git update-index --skip-worktree src-tauri/target`（只影响本机，不入库）。
   若索引条目真的丢了，从 `git cat-file -p HEAD:src-tauri/target` 取 blob hash 后
   `git update-index --add --cacheinfo 120000,<hash>,src-tauri/target` 加回。
4. **索引 symlink 条目丢失**（`git ls-files -s src-tauri/target` 无输出）
   → 用上面的 `cacheinfo` 加回，hash 也可靠 `git ls-tree origin/main src-tauri/target` 取。

## mbx 常用命令

详细见 `mbx --help`：

| 命令 | 用途 |
| --- | --- |
| `mbx doctor` | 检查安装、缓存、toolchain、shim 状态 |
| `mbx adopt [PATH]` | 把真实 target 目录收编进 managed root，原地留 symlink |
| `mbx clean` | 删本 workspace 的 managed target + link + 学到的增量状态 |
| `mbx explain` | 解释缓存 miss / bypass |
| `mbx stats` / `mbx tui` | 看省了多少编译时间 |
| `mbx gc` | 按预算清理存储 |

## 怎么判断没被破坏

```bash
git ls-tree HEAD src-tauri/target
# 应该输出: 120000 blob <hash>  src-tauri/target

git ls-files -s src-tauri/target
# 索引里必须是 120000；工作树是普通文件或目录都算正常（见上表）
```

如果索引里变成了 `100644` 或干脆没了，立刻按恢复步骤第 3 条处理。

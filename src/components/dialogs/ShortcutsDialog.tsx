import { useCallback } from 'react';
import { useStore } from '../../store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: '浏览',
    items: [
      ['← / →', '上一张 / 下一张'],
      ['Space / Backspace', '下一张 / 上一张'],
      ['Home / End', '第一张 / 最后一张'],
      ['G', '切换图库视图'],
      ['F5', '幻灯片放映'],
      ['F11 / F', '全屏'],
      ['Esc', '退出全屏 / 关闭面板'],
    ],
  },
  {
    title: '缩放与平移',
    items: [
      ['滚轮', '以光标为中心缩放'],
      ['+ / -', '放大 / 缩小'],
      ['0', '适应窗口'],
      ['1', '实际大小 (100%)'],
      ['双击', '在适应窗口与 100% 间切换'],
      ['拖动 / 方向键', '平移图片（放大时）'],
      ['M', '显示 / 隐藏导航小地图'],
    ],
  },
  {
    title: '编辑',
    items: [
      ['R / Shift+R', '向右 / 向左旋转'],
      ['H / V', '水平 / 垂直翻转'],
      ['C', '裁剪（Enter 应用）'],
      ['E', '编辑与调整'],
      ['Ctrl+D', '收藏 / 取消收藏'],
      ['Delete', '从列表中移除'],
    ],
  },
  {
    title: '文件',
    items: [
      ['Ctrl+O', '打开文件'],
      ['Ctrl+Shift+O', '打开文件夹'],
      ['Ctrl+V', '粘贴图片'],
      ['Ctrl+C', '复制图片'],
      ['Ctrl+S', '另存为 / 调整大小'],
      ['Ctrl+P', '打印'],
      ['I', '文件信息'],
      ['T', '显示 / 隐藏胶片栏'],
    ],
  },
  {
    title: '视频播放',
    items: [
      ['Space / K', '播放 / 暂停'],
      ['J / L', '后退 / 前进 10 秒'],
      ['M', '静音'],
      ['双击', '全屏（沉浸）'],
      ['F / F11', '全屏'],
      ['← / →', '上一个 / 下一个文件'],
    ],
  },
];

export default function ShortcutsDialog() {
  const open = useStore((s) => s.dialog === 'shortcuts');
  const close = useCallback(() => useStore.getState().setDialog(null), []);
  return (
    <Dialog
      open={open}
      onClose={close}
      title="键盘快捷键"
      width={760}
      footer={
        <Button variant="accent" onClick={close}>
          关闭
        </Button>
      }
    >
      <div className="sc-grid">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="sc-title">{g.title}</h3>
            <div className="sc-list">
              {g.items.map(([k, d]) => (
                <div key={k} className="sc-row">
                  <span className="sc-desc">{d}</span>
                  <span className="sc-keys">
                    {k.split(' / ').map((part) => (
                      <kbd key={part} className="kbd">
                        {part}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

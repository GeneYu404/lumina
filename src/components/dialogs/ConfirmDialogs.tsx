import { useCallback, useState } from 'react';
import { useCurrent, useStore } from '../../store';
import { closeDesktopWindow, isDesktop } from '../../desktop';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Controls';
import { Dialog } from '../ui/Dialog';

const S = useStore.getState;

export function ConfirmRemoveDialog() {
  const open = useStore((s) => s.dialog === 'confirmRemove');
  const item = useCurrent();
  const [dontAsk, setDontAsk] = useState(false);
  const close = useCallback(() => S().setDialog(null), []);
  const confirm = () => {
    if (dontAsk) S().setSetting('confirmRemove', false);
    if (item) S().removeImage(item.id);
    close();
  };
  return (
    <Dialog
      open={open && !!item}
      onClose={close}
      title="从列表中移除？"
      width={440}
      footer={
        <>
          <Button variant="accent" onClick={confirm}>
            移除
          </Button>
          <Button onClick={close}>取消</Button>
        </>
      }
    >
      <p className="leading-6 text-fg2">
        “<span className="text-fg">{item?.name}</span>” 将从查看器列表中移除。磁盘上的原始文件不会被删除。
      </p>
      <div className="mt-4">
        <Checkbox checked={dontAsk} onChange={setDontAsk}>
          不再询问
        </Checkbox>
      </div>
    </Dialog>
  );
}

export function CloseAllDialog() {
  const open = useStore((s) => s.dialog === 'closeAll');
  const count = useStore((s) => s.images.length);
  const close = useCallback(() => S().setDialog(null), []);
  const confirmClose = (closeWindow: boolean) => {
    S().closeAll();
    if (closeWindow) {
      if (isDesktop) void closeDesktopWindow();
      else S().setWin({ closed: true });
    }
    close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="关闭所有图片？"
      width={460}
      footer={
        <>
          <Button variant="accent" onClick={() => confirmClose(true)}>
            关闭窗口
          </Button>
          <Button onClick={() => confirmClose(false)}>仅关闭图片</Button>
          <Button onClick={close}>取消</Button>
        </>
      }
    >
      <p className="leading-6 text-fg2">当前打开了 {count} 个文件。关闭后，所有未另存的编辑（裁剪、调色等）都将丢失。</p>
    </Dialog>
  );
}

import { displayMessage as tr, getLanguage, subscribeLanguage } from '../i18n/core.ts';
import {
  VisualizationRenderer,
  type VisualizationFrame,
  type VisualizationStyle,
} from './visualization.ts';
export type VisualizationWindow = { close: () => void };
/** Regular popup intentionally coexists with the separate lyrics PiP. */
export function openVisualizationWindow(
  host: Window,
  read: () => VisualizationFrame | null,
  style: () => VisualizationStyle,
  onClose: () => void,
): VisualizationWindow {
  const child = host.open(
    '',
    'ziyou-audio-visualization',
    'popup=yes,width=620,height=360,resizable=yes',
  );
  if (!child || child.closed)
    throw new Error('未能打开可视化窗口，请允许本站弹出窗口后重试。');
  let disposed = false,
    raf = 0,
    timer = 0;
  let unsubscribe = () => {};
  const stop = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    child.cancelAnimationFrame(raf);
    host.clearInterval(timer);
    host.removeEventListener('pagehide', close);
    child.removeEventListener('pagehide', stop);
    onClose();
  };
  const close = () => {
    stop();
    if (!child.closed) child.close();
  };
  try {
    const doc = child.document;
    doc.title = tr('自用 · 音频可视化');
    doc.documentElement.lang = getLanguage();
    doc.head.replaceChildren();
    doc.body.replaceChildren();
    const styles = doc.createElement('style');
    styles.textContent =
      'html,body{margin:0;height:100%;background:#151c19;color:#dce8df;font:14px system-ui,sans-serif}body{display:flex;flex-direction:column;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;color:#a7b9ad;flex-shrink:0}main{position:relative;flex:1;min-height:0}canvas{width:100%;height:100%;display:block}p{margin:0;padding:8px 20px 14px;color:#869c8e;font-size:12px;flex-shrink:0}button{background:transparent;color:#cfe0d3;border:1px solid #526559;border-radius:6px;padding:4px 10px;cursor:pointer}button:focus-visible{outline:2px solid #b7f36b}';
    doc.head.appendChild(styles);
    const header = doc.createElement('header'),
      title = doc.createElement('span'),
      button = doc.createElement('button');
    button.textContent = tr('关闭');
    button.onclick = close;
    header.appendChild(title);
    header.appendChild(button);
    const main = doc.createElement('main'),
      canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-label', tr('随当前音乐变化的音频可视化'));
    canvas.setAttribute('role', 'img');
    main.appendChild(canvas);
    const status = doc.createElement('p');
    status.textContent = tr('等待播放音乐');
    doc.body.appendChild(header);
    doc.body.appendChild(main);
    doc.body.appendChild(status);
    const ctx = canvas.getContext('2d');
    if (!ctx)
      throw new Error('当前浏览器无法绘制可视化，请换用桌面浏览器重试。');
    const renderer = new VisualizationRenderer();
    let last = 0,
      lastStyle = '';
    const render = (time: number) => {
      if (disposed || child.closed) {
        stop();
        return;
      }
      raf = child.requestAnimationFrame(render);
      if (time - last < 1000 / 30) return;
      const elapsed = last ? (time - last) / 1000 : 1 / 30;
      last = time;
      const width = Math.max(1, main.clientWidth),
        height = Math.max(1, main.clientHeight);
      const ratio = Math.min(
        child.devicePixelRatio || 1,
        2,
        1920 / width,
        1080 / height,
      );
      const w = Math.max(1, Math.round(width * ratio)),
        h = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const frame = read(),
        selected = style();
      if (lastStyle !== selected) {
        title.textContent =
          tr(selected === 'lines' ? '自用 · 律动线条' : '自用 · 柱状频谱');
        lastStyle = selected;
      }
      const message = frame?.playing
        ? tr('跟随当前音乐 · 在个人偏好中切换样式')
        : tr('等待播放或继续音乐');
      if (status.textContent !== message) status.textContent = message;
      renderer.draw(ctx, width, height, frame, selected, elapsed);
    };
    const syncLanguage = () => {
      doc.documentElement.lang = getLanguage();
      doc.title = tr('自用 · 音频可视化');
      button.textContent = tr('关闭');
      canvas.setAttribute('aria-label', tr('随当前音乐变化的音频可视化'));
      title.textContent = tr(style() === 'lines' ? '自用 · 律动线条' : '自用 · 柱状频谱');
      status.textContent = tr(read()?.playing ? '跟随当前音乐 · 在个人偏好中切换样式' : '等待播放或继续音乐');
      lastStyle = '';
    };
    syncLanguage(); unsubscribe = subscribeLanguage(syncLanguage);
    child.addEventListener('pagehide', stop, { once: true });
    host.addEventListener('pagehide', close, { once: true });
    timer = host.setInterval(() => {
      if (child.closed) stop();
    }, 500);
    raf = child.requestAnimationFrame(render);
    child.focus();
    return { close };
  } catch (error) {
    close();
    throw error;
  }
}

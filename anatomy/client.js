let ws = null;

const connectBtn = document.querySelector('.connect');
const sendBtn = document.querySelector('.send');
const statusEl = document.querySelector('#status');

connectBtn.addEventListener('click', () => {
  ws = new WebSocket('ws://localhost:8080');
  ws.addEventListener('open', () => {
    statusEl.classList.add('on');
    statusEl.classList.remove('off');
    statusEl.textContent = '已连接';
  });
  ws.addEventListener('close', () => {
    statusEl.classList.add('off');
    statusEl.classList.remove('on');
    statusEl.textContent = '未连接';
    ws = null;
  });
});
sendBtn.addEventListener('click', () => {
  if (ws) {
    ws.send('hello');
  }
});

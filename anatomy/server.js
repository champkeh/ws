const { WebSocketServer } = require('../index');

const wss = new WebSocketServer({
  port: 8080,
  perMessageDeflate: false
});

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    socket.send(data);
  });
});

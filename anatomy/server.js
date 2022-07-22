const { WebSocketServer } = require('../index');

const wss = new WebSocketServer({
  port: 8080,
  perMessageDeflate: {
    clientMaxWindowBits: 15,
    serverMaxWindowBits: 15,
    clientNoContextTakeover: true,
    serverNoContextTakeover: true
  }
});

wss.on('connection', (ws) => {
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      ws.send(data);
    } else {
      ws.send(data.toString());
    }
  });
});

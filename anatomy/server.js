const { WebSocketServer } = require('../index');

const wss = new WebSocketServer({
  port: 8080,
  perMessageDeflate: false
});

wss.on('connection', (client) => {
  client.on('message', (data) => {
    client.send(data);
  });
});

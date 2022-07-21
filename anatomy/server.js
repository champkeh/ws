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

wss.on('connection', (client) => {
  client.on('message', (data) => {
    client.send(data);
  });
});

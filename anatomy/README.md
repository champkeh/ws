# Anatomy

## WebSocketServer 核心实现

### 应用代码示例

代码如下：

```js
const wss = new WebSocketServer({
  port: 8080,
  perMessageDeflate: false
});

wss.on('connection', (client) => {
  client.on('message', (data) => {
    client.send(data);
  });
});
```

构造器内部的流程如下：

a. 如果选项中指定了端口字段，则内部会创建一个 http 服务器

```js
if (options.port != null) {
  this._server = http.createServer((req, res) => {
    const body = http.STATUS_CODES[426];

    res.writeHead(426, {
      'Content-Length': body.length,
      'Content-Type': 'text/plain'
    });
    res.end(body);
  });
} else if (options.server) {
  this._server = options.server;
}
```

b. 也可以将外部的 http 服务器作为`server`选项传入，则直接使用该服务器实例。

从 a 中可知，内部创建的 http 服务器对正常的 http 请求的处理是直接返回`426 Upgrade Required`响应，表示这个 http 服务器不接受普通的 http 请求，只接受升级到其他协议的请求。

### 处理协议升级请求

```js
const emitConnection = this.emit.bind(this, 'connection');

this._removeListeners = addListeners(this._server, {
  listening: this.emit.bind(this, 'listening'),
  error: this.emit.bind(this, 'error'),
  upgrade: (req, socket, head) => {
    this.handleUpgrade(req, socket, head, emitConnection);
  }
});
```

可以看到，这里会监听这个 http 服务器的`upgrade`事件，处理协议升级请求。具体处理过程，由`this.handleUpgrade()`和`this.completeUpgrade()`这两个方法处理。

### handleUpgrade 的主要流程

签名如下：

```ts
type handleUpgrade = (
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  cb: emitConnection,
) => void
```

这个方法主要是检查协议升级请求是否符合 WebSocket 的握手协议，比如：

1. 请求方法必须是 GET
2. 请求头中的`Upgrade`字段必须是 websocket 关键字
3. 请求头中必须存在`Sec-WebSocket-Key`字段，并且必须是 Base64 编码
4. 请求头中的协议版本字段`Sec-WebSocket-Version`只能是8或者13
5. 请求路径必须符合 options 中的 `path`
6. 解析请求头中的子协议和扩展 `Sec-WebSocket-Protocol/Sec-WebSocket-Extensions`

子协议被解析为`string[]`，传给`completeUpgrade()`去决定最终采用哪个协议。

扩展被解析为`{'permessage-deflate': PerMessageDeflate}`，`PerMessageDeflate.params`包含了协商出的参数。

### completeUpgrade 的主要流程

签名如下：

```ts
type completeUpgrade = (
  extensions: Object,
  key: String,
  protocols: Set,
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  cb: emitConnection,
) => void
```

这个方法主要是用来完成握手的后续流程。

根据客户端的`key`计算 SHA1 摘要：

```js
const digest = createHash('sha1')
  .update(key + GUID)
  .digest('base64');

const headers = [
  'HTTP/1.1 101 Switching Protocols',
  'Upgrade: websocket',
  'Connection: Upgrade',
  `Sec-WebSocket-Accept: ${digest}`
];
```

创建一个客户端对象，并将协商出的子协议和扩展保存在对象的私有字段上。
握手完成之后，后续与这个连接的通信都是通过这个对象进行。

```js
const ws = new this.options.WebSocket(null);
if (protocols.size) {
  //
  // Optionally call external protocol selection handler.
  //
  const protocol = this.options.handleProtocols
    ? this.options.handleProtocols(protocols, req)
    : protocols.values().next().value;

  if (protocol) {
    headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
    ws._protocol = protocol;
  }
}

if (extensions[PerMessageDeflate.extensionName]) {
  const params = extensions[PerMessageDeflate.extensionName].params;
  const value = extension.format({
    [PerMessageDeflate.extensionName]: [params]
  });
  headers.push(`Sec-WebSocket-Extensions: ${value}`);
  ws._extensions = extensions;
}
```

握手响应：

```js
socket.write(headers.concat('\r\n').join('\r\n'));
```

将这个 socket 连接保存在刚创建的客户端对象中：

```js
ws.setSocket(socket, head, {
  maxPayload: this.options.maxPayload,
  skipUTF8Validation: this.options.skipUTF8Validation
});
```

最后，通知外面连接已建立：

```js
cb(ws, req);
```

这样，我们通过监听`wss`的`connection`事件就可以拿到客户端对象了，这个对象是`WebSocket`实例。


## WebSocket 核心实现

从上面对服务器的分析我们知道，握手过程中会创建一个 WebSocket 实例，并且把底层的 tcp 连接保存在这个实例中。握手完成之后，会通过`connection`
事件将这个客户端实例发射出去。在外部的应用代码中，我们通过这个客户端实例监听网络中的消息：

```js
const wss = new WebSocketServer({
  port: 8080,
  perMessageDeflate: false
});

wss.on('connection', (client) => {
  client.on('message', (data) => {
    client.send(data);
  });
});
```

可以看到，我们用`client.on()`监听 websocket 消息，用`client.send()`发送 websocket 消息。

那这个`client`对象是如何监听及发送 websocket 消息的呢？tcp 连接具体是怎么跟这个`client`对象关联的呢？

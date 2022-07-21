# Anatomy

## WebSocketServer 核心实现

### 应用代码示例

代码如下：

```js
const wss = new WebSocketServer({
  port: 8080,
});

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    ws.send(data);
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

创建一个 ws 对象，并将协商出的子协议和扩展保存在对象的私有字段上。
握手完成之后，后续与这个客户端的通信都是通过这个对象进行。

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

发送握手响应：

```js
socket.write(headers.concat('\r\n').join('\r\n'));
```

将底层 tcp socket 保存在刚创建的 ws 对象中：

```js
ws.setSocket(socket, head, {
  maxPayload: this.options.maxPayload,
  skipUTF8Validation: this.options.skipUTF8Validation
});
```

最后，通知上层应用 websocket 连接已建立：

```js
cb(ws, req);
```

这样，我们通过监听`wss`的`connection`事件就可以拿到客户端对象了，这个对象就是`WebSocket`实例。

从上面也可以看出，websocket 服务器的实现比较简单，仅仅是处理一下握手请求，然后把这个请求对应的底层 tcp 连接包装到一个 ws 对象中并通过`connection`事件传给应用层。应用层可根据这个 ws 对象与客户端进行双向通信。

## WebSocket 核心实现

从上面对服务器的分析我们知道，握手过程中会创建一个 WebSocket 实例(ws)，并且把底层的 tcp 连接保存在这个实例中。握手完成之后，会通过`connection`
事件将这个实例发射出去。在上层的应用代码中，我们通过这个 ws 实例与客户端进行双向通信：

```js
const wss = new WebSocketServer({
  port: 8080,
  perMessageDeflate: false
});

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    ws.send(data);
  });
});
```

可以看到，我们用`client.on()`监听 websocket 消息，用`client.send()`发送 websocket 消息。

那这个`client`对象是如何监听及发送 websocket 消息的呢？tcp 连接具体是怎么跟这个`client`对象关联的呢？

从上面的服务器握手过程中可知，在握手成功之后会把 socket 对象绑定在新创建的`ws`中，如下：

```js
ws.setSocket(socket, head, {
  maxPayload: this.options.maxPayload,
  skipUTF8Validation: this.options.skipUTF8Validation
});
```

### setSocket 内部流程

`setSocket`主要分2块逻辑，一块是创建并初始化`Receiver`和`Sender`，如下：

```js
const receiver = new Receiver({
  binaryType: this.binaryType,
  extensions: this._extensions,
  isServer: this._isServer,
  maxPayload: options.maxPayload,
  skipUTF8Validation: options.skipUTF8Validation
});

this._sender = new Sender(socket, this._extensions, options.generateMask);
this._receiver = receiver;

receiver[kWebSocket] = this;

receiver.on('conclude', receiverOnConclude);
receiver.on('drain', receiverOnDrain);
receiver.on('error', receiverOnError);
receiver.on('message', receiverOnMessage);
receiver.on('ping', receiverOnPing);
receiver.on('pong', receiverOnPong);
```

另一块就是修改`socket`配置，如下：

```js
this._socket = socket;

socket[kWebSocket] = this;

socket.setTimeout(0);
socket.setNoDelay();

if (head.length > 0) socket.unshift(head);

socket.on('close', socketOnClose);
socket.on('data', socketOnData);
socket.on('end', socketOnEnd);
socket.on('error', socketOnError);
```

可以看到，这里设置了 socket 监听`data`事件，当 socket 接收到数据时，执行下面的代码：

```js
function socketOnData(chunk) {
  if (!this[kWebSocket]._receiver.write(chunk)) {
    this.pause();
  }
}
```

可以看到，在 socket 接收到数据时，将数据写入到`Receiver`中了。

我们再来看看`Receiver`收到数据之后是如何处理的。

`Receiver`继承自`stream.Writable`类，并实现了自定义的`_write`方法。因此，调用`receiver.write(chunk)`会执行这个`_write`方法。

> https://nodejs.org/api/stream.html#writable_writechunk-encoding-callback

```js
function _write(chunk, encoding, cb) {
  if (this._opcode === 0x08 && this._state == GET_INFO) return cb();

  this._bufferedBytes += chunk.length;
  this._buffers.push(chunk);
  this.startLoop(cb);
}
```

如果在写入数据的时候发现 websocket 已经是关闭状态了，则直接返回。否则的话，将数据写入到内部的`_buffers`缓冲区，并开始执行`this.startLoop()`方法。

这个方法代码如下：

```js
function startLoop(cb) {
  let err;
  this._loop = true;

  do {
    switch (this._state) {
      case GET_INFO:
        err = this.getInfo();
        break;
      case GET_PAYLOAD_LENGTH_16:
        err = this.getPayloadLength16();
        break;
      case GET_PAYLOAD_LENGTH_64:
        err = this.getPayloadLength64();
        break;
      case GET_MASK:
        this.getMask();
        break;
      case GET_DATA:
        err = this.getData(cb);
        break;
      default:
        // `INFLATING`
        this._loop = false;
        return;
    }
  } while (this._loop);

  cb(err);
}
```

这个循环用于从缓冲区中解析 websocket 的 frame 数据。

值得关注的是，当从`Receiver`的缓冲区中解析出一个合法的 frame 时，会触发相应的事件。
比如，解析到控制帧时，会分别在`Receiver`实例上触发`ping/pong/conclude`事件：

```js
if (this._opcode === 0x08) {
  this.emit('conclude', code, buf);
  this.end();
} else if (this._opcode === 0x09) {
  this.emit('ping', data);
} else {
  this.emit('pong', data);
}
```

而这些事件会触发我们在`setSocket`中为`receiver`实例所绑定的事件处理器。

数据帧的解析如下：
```js
if (this._opcode === 2) {
  this.emit('message', data, true);
} else {
  this.emit('message', buf, false);
}
```
可以看到，二进制帧对应的第二个参数为 true，文本帧第二个参数为 false。

### 这里小结一下

我们在握手完成之后创建了一个 ws 对象，然后在`ws.setSocket`内部给 tcp socket 对象添加了一个`data`事件监听器，用于监听客户端发送过来的 frame 数据。当这个 socket 对象接收到来自客户端的数据时，我们通过一个`Receiver`对象去循环解析数据流中的 frame 结构，当成功解析出一个 frame 时，我们通过合适的事件(ping/pong/conclude/message)将解析出来的 payload 数据告知相关的监听器。

下面，我们分别看一下在`receiver`上设置的那些监听器都做了什么。

#### 1. conclude
```js
receiver.on('conclude', receiverOnConclude)

function receiverOnConclude(code, reason) {
  const websocket = this[kWebSocket];

  websocket._closeFrameReceived = true;
  websocket._closeMessage = reason;
  websocket._closeCode = code;

  if (websocket._socket[kWebSocket] === undefined) return;

  websocket._socket.removeListener('data', socketOnData);
  process.nextTick(resume, websocket._socket);

  if (code === 1005) websocket.close();
  else websocket.close(code, reason);
}
```
接收到客户端的**关闭帧**时，解除 socket 上的`data`监听器，然后调用`websocket.close()`给客户端发送**关闭帧**。

#### 2. message
```js
receiver.on('message', receiverOnMessage);

function receiverOnMessage(data, isBinary) {
  this[kWebSocket].emit('message', data, isBinary);
}
```
接收到客户端的`message`事件时，不做额外处理，仅仅是把 payload 数据告知给应用层代码。同时第二个参数表示数据是否为二进制。

#### 3. ping
```js
receiver.on('ping', receiverOnPing);

function receiverOnPing(data) {
  const websocket = this[kWebSocket];

  websocket.pong(data, !websocket._isServer, NOOP);
  websocket.emit('ping', data);
}
```
接收到客户端的`ping`帧时，以相同的数据回复`pong`帧。同时通过`ping`事件告知应用层代码。

#### 4. pong
```js
receiver.on('pong', receiverOnPong);

function receiverOnPong(data) {
  this[kWebSocket].emit('pong', data);
}
```
接收到客户端的`pong`帧时，没有额外的处理，只是通知一下应用层代码。

到此为止，从客户端发往服务端的数据流转过程已经分析完了。

let {ExChannel, RemoteError} = require('exchannel');
let {EventEmitter} = require('events');
let RealWebSocket = require('ws');

function newCall(Cls, args) {
  args.unshift(null);
  return new (Function.prototype.bind.apply(Cls, args));
}

class WebSocket extends ExChannel {
  constructor(firstArg, ...args) {
    let wsClient;
    if(firstArg && firstArg instanceof RealWebSocket) {
      wsClient = firstArg;
    } else {
      wsClient = new RealWebSocket(firstArg, ...args);
    }
    
    super(wsClient);

    this.responseTimeout = 10000;
    this.wsClient = wsClient;

    this.wsClient.on('open', () => {
      this.emit('open');
    });
    this.wsClient.on('close', () => {
      this.emit('close');
    });
    this.wsClient.on('error', err => {
      this.emit('error', err);
    });
  }
  
  isClosed() {
    return this.wsClient.readyState === RealWebSocket.CLOSED ||
      this.wsClient.readyState === RealWebSocket.CLOSING;
  }
        
  close() {
    this.wsClient.close.apply(this.wsClient, arguments);
  }

  terminate() {
    this.wsClient.terminate();
  }
}

class WebSocketServer extends EventEmitter {
  constructor() {
    super();
    
    let args = Array.prototype.slice.call(arguments);
    EventEmitter.call(this);

    this.wsServer = newCall(RealWebSocket.Server, args);
    this.wsServer.on('connection', ws => {
      let ewsSocket = new WebSocket(ws);
      ewsSocket.server = this;
      this.emit('connection', ewsSocket);
    });
    
    let forwardEventsFor = eventName => {
      this.wsServer.on(eventName, () => {
        let args = Array.prototype.slice.call(arguments);
        args.unshift(eventName);
        this.emit.apply(this, args);
      });
    };
    forwardEventsFor('listening');
  }
}

function forwardCallServer(name) {
  WebSocketServer.prototype[name] = function() {
    this.wsServer[name].apply(this.wsServer, arguments);
  };
}

forwardCallServer('close');

WebSocket.Server = WebSocketServer;
WebSocket.RemoteError = RemoteError;
WebSocket.RequestHandler = ExChannel;
module.exports = WebSocket;

'use strict';

let ws = require('ws');
let Promise = require('bluebird');
let uuid = require('node-uuid');
let EventEmitter = require('events').EventEmitter;
require('promise-resolve-deep')(Promise);

class RemoteError extends Error {
  constructor(message, extra) {
    super(message, extra);
    Error.captureStackTrace(this, this.constructor.name);
    this.name = this.constructor.name;
    this.message = message;
    this.extra = extra;
  }
}

function newCall(Cls, args) {
  args.unshift(null);
  return new (Function.prototype.bind.apply(Cls, args));
}

function makeRequestHandler(cb) {
  return function requestHandler(data, responseCb) {
    Promise.resolve().then(() => Promise.resolveDeep(cb(data)))
      .nodeify(responseCb);
  };
}

class RequestHandler extends EventEmitter {
  constructor(messageProvider) {
    super();
    let requestMap = this.requestMap  = {};
    
    messageProvider.on('message', msg => {
      let obj = JSON.parse(msg);
      
      let responseFunction = (error, responseData) => {
        if(error && error instanceof Error) {
          error = {
            message: error.message,
            stack: error.stack,
            name: error.name
          };
        }
        try {
          this.send({
            error: error,
            type: obj.type,
            response: obj.uuid,
            data: responseData
          });
        } catch(err) {
          if(err.message !== 'not opened') {
            throw err;
          }
        }
      };
      
      try {
        try {
          this.emit('message', obj);
        } catch(err) {
          console.error(err.stack || err);
          this.emit('messageError', err, msg);
        }
        if(obj.type) {
          if(obj.uuid) {
            if(!this.listenerCount('request:'+obj.type)) {
              responseFunction(new Error('No handler for request: ' + obj.type));
            } else {
              this.emit('request:'+obj.type, obj.data, responseFunction);
            }
          } else if(obj.response) {
            if(requestMap[obj.response]) {
              if(obj.error) {
                requestMap[obj.response].error(obj.error);
              }
              else {
                requestMap[obj.response](obj.data);
              }
            }
            else {
              console.error('Got response without a request', obj.response);
            }
          } else {
            this.emit('event:'+obj.type, obj.data);
          }
        }
      } catch(err) {
        console.error(err.stack || err);
        this.emit('messageError', err, msg);
      }
    });
  }
  
  onRequest(name, cb) {
    this.on('request:'+name, makeRequestHandler(cb));
  }
  
  onceRequest(name, cb) {
    this.once('request:'+name, makeRequestHandler(cb));
  }
  
  onEvent(name, cb) {
    this.on('event:'+name, cb);
  }
  
  onceEvent(name, cb) {
    this.once('event:'+name, cb);
  }
  
  offEvent(name, cb) {
    if(cb)
      this.removeListener('event:' + name, cb);
    else
      this.removeAllListeners('event:' + name);
  }
  
  offRequest(name, cb) {
    if(cb)
      this.removeListener('request:' + name, cb);
    else
      this.removeAllListeners('request:' + name);
  }
  
  send(obj, cb) {
    cb(new Error('Not implemented'));
  }
  
  sendRequest(type, data, opts, cb) {
    let obj;
    opts = opts || {};
    if(typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    let requestMap = this.requestMap;
    let responseTimeout = opts.responseTimeout || this.responseTimeout;
    let originalStack = (new Error().stack).replace(/^Error\n/,'');
    return Promise.resolveDeep(data).then(data => {
      return (new Promise((resolve, reject) => {
        obj = {
          type: type,
          data: data,
          uuid: uuid.v4()
        };

        
        this.send(obj, error => {
          if(error) return reject(error);
           // sent successfuly, wait for response

          requestMap[obj.uuid] = data => {
            delete requestMap[obj.uuid];
            resolve(data);
          };
          requestMap[obj.uuid].error = error => {
            delete requestMap[obj.uuid];
            this.constructRealError(originalStack, error).then(reject);
          };
        });
      })).timeout(responseTimeout).catch(Promise.TimeoutError, err => {
        delete requestMap[obj.uuid];
        if(this.isClosed()) {
          // never resolve, this shouldn't leak as bluebird has no global state
          return new Promise((resolve, reject) => {});
        }
        throw err;
      })
      .nodeify(cb);
    });
  }
};

class WebSocket extends RequestHandler {
  constructRealError(originalStack, err) {
    let resolvedError;
    if(! (err instanceof Error) && err.message && err.stack) {
      let errInstance = new RemoteError(err.message);
      errInstance.name = 'Remote::' + err.name;
      let constructedStack = err.stack + '\n' + 'From previous event:\n' + originalStack;
      errInstance.stack = constructedStack;
      if(process.env.EWS_PRINT_REMOTE_REJECTIONS) {
        console.error(errInstance.stack);
      }
      resolvedError = errInstance;
    } else {
      resolvedError = err;
    }
    if(this.remoteErrorHook) {
      resolvedError = this.remoteErrorHook(resolvedError);
    }
    return Promise.resolve(resolvedError);
  }
  
  constructor(wsInstance) {
    let args = Array.prototype.slice.call(arguments);

    let wsClient;
    if(wsInstance && wsInstance instanceof ws) {
      wsClient = wsInstance;
    } else {
      wsClient = newCall(ws, args);
    }

    super(wsClient);

    this.responseTimeout = 10000;

    let requestMap = this.requestMap;

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
  
  send(msg, cb) {
    this.wsClient.send(JSON.stringify(msg), cb);
  }
  
  isClosed() {
    return this.wsClient.readyState === ws.CLOSED ||
      this.wsClient.readyState === ws.CLOSING;
  }
      
  setResponseTimeout(timeout) {
    this.responseTimeout = parseInt(timeout);
  }
  
  sendEvent(type, data, cb) {
    return (new Promise((resolve, reject) => {
      let obj = {
        type: type,
        data: data
      };
      this.send(obj);
    })).nodeify(cb);
  }
  
  close() {
    this.wsClient.close.apply(this.wsClient, arguments);
  }

  terminate() {
    this.wsClient.terminate();
  }
  
  setRemoteErrorHook(hook) {
    this.remoteErrorHook = hook;
  }
}

class WebSocketServer extends EventEmitter {
  constructor() {
    super();
    
    let args = Array.prototype.slice.call(arguments);
    EventEmitter.call(this);

    this.wsServer = newCall(ws.Server, args);
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
WebSocket.RequestHandler = RequestHandler;
module.exports = WebSocket;

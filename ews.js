'use strict';

let ws = require('ws');
let util = require('util');
let Promise = require('bluebird').Promise;
let uuid = require('node-uuid');
let EventEmitter = require('events').EventEmitter;

function RemoteError(message, extra) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
  this.extra = extra;
}
util.inherits(RemoteError, Error);

function newCall(Cls, args) {
  args.unshift(null);
  return new (Function.prototype.bind.apply(Cls, args));
}

class WebSocket extends EventEmitter{
  constructor(wsInstance) {
    let args = Array.prototype.slice.call(arguments);
    super();

    this.responseTimeout = 10000;

    let requestMap = this.requestMap  = {};

    if(wsInstance && wsInstance instanceof ws) {
      this.wsClient = wsInstance;
    } else {
      this.wsClient = newCall(ws, args);
    }
    this.wsClient.on('message', msg => {
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
  
  sendRequest(type, data, cb) {
    let obj;
    let requestMap = this.requestMap;
    let originalStack = (new Error().stack).replace(/^Error\n/,'');
    return (new Promise((resolve, reject) => {
      obj = {
        type: type,
        data: data,
        uuid: uuid.v4()
      };

      this.send(obj, function ack(error) {
        if(error) return reject(error);
         // sent successfuly, wait for response

        requestMap[obj.uuid] = function(data) {
          resolve(data);
          delete requestMap[obj.uuid];
        };
        requestMap[obj.uuid].error = function(error) {
          reject(error);
          delete requestMap[obj.uuid];
        };
      });
    })).timeout(this.responseTimeout).catch(Promise.TimeoutError, err => {
      delete requestMap[obj.uuid];
      throw err;
    }).catch(err => {
      if(! (err instanceof Error) && err.message && err.stack) {
        let errInstance = new RemoteError(err.message);
        errInstance.name = 'Remote::' + err.name;
        errInstance.stack = err.stack + '\n' + 'From previous event:\n' + originalStack;
        if(process.env.EWS_PRINT_REMOTE_REJECTIONS) {
          console.error(errInstance.stack);
        }
        throw errInstance;
      } else {
        throw err;
      }
    })
    .nodeify(cb);
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
      this.removeEventListener('event:' + name, cb);
    else
      this.removeAllListeners('event:' + name);
  }
  
  offRequest(name, cb) {
    if(cb)
      this.removeEventListener('request:' + name, cb);
    else
      this.removeAllListeners('request:' + name);
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
}

function makeRequestHandler(cb) {
  return function requestHandler(data, responseCb) {
    Promise.method(cb)(data).nodeify(responseCb);
  };
}

class WebSocketServer extends EventEmitter {
  constructor() {
    super();
    let args = Array.prototype.slice.call(arguments);
    EventEmitter.call(this);

    this.wsServer = newCall(ws.Server, args);
    this.wsServer.on('connection', ws => {
      this.emit('connection', new WebSocket(ws));
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

function forwardCallClient(name) {
  WebSocket.prototype[name] = function() {
    this.wsClient[name].apply(this.wsClient, arguments);
  };
}

forwardCallClient('close');

WebSocket.Server = WebSocketServer;
WebSocket.RemoteError = RemoteError;
module.exports = WebSocket;

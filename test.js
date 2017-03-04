'use strict';

require('should');
var assert = require('chai').assert;

var Promise = require('bluebird');

Promise.longStackTraces();

var WebSocket = require('./ews');
let RequestHandler = require('./ews').RequestHandler;
let EventEmitter = require('events').EventEmitter;

describe('ews module', function() {
  var ws, wss, wsServer, cancelRequestCheck;

  beforeEach(function(cb) {
    ws = new WebSocket('ws://localhost:23200', {
      protocolVersion: 8,
      origin: 'http://localhost'
    });
    wss = new WebSocket.Server({ port: 23200 });

    wss.on('connection', function(ws) {
      wsServer = ws;
    });
    ws.on('open', cb);
    cancelRequestCheck = false;
  });
  afterEach(function() {
    if(wss) {
      wss.close();
    }
    if(!cancelRequestCheck) {
      assert.deepEqual(ws.requestMap, {});
      assert.deepEqual(wsServer.requestMap, {});
    }
  });

  it('should work with casual web socket usage', endTest => {
    ws.send('test');
    ws.on('message', function(msg) {
      msg.should.equal('test-reply');
      endTest();
    });

    wsServer.on('message', function(msg) {
      wsServer.send('test-reply');
    });
  });

  it('should send JSON requests through basic API', endTest => {
    ws.sendRequest('test1', {code: 42}, function(err, res) {
      res.should.equal('foo');

      ws.sendRequest('test2', {code: 43}).then(function(res) {
        res.should.equal('foo2');
        endTest();
      });
    });

    wsServer.on('request:test1', function(data, responseCb) {
      data.code.should.equal(42);
      responseCb(null, 'foo');
    });
    wsServer.on('request:test2', function(data, responseCb) {
      data.code.should.equal(43);
      responseCb(null, 'foo2');
    });
  });

  it('should send JSON requests through promise request handlers',
    endTest => {
    ws.sendRequest('test1', {code: 42}, function(err, res) {
      res.should.equal('foo');

      ws.sendRequest('test2', {code: 43}).then(function(res) {
        res.should.equal('foo2');
        endTest();
      });
    });

    wsServer.onRequest('test1', function(data) {
      return 'foo';
    });
    wsServer.onRequest('test2', function(data) {
      return (new Promise(function(resolve, reject) {
        setTimeout(function() {
          resolve('foo2');
        }, 10);
      }));
    });
  });

  it('should send JSON requests through promise request handlers with nested promises',
    endTest => {
    ws.sendRequest('test1', {code: Promise.resolve(42)}, function(err, res) {
      assert.deepEqual(res, {
        foo: ['bar', 'foo']
      })
      endTest();
    });

    wsServer.onRequest('test1', function(data) {
      assert.deepEqual(data, {code: 42});
      
      return Promise.resolve({
        foo: [Promise.resolve('bar'), 'foo']
      });
    });
  });
  
  it('should send an error if request is not handled', endTest => {
    ws.sendRequest('test1', {code: 42}).catch(err => {
      if(err.message.match(/No handler for request: test1/)) {
        endTest();
      } else {
        throw err;
      }
    });
  });
  

  it('should send exceptions through promise handlers', endTest => {
    ws.sendRequest('test', {code: 42}, function(err, res) {
      err.should.equal("foo");
      endTest();
    });
    wsServer.onRequest('test', function(data) {
      throw "foo";
    });
  });
  
  it('should send real exceptions through promise handlers', endTest => {
    ws.sendRequest('test', {code: 42}, function(err, res) {
      err.name.should.equal('Remote::Error');
      err.message.should.equal("foo");
      endTest();
    });
    wsServer.onRequest('test', function(data) {
      throw new Error('foo');
    });
  });
  
  
  it('should send real exceptions through promise handlers with custom exception hook', endTest => {
    wsServer.setRemoteErrorHook(err => {
      err.name = 'FooBar';
      return Promise.resolve(err).delay(1);
    });
  
    wsServer.sendRequest('test', {code: 42}, function(err, res) {
      err.name.should.equal('FooBar');
      err.should.be.instanceof(WebSocket.RemoteError);
      err.message.should.equal("foo");
      endTest();
    });
    
    ws.onRequest('test', function(data) {
      throw new Error('foo');
    });
  });
  
  it('should not send Timeout after disconnected from server', endTest => {
    ws.setResponseTimeout(20);
    
    let timeout = setTimeout(() => {
      endTest();
    }, 30);
    
    ws.sendRequest('test', {code: 42}, function(err, res) {
      clearTimeout(timeout);
      if(err) endTest(err);
    });
    setTimeout(() => {
      wsServer.close();
    }, 10);
    wsServer.onRequest('test', function(data) {
      return new Promise((resolve, reject) => {});
    });
    
  });

  it('should not send Timeout after disconnected from client', endTest => {
    ws.setResponseTimeout(10);
    
    let timeout = setTimeout(() => {
      endTest();
    }, 15);
    
    ws.sendRequest('test', {code: 42}, function(err, res) {
      clearTimeout(timeout);
      if(err) endTest(err);
    });
    setTimeout(() => {
      ws.close();
    }, 5);
    wsServer.onRequest('test', function(data) {
      return new Promise((resolve, reject) => {});
    });
  });


  it('should send Error exceptions through promise handlers', endTest => {
    ws.sendRequest('test', {code: 42}).then(function(res) {
      //endTest();
    }).catch(WebSocket.RemoteError, function(err) {
      err.should.be.an.instanceOf(Error);
      err.message.should.equal('error with stacktrace');
      return Promise.resolve().then(function() {
        throw err;
      });
    }).catch(WebSocket.RemoteError, function(err) {
      err.stack.should.match(/remoteFunc/);
      endTest();
    });
    wsServer.onRequest('test', function(data) {
      function remoteFunc() {
        throw new Error('error with stacktrace');
      }
      return Promise.resolve().then(remoteFunc);
    });
  });

  it('should handle timeout errors', endTest => {
    var gotTimeout = false;

    ws.sendRequest('test1', {code: 42}, {responseTimeout: 10})
    .then(function(res) {
      res.should.equal('foo');
    }).catch(Promise.TimeoutError, function(err) {
      gotTimeout = true;
      err.message.should.equal('operation timed out');
    });

    wsServer.onRequest('test1', function(data) {
      return Promise.delay(20).then(function() {
        if(gotTimeout)
          endTest();
        return 'foo';
      });
    });
  });

  it('should send events', endTest => {
    ws.sendEvent('test', {
      code: 'foo'
    });

    wsServer.onEvent('test', function(data) {
      data.code.should.equal('foo');
      endTest();
    });
  });

  it('should not send events when removed', endTest => {
    ws.sendEvent('test', {
      code: 'foo'
    });

    wsServer.onEvent('test', function(data) {
      assert(false, 'Should not happen');
    });

    wsServer.offEvent('test');
    setTimeout(function() {
      endTest();
    }, 10);
  });

  it('should handle errors inside message handler', endTest => {
    ws.sendEvent('test');

    var tmp = console.error;
      console.error = function(msg) {
    };
    wsServer.on('message', function(msg) {
      throw new Error('test error');
    });

    wsServer.onEvent('test', function() {
      console.error = tmp;
      endTest();
    });
  });
  
  it('should not break if remote party suddenly dies', endTest => {
    ws.sendRequest('test1', {code: 42}).then(function(res) {
      res.should.equal('foo');
    });
    
    wsServer.onRequest('test1', function(data) {
      return Promise.delay(20).then(function() {
        cancelRequestCheck = true;
        ws.close();
      }).delay(20).then(endTest);
    });
  });

  describe('WebSocketServer', function() {
    it('should emit close events', endTest => {
      wss.close();
      wsServer.on('close', function() {
        endTest();
      });
    });
  });

  describe('WebSocket', function() {
    it('should emit close events from client', endTest => {
      ws.close(1000);
      wsServer.on('close', function() {
        endTest();
      });
    });
    it('should emit close events from client with terminate', endTest => {
      ws.terminate();
      wsServer.on('close', function() {
        endTest();
      });
    });
    it('should emit close events from server', endTest => {
      wsServer.close(1000);
      ws.on('close', function() {
        endTest();
      });
    });
    it('should emit close events from server with terminate', endTest => {
      wsServer.terminate();
      ws.on('close', function() {
        endTest();
      });
    });
    it('should emit an error if closing with bad error number', endTest => {
      ws.once('error', function(err) {
        err.message.should.match(/first argument must be a valid error code number/);
        endTest();
      });
      ws.close(0);
    });
    it('should emit an error if closing from server with bad error number', endTest => {
      wsServer.once('error', function(err) {
        err.message.should.match(/first argument must be a valid error code number/);
        endTest();
      });
      wsServer.close(0);
    });
  });
  
  describe('RequestHandler', function() {
    let emitter, requestHandler;
    before(() => {
      emitter = new EventEmitter();

      emitter.send = function(obj, cb) {
        emitter.emit('message', obj);
        if(cb) cb();
      };
      requestHandler = new RequestHandler(emitter);
    })
    function emitMessage(type, data) {
      
    }
    
    it('should emit event', endTest => {
      requestHandler.onEvent('test', () => {
        endTest();
      })
      requestHandler.sendEvent('test', 'foo');
    });
    
    
    it('should emit scoped event', endTest => {
      let scoped = requestHandler.scope('foobar');
      
      scoped.onEvent('test', () => {
        endTest();
      })
      requestHandler.sendEvent('foobar:test', 'foo');
    });
    
    it('should not emit scoped event', endTest => {
      let scoped = requestHandler.scope('foobar');
      
      scoped.onEvent('test', () => {
        endTest();
      })
      scoped.removeAllListeners();
      scoped.onEvent('test2', data => {
        data.should.equal('foo');
        endTest();
      })
      scoped.sendEvent('test2', 'foo');
    });
    
    it('should handle requests', endTest => {
      let scoped = requestHandler.scope('foobar');
      scoped.onRequest('test', () => {
        return 'bar';
      });
      scoped.sendRequest('test').then(data => {
        data.should.equal('bar');
        endTest();
      })
    });
    
  });
  
});
